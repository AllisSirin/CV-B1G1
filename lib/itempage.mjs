import { block, text, attr, decode } from "./html.mjs";

const yen = (raw) => {
  if (!raw) return null;
  const hits = [...raw.matchAll(/([\d,]+(?:\.\d+)?)\s*円/g)].map((m) => Number(m[1].replace(/,/g, "")));
  if (!hits.length) return null;
  return { yen: Math.round(/税込/.test(raw) ? hits[hits.length - 1] : hits[0]), label: raw.replace(/\s+/g, "") };
};

const ogTitle = (html) => {
  const m = /<meta[^>]+property="og:title"[^>]*>/i.exec(html);
  return m ? decode(attr(m[0], "content")).replace(/[｜|].*$/, "").trim() : "";
};

const heading = (html) => {
  const m = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  return m ? text(m[1]) : "";
};

/** 매장마다 상세 페이지의 이름·가격 위치가 다르다 */
const READERS = {
  seven: (html) => ({
    name: heading(html) || ogTitle(html),
    raw: text(block(html, "div", "item_price")?.inner || ""),
  }),
  familymart: (html) => ({
    name: heading(html) || ogTitle(html),
    raw: text(block(html, "span", "ly-kakaku-usual")?.inner || ""),
  }),
  /** 로손은 오른쪽 블록에 본 상품, 아래에 관련 상품이 또 있어 범위를 좁혀야 한다 */
  lawson: (html) => {
    const scope = block(html, "div", "rightBlock")?.inner || html;
    return {
      name: text(block(scope, "h2", "ttl")?.inner || "") || ogTitle(html),
      raw: text(block(scope, "dl", "price")?.inner || ""),
    };
  },
};

/** 목록에 없는 상품은 상세 페이지에만 값이 있다 */
export function parseItemPage(store, html, url) {
  const read = READERS[store];
  if (!read) return null;
  const { name, raw } = read(html);
  const price = yen(raw);
  return name && price ? { name, price, url } : null;
}
