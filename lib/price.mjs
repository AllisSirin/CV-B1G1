import { normalize } from "./catalog.mjs";
import { parseItemPage } from "./itempage.mjs";
import { findCatalogEntries, findItemPages, listSearch, searchable, webSearchPage } from "./lookup.mjs";

const KEEP_MISS = 7 * 24 * 60 * 60 * 1000;
/** 막은 매장만 한동안 쉰다 — 화면은 값이 다 찰 때까지 몇 초마다 갱신을 부르므로 그대로 두면 계속 두드린다 */
const REST_AFTER_BLOCK = 10 * 60 * 1000;
/** 찾는 규칙을 고치면 지난 실패는 잊는다 (안 그러면 캐시를 손으로 지워야 한다) */
const RULES = 8;
const itemsOf = (side) => (side?.items?.length ? side.items : side ? [side] : []);

const MIN_LOOSE = 6;
const MAX_EXTRA = 6;
/**
 * 값이 달라지는 꼬리 — 묶음·용량·규격이 붙은 상품은 다른 상품으로 본다.
 * (５食パック 734円 사고, 「サッポロ一番 塩らーめん」에 「…塩らーめんミニどんぶり」 168円 이 붙은 사고)
 */
const PACK = /[0-9]|パック|ボックス|ケース|セット|箱|袋|入|徳用|まとめ|ファミリー|ミニ|どんぶり|ビッグ|大盛/;

/**
 * 값을 어느 상품에서 읽었는지 등급을 매긴다.
 * exact  — 이름이 같다.
 * approx — 공식 이름이 우리가 아는 이름으로 시작하고 남는 꼬리가 짧다
 *          (공식 이름에만 「スープカップ」 같은 규격이 덧붙는 경우).
 *          맛이 다른 상품에 값이 붙는 사고를 막으려고 짧은 이름(6자 미만)은 근사 일치를 아예 안 쓴다.
 *          반대 방향(우리가 아는 이름이 더 긴 경우)은 인정하지 않는다 — 우리 쪽에만 있는 말이
 *          다른 상품을 가리키기 때문이다(「みそラーメン味〆のご飯」은 컵밥, 「みそラーメン」은 봉지면).
 */
function matchName(found, keys) {
  const name = normalize(found);
  if (keys.has(name)) return "exact";
  for (const key of keys) {
    if (key.length < MIN_LOOSE || !name.startsWith(key)) continue;
    const extra = name.slice(key.length);
    if (extra.length <= MAX_EXTRA && !PACK.test(extra)) return "approx";
  }
  return null;
}

const keysFor = (item, side) => {
  const maker = item.maker || side?.maker || "";
  return new Set(item.names.flatMap((n) => [normalize(n), normalize(`${maker}${n}`)]).filter((k) => k.length >= 4));
};

/** 사람이 검색창에 넣을 말 — 제조사가 있으면 붙이고 값을 묻는 말로 끝낸다 */
const searchWords = (item, side, name) => [item.maker || side?.maker || "", name, "価格"].filter(Boolean).join(" ");

const TOKEN = /[\u30a0-\u30ff\u31f0-\u31ff\u30fc]+|[\u4e00-\u9fff]+|[\u3040-\u309f\u30fc]+|[a-zA-Z0-9]+/g;
const tokensOf = (name) => name.match(TOKEN) || [];

/**
 * 검색은 낱말별 부분 일치라 이름을 통째로 넣으면 표기 차이로 0건이 되기 쉽다
 * (「森永inバー エネルギー サツマイモ」의 공식 제목은 「森永 ｉｎバーエネルギー…」로 전각 ｉｎ 이다).
 * 가장 긴 낱말 하나 → 상품명 그대로 → 긴 낱말 둘 순서로 물어본다.
 * 낱말 하나로 먼저 묻는 편이 한 장의 결과로 같은 계열(カップヌードル 7종)을 같이 해결해 요청이 적다.
 */
const queriesFor = (item) => {
  const name = item.names[0] || "";
  const tokens = tokensOf(name);
  const longest = [...tokens].filter((t) => t.length >= 3).sort((a, b) => b.length - a.length);
  return [...new Set([longest[0], name, longest.slice(0, 2).join(" ")])].filter((q) => q && q.length >= 3);
};

/**
 * 목록 한 장에서 이름이 맞는 항목을 고른다.
 * 완전 일치가 뒤쪽에 있을 수 있어 끝까지 보고, 근사 일치는 완전 일치가 없을 때만 쓴다.
 */
const pickFrom = (entries, keys) => {
  let loose = null;
  for (const entry of entries) {
    if (!entry.price?.yen) continue;
    const level = matchName(entry.name, keys);
    if (!level) continue;
    const price = { yen: entry.price.yen, label: entry.price.label, url: entry.url, name: entry.name };
    if (level === "exact") return price;
    loose = loose || { ...price, approx: true };
  }
  return loose;
};

/**
 * 상품별 값을 한 번 찾으면 계속 쓴다(못 찾은 것도 기록해 매번 검색하지 않는다).
 * 한 번에 조금씩만 찾아 상대 서버에 몰아치지 않는다.
 * 아끼는 것도 쉬는 것도 매장마다 따로 센다 — 한 매장 사정에 다른 매장이 끌려가지 않는다.
 */
