import { parseReceipt, parseFamipay } from "./familymart.mjs";
import { parseSeven } from "./seven.mjs";
import { findCampaignLinks, hasCampaign, listArticles, parseLawson } from "./lawson.mjs";

const LAWSON_INDEX = "https://www.lawson.co.jp/recommend/index.html";
const LAWSON_ARTICLES = "https://www.lawson.co.jp/lab/tsuushin/";
const PROBE = 4;

/**
 * 로손 1+1 기사 주소는 주마다 바뀐다. 목록의 링크 제목으로 먼저 찾고,
 * 제목 표현이 바뀌어 못 찾으면 통신 최신 기사 몇 개를 직접 열어 1+1 꼭지가 있는지 본다.
 */
async function findLawson(get) {
  const links = findCampaignLinks(await get(LAWSON_INDEX), LAWSON_INDEX);
  if (links.length) return links;
  const recent = listArticles(await get(LAWSON_ARTICLES), LAWSON_ARTICLES).slice(0, PROBE);
  const probed = [];
  for (const url of recent) {
    if (hasCampaign(await get(url))) probed.push({ url, hash: "" });
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
    load: async (get, source) => parseReceipt(await get(source.url), source.url),
  },
  {
    id: "familymart-famipay",
    store: "familymart",
    storeLabel: "ファミリーマート",
    storeShort: "ファミマ",
    label: "ファミペイ限定",
    icon: "F",
    brand: "#00a94f",
    url: "https://www.family.co.jp/campaign/spot/famipay_1buy1_cp.html?recommend",
    load: async (get, source) => parseFamipay(await get(source.url), source.url),
  },
  {
    id: "lawson-hapitoku",
    store: "lawson",
    storeLabel: "ローソン",
    storeShort: "ローソン",
    label: "ハピとく祭 1+1",
    icon: "L",
    brand: "#0068b7",
    url: LAWSON_INDEX,
    load: async (get) => {
      const links = await findLawson(get);
      if (!links.length) throw new Error("로손 목록·최신 기사 어디에서도 1+1 기사를 찾지 못했습니다");
      const parts = [];
      for (const link of links) parts.push(parseLawson(await get(link.url), link.url, link.hash));
      return mergeLawson(parts);
    },
  },
];

export const STORES = SOURCES.reduce((acc, s) => (
  acc.some((x) => x.id === s.store) ? acc : [...acc, { id: s.store, label: s.storeLabel, short: s.storeShort, icon: s.icon, brand: s.brand }]
), []);

export const findSource = (id) => SOURCES.find((s) => s.id === id);

export const meta = ({ load, ...rest }) => rest;
