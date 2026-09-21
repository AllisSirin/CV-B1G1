import { parseReceipt, parseFamipay } from "./familymart.mjs";
import { parseSeven } from "./seven.mjs";
import { findCampaignLinks, findLawsonSales, hasCampaign, listArticles, parseLawson, parseLawsonSale } from "./lawson.mjs";

const LAWSON_INDEX = "https://www.lawson.co.jp/recommend/index.html";
const LAWSON_ARTICLES = "https://www.lawson.co.jp/lab/tsuushin/";
const PROBE = 4;

/**
 * 패밀리마트의 「스팟」 캠페인 페이지는 기획이 끝나면 페이지 자체가 404 로 사라지고,
 * 다음 기획이 시작되면 같은 주소로 되돌아온다(주소가 아예 바뀌는 것과는 다르다 — 주소가
 * 바뀌었으면 404 가 아니라 그 새 주소로 고쳐야 한다. 예: famipay_1buy1_cp.html → famipay_1buy1.html).
 * 그러니 404 는 "가져오기에 실패했다"가 아니라 "지금은 이 기획이 없다"로 본다.
 * 그 밖의 실패(통신 오류·5xx 등)는 그대로 던져 알린다.
 */
async function loadSpot(parse, get, source) {
  try {
    return parse(await get(source.url), source.url);
  } catch (error) {
    if (/^404 /.test(String(error?.message ?? error))) return { url: source.url, periods: [], deals: [], notes: [] };
    throw error;
  }
}

/**
 * 로손 1+1 주소는 두 방식이 섞여 있다 — 통신 기사(주마다 제목·주소가 바뀜)와
 * 캠페인별 낱장 페이지(recommend/sale/detail, 그림 파일명의 "_1buy1_" 표로 찾음). 목록 한 번 받은 걸로 둘 다 찾는다.
 * 둘 다 0건이면 통신 최신 기사 몇 개를 직접 열어 1+1 꼭지가 있는지 본다.
 * 셋 다 0건이면 — 그 주는 그냥 1+1 이 없는 것이다. 가져오기 자체(get)가 던지는 것과는 다르다.
 */
export async function findLawson(get) {
  const indexHtml = await get(LAWSON_INDEX);
  const links = [
    ...findCampaignLinks(indexHtml, LAWSON_INDEX).map((l) => ({ ...l, kind: "article" })),
    ...findLawsonSales(indexHtml, LAWSON_INDEX).map((l) => ({ ...l, kind: "sale" })),
  ];
  if (links.length) return links;
  const recent = listArticles(await get(LAWSON_ARTICLES), LAWSON_ARTICLES).slice(0, PROBE);
  const probed = [];
  for (const url of recent) {
    if (hasCampaign(await get(url))) probed.push({ url, hash: "", kind: "article" });
  }
  return probed;
}

/** 기사가 여럿이면 한 출처로 합친다(기간·주의는 겹치지 않게) */
const mergeLawson = (parts) => ({
  ...parts[0],
  deals: parts.flatMap((p) => p.deals),
  periods: [...new Map(parts.flatMap((p) => p.periods).map((x) => [`${x.label}${x.value}`, x])).values()],
  notes: [...new Set(parts.flatMap((p) => p.notes))],
});

/**
 * 편의점별 1+1 출처. load(get)의 get(url)은 HTML 문자열을 돌려준다.
 * 로손만 두 단계 — 주마다 바뀌는 기사 URL을 findLawson으로 찾아 들어간다.
 */
export const SOURCES = [
  {
    id: "seven-plaichi",
    store: "seven",
    storeLabel: "セブン-イレブン",
    storeShort: "セブン",
    label: "プライチ",
    icon: "7",
    brand: "#ee7800",
    url: "https://www.sej.co.jp/cmp/plaichi.html",
    load: async (get, source) => parseSeven(await get(source.url), source.url),
  },
  {
    id: "familymart-receipt",
    store: "familymart",
    storeLabel: "ファミリーマート",
    storeShort: "ファミマ",
    label: "レシートで無料引換券",
    icon: "F",
    brand: "#00a94f",
    url: "https://www.family.co.jp/campaign/spot/2023_1buy1-receipt_cp.html",
    load: async (get, source) => loadSpot(parseReceipt, get, source),
  },
  {
    id: "familymart-famipay",
    store: "familymart",
    storeLabel: "ファミリーマート",
    storeShort: "ファミマ",
    label: "ファミペイ限定",
    icon: "F",
    brand: "#00a94f",
    url: "https://www.family.co.jp/campaign/spot/famipay_1buy1.html",
    load: async (get, source) => loadSpot(parseFamipay, get, source),
  },
  {
    id: "lawson-hapitoku",
    store: "lawson",
    storeLabel: "ローソン",
    storeShort: "ローソン",
    label: "1+1キャンペーン",
    icon: "L",
    brand: "#0068b7",
    url: LAWSON_INDEX,
    load: async (get) => {
      const links = await findLawson(get);
      /** 목록·최신 기사·낱장 페이지 어디에도 없으면 이번 주는 1+1 이 없는 것 — 자리를 못 찾은 것과 헷갈리지 않는다 */
      if (!links.length) return { url: LAWSON_INDEX, periods: [], deals: [], notes: [] };
      const parts = [];
      for (const link of links) {
        const html = await get(link.url);
        parts.push(link.kind === "sale" ? parseLawsonSale(html, link.url) : parseLawson(html, link.url, link.hash));
      }
      return mergeLawson(parts);
    },
  },
];

export const STORES = SOURCES.reduce((acc, s) => (
  acc.some((x) => x.id === s.store) ? acc : [...acc, { id: s.store, label: s.storeLabel, short: s.storeShort, icon: s.icon, brand: s.brand }]
), []);

export const findSource = (id) => SOURCES.find((s) => s.id === id);

export const meta = ({ load, ...rest }) => rest;
