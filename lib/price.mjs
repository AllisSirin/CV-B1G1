import { normalize } from "./catalog.mjs";
import { parseItemPage } from "./itempage.mjs";
import { findItemPages, searchable, webSearchPage } from "./lookup.mjs";

const KEEP_MISS = 7 * 24 * 60 * 60 * 1000;
/** 찾는 규칙을 고치면 지난 실패는 잊는다 (안 그러면 캐시를 손으로 지워야 한다) */
const RULES = 5;
const itemsOf = (side) => (side?.items?.length ? side.items : side ? [side] : []);

const MIN_LOOSE = 6;
const MAX_EXTRA = 6;
/** 값이 달라지는 꼬리 — 묶음·용량이 붙은 상품은 다른 상품으로 본다 (５食パック 734円 사고) */
const PACK = /[0-9]|パック|ボックス|ケース|セット|箱|袋|入|徳用|まとめ|ファミリー/;

/**
 * 값을 어느 상품에서 읽었는지 등급을 매긴다.
 * exact  — 이름이 같다.
 * approx — 한쪽이 다른 쪽의 앞부분이고 남는 꼬리가 짧다(공식 이름에만 「スープカップ」 같은 규격이 붙는 경우).
 *          맛이 다른 상품에 값이 붙는 사고를 막으려고 짧은 이름(6자 미만)은 근사 일치를 아예 안 쓴다.
 */
function matchName(found, keys) {
  const name = normalize(found);
  if (keys.has(name)) return "exact";
  for (const key of keys) {
    if (key.length < MIN_LOOSE) continue;
    const [short, long] = key.length <= name.length ? [key, name] : [name, key];
    if (!long.startsWith(short)) continue;
    const extra = long.slice(short.length);
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
 * 세븐 검색은 낱말별 부분 일치를 AND 로 묶는다.
 * 그래서 「森永inバー エネルギー サツマイモ」 통째로는 0건이지만(공식 제목은 「森永 ｉｎバーエネルギー…」라
 * `森永inバー` 가 부분 문자열이 아니다) 낱말로 쪼개면 찾아진다.
 * 상품명 그대로 → 낱말 분해 → 가장 긴 낱말 둘 순서로 물어본다(제조사는 표기가 달라 도움이 안 됐다).
 */
const queriesFor = (item) => {
  const name = item.names[0] || "";
  const tokens = tokensOf(name);
  const longest = [...tokens].filter((t) => t.length >= 3).sort((a, b) => b.length - a.length).slice(0, 2);
  return [...new Set([name, tokens.join(" "), longest.join(" ")])].filter((q) => q.length >= 3);
};

/**
 * 상품별 값을 한 번 찾으면 계속 쓴다(못 찾은 것도 기록해 매번 검색하지 않는다).
 * 한 번에 조금씩만 찾아 상대 서버에 몰아치지 않는다.
 */
export function createPriceBook({ store: cacheFile, fetchPage, budget = 10, pause = 700, now = () => Date.now() }) {
  const cache = cacheFile;

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

    /** 아직 모르는 상품을 정해진 개수만큼 찾아 캐시에 넣는다 */
    async fill(results) {
      let left = budget;
      for (const result of results) {
        for (const deal of result.deals || []) {
          for (const side of [deal.buy, deal.get]) {
            for (const item of itemsOf(side)) {
              if (left <= 0) return;
              if (item.price) continue;
              if (!searchable(result.store)) continue;
              const keys = keysFor(item, side);
              if (!keys.size || read(result.store, keys) || missRecently(result.store, keys)) continue;
              left -= 1;
              const price = await this.lookup(result.store, item, side, keys);
              for (const key of keys) cache.set(`${result.store}|${key}`, price ?? { rules: RULES });
              if (price) item.price = price;
              if (left > 0) await new Promise((r) => setTimeout(r, pause));
            }
          }
        }
      }
    },

    async lookup(store, item, side, keys) {
      try {
        for (const query of queriesFor(item)) {
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
      } catch {
        return null;
      }
      return null;
    },
  };
}
