import { blocks, block, text, attr, absolute } from "./html.mjs";

const YEN = /([\d,]+)\s*円/;
/** 표시가와 세금 포함가가 같이 오면(「158円（税込170円）」) 세금 포함가를 쓴다 */
function priceOf(raw) {
  if (!raw) return null;
  const hits = [...raw.matchAll(/([\d,]+(?:\.\d+)?)\s*円/g)].map((m) => Number(m[1].replace(/,/g, "")));
  if (!hits.length) return null;
  const taxIncluded = /税込/.test(raw) ? hits[hits.length - 1] : hits[0];
  return { yen: Math.round(taxIncluded), label: raw.replace(/\s+/g, "") };
}

const link = (html, base) => {
  const m = /<a[^>]+href="([^"]+)"/i.exec(html || "");
  return m ? absolute(attr(m[0], "href"), base) : "";
};

/** 편의점별 상품 목록 페이지 → { name, price, url } 목록 */
export const CATALOGS = {
  seven: {
    base: "https://www.sej.co.jp",
    paths: ["/products/a/thisweek/", "/products/a/nextweek/", "/products/a/ice_cream/", "/products/a/sweets/", "/products/a/men/", "/products/a/dailydish/", "/products/a/bread/", "/products/a/donut/", "/products/a/chukaman/", "/products/a/frozen_foods/"],
    parse: (html, url) => blocks(html, "div", (cls) => cls.includes("list_inner")).map((it) => ({
      name: text(block(it.inner, "div", "item_ttl")?.inner || ""),
      price: priceOf(text(block(it.inner, "div", "item_price")?.inner || "")),
      url: link(block(it.inner, "div", "item_ttl")?.inner || "", url),
    })),
  },
  familymart: {
    base: "https://www.family.co.jp",
    paths: ["/goods/newgoods.html", "/goods/snack.html", "/goods/drink.html", "/goods/ice.html", "/goods/dessert.html", "/goods/baked_sweets.html", "/goods/chilleddaily.html", "/goods/processed_foods.html", "/goods/noodle.html", "/goods/alcohol.html"],
    parse: (html, url) => blocks(html, "div", (cls) => cls.includes("ly-mod-infoset3")).map((it) => ({
      name: text(block(it.inner, "p", "ly-mod-infoset3-name")?.inner || ""),
      price: priceOf(text(block(it.inner, "p", "ly-mod-infoset3-price")?.inner || "")),
      url: link(it.inner, url),
    })),
  },
  lawson: {
    base: "https://www.lawson.co.jp",
    paths: ["/recommend/original/dessert/", "/recommend/original/chilled/", "/recommend/original/kenkosnack/", "/recommend/original/noodle/", "/recommend/original/coffee/", "/recommend/original/liquor/", "/recommend/original/bakery/", "/recommend/original/gentei/", "/recommend/original/select/"],
    parse: (html, url) => blocks(html, "li").map((it) => ({
      name: text(block(it.inner, "p", "ttl")?.inner || ""),
      price: priceOf(text(block(it.inner, "p", "price")?.inner || "")),
      url: link(it.inner, url),
    })),
  },
};

export const parseCatalog = (store, html, url) =>
  CATALOGS[store].parse(html, url).filter((e) => e.name && e.price);

/** 표기 차이(전각·공백·괄호·용량)를 걷어내고 비교한다 */
export function normalize(name) {
  return String(name || "")
    .normalize("NFKC")
    .replace(/[（）()【】\[\]「」]/g, "")
    .replace(/[・･,、\-‐−–—/]/g, "")
    .replace(/\s+/g, "")
    .replace(/(\d+(\.\d+)?)(ml|l|g|kg|kcal|本|個|枚|入|袋|缶|缶入)$/i, "")
    .toLowerCase();
}

const MIN_KEY = 4;

/**
 * 이름이 완전히 같을 때만 값을 붙인다.
 * 부분 일치를 허용하면 「大粒ラムネ」에 「大粒ラムネ アイスボックス味」 값이,
 * 「のむヨーグルト ブルーベリー風味」에 편의점 자체 상품 값이 붙어 엉뚱한 가격이 된다.
 */
export function matchPrice(index, { maker = "", names = [] } = {}) {
  const keys = new Set(names.flatMap((n) => [normalize(n), normalize(`${maker}${n}`)]).filter((k) => k.length >= MIN_KEY));
  for (const entry of index) {
    if (keys.has(normalize(entry.name))) {
      return { yen: entry.price.yen, label: entry.price.label, url: entry.url, name: entry.name };
    }
  }
  return null;
}

/** 상대 사이트에 부담을 주지 않게 동시 요청 수를 묶는다 */
async function mapLimit(items, limit, fn) {
  const out = [];
  const queue = [...items.entries()];
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const [i, item] = queue.shift();
      out[i] = await fn(item);
    }
  }));
  return out;
}

export async function buildCatalog(store, get) {
  const { base, paths } = CATALOGS[store];
  const pages = await mapLimit(paths, 4, async (path) => {
    const url = base + path;
    try {
      return parseCatalog(store, await get(url), url);
    } catch {
      return [];
    }
  });
  const seen = new Map();
  for (const entry of pages.flat()) if (!seen.has(entry.name)) seen.set(entry.name, entry);
  return [...seen.values()];
}

const itemsOf = (side) => (side?.items?.length ? side.items : side ? [side] : []);

/** 공식 상품 페이지에서 값을 찾은 상품에만 가격을 붙인다 */
export function annotateDeals(result, index) {
  if (!index?.length) return result;
  for (const deal of result.deals || []) {
    for (const side of [deal.buy, deal.get]) {
      for (const item of itemsOf(side)) {
        const price = matchPrice(index, { maker: item.maker || side.maker, names: item.names });
        if (price) item.price = price;
      }
    }
  }
  return result;
}