export function createPriceBook({ store: cacheFile, fetchPage, budget = 10, pause = 1500, now = () => Date.now() }) {
  const cache = cacheFile;
  /** 같은 낱말을 여러 상품이 함께 쓴다 — 한 번 받은 목록은 그 갱신 안에서 다시 받지 않는다 */
  const searched = new Map();
  /** 매장 → 이때까지는 그 매장에 묻지 않는다 */
  const restUntil = new Map();
  const resting = (store) => now() < (restUntil.get(store) ?? 0);
  const searchEntries = async (store, query) => {
    const key = `${store}|${query}`;
    if (!searched.has(key)) searched.set(key, await findCatalogEntries(store, query, fetchPage));
    return searched.get(key);
  };

  const read = (store, keys) => {
    for (const key of keys) {
      const hit = cache.get(`${store}|${key}`);
      if (hit?.value?.yen) return hit.value;
    }
    return null;
  };

  const missRecently = (store, keys) =>
    [...keys].some((key) => {
      const hit = cache.get(`${store}|${key}`);
      return hit && !hit.value?.yen && hit.value?.rules === RULES && now() - hit.fetchedAt < KEEP_MISS;
    });

  return {
    /** 캐시에 있는 값만 붙인다(빠름) */
    attach(result) {
      for (const deal of result.deals || []) {
        for (const side of [deal.buy, deal.get]) {
          for (const item of itemsOf(side)) {
            if (item.price) continue;
            const price = read(result.store, keysFor(item, side));
            if (price) item.price = price;
          }
        }
      }
      return result;
    },

    /**
     * 지금 하는 딜에 없는 값은 캐시에서 버린다.
     * 내려간 딜의 상품이 나중에 다른 딜로 돌아오면 그때 다시 찾아 최신 값을 쓴다.
     * 가져오기에 실패했거나 딜이 0건인 매장은 건드리지 않는다 — 한 번의 실패로 모아 둔 값을 비우지 않는다.
     */
    prune(results) {
      const live = new Map();
      const skip = new Set();
      for (const result of results) {
        if (result.error || !(result.deals || []).length) {
          skip.add(result.store);
          continue;
        }
        const keys = live.get(result.store) || new Set();
        live.set(result.store, keys);
        for (const deal of result.deals) {
          for (const side of [deal.buy, deal.get]) {
            for (const item of itemsOf(side)) for (const key of keysFor(item, side)) keys.add(key);
          }
        }
      }
      const gone = cache.keys().filter((cached) => {
        const at = cached.indexOf("|");
        const store = cached.slice(0, at);
        if (at < 0 || skip.has(store) || !live.has(store)) return false;
        return !live.get(store).has(cached.slice(at + 1));
      });
      return cache.drop(gone);
    },

    /** 값을 못 찾은 상품은 「제조사 상품명 価格」 웹 검색으로 보내 준다 */
    hint(result) {
      for (const deal of result.deals || []) {
        for (const side of [deal.buy, deal.get]) {
          for (const item of itemsOf(side)) {
            if (item.price) continue;
            const name = item.names?.[0];
            if (name) item.priceSearch = webSearchPage(searchWords(item, side, name));
          }
        }
      }
      return result;
    },

    /** 아직 모르는 상품을 매장마다 정해진 개수만큼 찾아 캐시에 넣는다 */
    async fill(results) {
      const left = new Map();
      for (const result of results) {
        const store = result.store;
        for (const deal of result.deals || []) {
          for (const side of [deal.buy, deal.get]) {
            for (const item of itemsOf(side)) {
              if (item.price || !searchable(store) || resting(store)) continue;
              if (!left.has(store)) left.set(store, budget);
              if (left.get(store) <= 0) continue;
              const keys = keysFor(item, side);
              if (!keys.size || read(store, keys) || missRecently(store, keys)) continue;
              left.set(store, left.get(store) - 1);
              let price;
              try {
                price = await this.lookup(store, item, side, keys);
              } catch {
                /** 이 매장이 막았거나(403) 통신이 끊겼다 — 「값 없음」으로 굳히지 않고, 이 매장만 쉬었다 다시 찾는다 */
                restUntil.set(store, now() + REST_AFTER_BLOCK);
                continue;
              }
              for (const key of keys) cache.set(`${store}|${key}`, price ?? { rules: RULES });
              if (price) item.price = price;
              if (left.get(store) > 0) await new Promise((r) => setTimeout(r, pause));
            }
          }
        }
      }
    },

    async lookup(store, item, side, keys) {
      for (const query of queriesFor(item)) {
        if (listSearch(store)) {
          const found = pickFrom(await searchEntries(store, query), keys);
          if (found) return found;
          continue;
        }
        const pages = await findItemPages(store, query, fetchPage);
        let loose = null;
        for (const url of pages.slice(0, 5)) {
          const found = parseItemPage(store, await fetchPage(url), url);
          const level = found && matchName(found.name, keys);
          if (!level) continue;
          const price = { yen: found.price.yen, label: found.price.label, url, name: found.name };
          if (level === "exact") return price;
          loose = loose || { ...price, approx: true };
        }
        if (loose) return loose;
        if (pages.length) break;
      }
      return null;
    },
  };
}
