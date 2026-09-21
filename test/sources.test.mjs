import { test, expect } from "bun:test";
import { findLawson, SOURCES } from "../lib/sources.mjs";

const famipay = SOURCES.find((s) => s.id === "familymart-famipay");
const receipt = SOURCES.find((s) => s.id === "familymart-receipt");

const lawson = SOURCES.find((s) => s.id === "lawson-hapitoku");

test("로손: 목록·최신 기사 어디에도 1+1 이 없으면 빈 딜을 낸다(오류가 아니다)", async () => {
  const result = await lawson.load(async () => "<a href=\"/x.html\">新商品のお知らせ</a>");
  expect(result).toEqual({ url: "https://www.lawson.co.jp/recommend/index.html", periods: [], deals: [], notes: [] });
});

test("로손: 가져오기 자체가 실패하면(통신 오류) 그대로 던진다 — 캠페인 없음과 다르다", async () => {
  const get = async () => { throw new Error("network down"); };
  await expect(lawson.load(get)).rejects.toThrow("network down");
});

test("findLawson: 목록에 없으면 최신 기사를 몇 개 열어 본다", async () => {
  const pages = {
    "https://www.lawson.co.jp/recommend/index.html": "<a href=\"/x.html\">新商品のお知らせ</a>",
    "https://www.lawson.co.jp/lab/tsuushin/": '<a href="/lab/tsuushin/art/123-456.html">記事</a>',
    "https://www.lawson.co.jp/lab/tsuushin/art/123-456.html": "<h2>1個買うと1個もらえる</h2>",
  };
  const links = await findLawson(async (url) => pages[url] ?? "");
  expect(links).toEqual([{ url: "https://www.lawson.co.jp/lab/tsuushin/art/123-456.html", hash: "", kind: "article" }]);
});

test("findLawson: 목록의 낱장 캠페인 페이지(recommend/sale/detail)도 그림 파일명의 _1buy1_ 표로 찾는다", async () => {
  const indexHtml = `<a href="/recommend/sale/detail/999_3677.html">
    <div class="img"><img src="/recommend/__icsFiles/x/20260922_1buy1_cola_e.jpg"></div>
    <p class="ttl">飲料1本もらえるキャンペーン</p></a>
    <a href="/recommend/sale/detail/111_3677.html">
    <div class="img"><img src="/recommend/__icsFiles/x/other_sale.jpg"></div>
    <p class="ttl">関係ないセール</p></a>`;
  const links = await findLawson(async (url) => (url === "https://www.lawson.co.jp/recommend/index.html" ? indexHtml : ""));
  expect(links).toEqual([
    { url: "https://www.lawson.co.jp/recommend/sale/detail/999_3677.html", hash: "", title: "飲料1本もらえるキャンペーン", kind: "sale" },
  ]);
});

test("패미마 ファミペイ限定: 캠페인 페이지가 404 면 오류가 아니라 빈 딜을 낸다(기획이 끝나 페이지가 사라진 것)", async () => {
  const get = async (url) => { throw new Error(`404 ${url}`); };
  const result = await famipay.load(get, famipay);
  expect(result).toEqual({ url: famipay.url, periods: [], deals: [], notes: [] });
});

test("패미마 レシート: 캠페인 페이지가 404 면 오류가 아니라 빈 딜을 낸다", async () => {
  const get = async (url) => { throw new Error(`404 ${url}`); };
  const result = await receipt.load(get, receipt);
  expect(result).toEqual({ url: receipt.url, periods: [], deals: [], notes: [] });
});

test("패미마: 404 가 아닌 실패(통신 오류·5xx)는 그대로 던진다", async () => {
  const get = async () => { throw new Error("500 https://www.family.co.jp/..."); };
  await expect(famipay.load(get, famipay)).rejects.toThrow("500");
});
