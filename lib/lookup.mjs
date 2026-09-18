import { decode } from "./html.mjs";

/**
 * 공식 사이트에서 상품 상세 페이지 주소 꼴 (검색 결과를 여기로만 좁힌다).
 * 세븐은 같은 상품이 지역별 주소(`/item/480112/chugoku/`)로도 있어서
 * 주소를 그대로 두면 한 상품에 9개가 잡힌다 → 상품 번호로 하나만 남긴다.
 */
const ITEM_URL = {
  seven: {
    host: "www.sej.co.jp",
    path: /\/products\/a\/item\/\d+(?:\/[a-z]+)?\/?$/,
    key: (url) => /\/item\/(\d+)/.exec(url.pathname)?.[1] ?? url.pathname,
  },
  familymart: { host: "www.family.co.jp", path: /\/goods\/[a-z_]+\/\d+\.html$/ },
  lawson: { host: "www.lawson.co.jp", path: /\/recommend\/original\/detail\/\w+\.html$/ },
};

/**
 * 각 편의점이 자기 사이트에 쓰는 검색.
 * seven 은 검색 결과가 서버에서 그려지고(Shift_JIS 이지만 주소는 ASCII),
 * familymart 는 화면은 스크립트로 그리지만 그 안에서 부르는 JSON 을 그대로 쓸 수 있다.
 * lawson 은 결과가 외부 위젯(syncsearch)에서만 그려지고, 애초에 자기 상품만 올리므로
 * 1+1 에 나오는 제조사 상품 값을 얻을 곳이 없다 → 검색하지 않는다.
 */
const SEARCH = {
  seven: {
    url: (q) => `https://www.sej.co.jp/search.html?kw=${encodeURIComponent(q)}&ie=UTF-8&by=js&temp=`,
  },
  familymart: {
    url: (q) =>
      `https://finder.api.mf.marsflag.com/api/v1/finder_service/documents/98850d67/search?q=${encodeURIComponent(q)}`,
  },
};

export const itemUrlPattern = (store) => ITEM_URL[store];
export const searchable = (store) => Boolean(SEARCH[store]?.url);
export const searchUrl = (store, query) => SEARCH[store]?.url?.(query) ?? null;
/**
 * 값을 못 찾았을 때 대신 걸어 주는 검색 화면.
 * 매장 검색은 자기 사이트에 올라온 상품만 보여 주므로(1+1 대상은 대부분 제조사 상품)
 * 값이 실린 곳을 널리 찾도록 웹 검색으로 보낸다.
 */
export const webSearchPage = (query) => `https://www.google.com/search?q=${encodeURIComponent(query)}`;

/** 검색 결과(HTML 이든 JSON 이든)에서 상세 페이지 주소만 골라낸다 */
export function extractLinks(text, store) {
  const rule = ITEM_URL[store];
  if (!rule) return [];
  const urls = [];
  const seen = new Set();
  for (const m of text.matchAll(/https?:\/\/[^\s"'<>)\\]+/g)) {
    let url;
    try {
      url = new URL(decode(m[0]).replace(/[.,]+$/, ""));
    } catch {
      continue;
    }
    if (url.hostname !== rule.host || !rule.path.test(url.pathname)) continue;
    const clean = `${url.origin}${url.pathname}`;
    const id = rule.key ? rule.key(url) : clean;
    if (seen.has(id)) continue;
    seen.add(id);
    urls.push(clean);
  }
  return urls;
}

export async function findItemPages(store, query, get) {
  const url = searchUrl(store, query);
  if (!url) return [];
  return extractLinks(await get(url), store);
}
