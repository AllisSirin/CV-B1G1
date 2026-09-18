import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { parseItemPage } from "../lib/itempage.mjs";
import { extractLinks, searchUrl, searchable, webSearchPage } from "../lib/lookup.mjs";
import { createPriceBook } from "../lib/price.mjs";
import { createCache } from "../lib/cache.mjs";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const fixture = (name) => readFileSync(join(FIXTURES, name), "utf8");
const tmpFile = () => join(mkdtempSync(join(tmpdir(), "konbini-price-")), "prices.json");

test("세븐 상세 페이지: 목록에 없는 상품도 세금 포함가를 읽는다", () => {
  const item = parseItemPage("seven", fixture("seven-item.html"), "https://www.sej.co.jp/products/a/item/450215/");
  expect(item.name).toBe("ロッテ 雪見だいふく");
  expect(item.price.yen).toBe(227);
});

test("훼미리마트 상세 페이지: 통상가격을 읽는다", () => {
  const item = parseItemPage("familymart", fixture("familymart-item.html"), "https://www.family.co.jp/goods/snack/5030606.html");
  expect(item.name).toBe("ひざつき カレー揚げせん爆マヨ");
  expect(item.price.yen).toBe(170);
});

test("로손 상세 페이지: 관련 상품이 아니라 본 상품 값을 읽는다", () => {
  const item = parseItemPage("lawson", fixture("lawson-item.html"), "https://www.lawson.co.jp/recommend/original/detail/1532075_1996.html");
  expect(item.name).toBe("プレミアムロールケーキ 栗粉");
  expect(item.price.yen).toBe(275);
});

test("값이 없는 페이지는 버린다", () => {
  expect(parseItemPage("seven", "<h1>名前だけ</h1>", "https://x/")).toBeNull();
});

test("검색 결과에서 공식 상품 페이지만 골라낸다", () => {
  const html = `
    <div class="uri_area"><a href="?go=xxxx&rid=1">https://www.sej.co.jp/products/a/item/450215/</a></div>
    <a href="https://www.sej.co.jp/cmp/plaichi.html">キャンペーン</a>
    <a href="https://example.com/products/a/item/1/">偽物</a>`;
  expect(extractLinks(html, "seven")).toEqual(["https://www.sej.co.jp/products/a/item/450215/"]);
  expect(extractLinks(html, "familymart")).toEqual([]);
});

test("세븐은 지역별 주소도 받아들이고 같은 상품은 하나로 줄인다", () => {
  const html = `
    <div class="uri_area">https://www.sej.co.jp/products/a/item/340972/chugoku/</div>
    <div class="uri_area">https://www.sej.co.jp/products/a/item/340972/kanto/</div>
    <div class="uri_area">https://www.sej.co.jp/products/a/item/480112/</div>`;
  expect(extractLinks(html, "seven")).toEqual([
    "https://www.sej.co.jp/products/a/item/340972/chugoku/",
    "https://www.sej.co.jp/products/a/item/480112/",
  ]);
});

test("훼미리마트는 화면 대신 JSON 검색을 읽는다", () => {
  const json = JSON.stringify({ organic: { docs: [
    { url: "https://www.family.co.jp/goods/drink/1730906.html" },
    { url: "https://www.family.co.jp/goods/famimaru.html" },
  ] } });
  expect(extractLinks(json, "familymart")).toEqual(["https://www.family.co.jp/goods/drink/1730906.html"]);
});

test("검색은 각 편의점 자기 사이트에서 한다", () => {
  expect(searchUrl("seven", "雪見だいふく")).toContain("www.sej.co.jp/search.html");
  expect(searchUrl("familymart", "のむヨーグルト")).toContain("marsflag.com");
  expect(searchUrl("lawson", "コカ・コーラ")).toBeNull();
  expect(searchable("lawson")).toBe(false);
});

const deal = (names, maker = "") => ({
  deals: [{ buy: { maker, names }, get: { names: ["別の商品"] } }],
  store: "seven",
});

test("찾은 값을 붙이고 캐시에 남긴다", async () => {
  const cache = createCache(tmpFile(), { ttl: Number.MAX_SAFE_INTEGER });
  const pages = {
    [searchUrl("seven", "雪見だいふく")]: '<a href="https://www.sej.co.jp/products/a/item/450215/">x</a>',
    "https://www.sej.co.jp/products/a/item/450215/": fixture("seven-item.html"),
  };
  const book = createPriceBook({ store: cache, fetchPage: async (u) => pages[u] ?? "", pause: 0 });
  const result = deal(["雪見だいふく"], "ロッテ");
  await book.fill([result]);
  expect(result.deals[0].buy.price.yen).toBe(227);

  const again = deal(["雪見だいふく"], "ロッテ");
  book.attach(again);
  expect(again.deals[0].buy.price.yen).toBe(227);
});

test("규격만 덧붙은 이름은 근사 일치로 값을 읽고 그렇다고 표시한다", async () => {
  const cache = createCache(tmpFile(), { ttl: Number.MAX_SAFE_INTEGER });
  const page = fixture("seven-item.html").replace("</h1>", " カップ</h1>");
  const pages = {
    [searchUrl("seven", "雪見だいふく")]: "https://www.sej.co.jp/products/a/item/450215/",
    "https://www.sej.co.jp/products/a/item/450215/": page,
  };
  const book = createPriceBook({ store: cache, fetchPage: async (u) => pages[u] ?? "", pause: 0 });
  const result = deal(["雪見だいふく"], "ロッテ");
  await book.fill([result]);
  expect(result.deals[0].buy.price.yen).toBe(227);
  expect(result.deals[0].buy.price.approx).toBe(true);
  expect(result.deals[0].buy.price.name).toBe("ロッテ 雪見だいふく カップ");
});

test("짧은 이름은 근사 일치를 쓰지 않는다 — 맛이 다른 상품에 값이 붙으면 안 된다", async () => {
  const cache = createCache(tmpFile(), { ttl: Number.MAX_SAFE_INTEGER });
  const page = fixture("seven-item.html").replace(/<h1([^>]*)>[\s\S]*?<\/h1>/, "<h1$1>大粒ラムネ アイスボックス味</h1>");
  const pages = {
    [searchUrl("seven", "大粒ラムネ")]: "https://www.sej.co.jp/products/a/item/450215/",
    "https://www.sej.co.jp/products/a/item/450215/": page,
  };
  const book = createPriceBook({ store: cache, fetchPage: async (u) => pages[u] ?? "", pause: 0 });
  const result = deal(["大粒ラムネ"]);
  await book.fill([result]);
  expect(result.deals[0].buy.price).toBeUndefined();
});

test("묶음(５食パック)은 근사 일치로도 인정하지 않는다", async () => {
  const cache = createCache(tmpFile(), { ttl: Number.MAX_SAFE_INTEGER });
  const page = fixture("seven-item.html").replace(/<h1([^>]*)>[\s\S]*?<\/h1>/, "<h1$1>マルちゃん正麺 醤油味 ５食パック</h1>");
  const pages = {
    [searchUrl("seven", "マルちゃん正麺 醤油味")]: "https://www.sej.co.jp/products/a/item/450215/",
    "https://www.sej.co.jp/products/a/item/450215/": page,
  };
  const book = createPriceBook({ store: cache, fetchPage: async (u) => pages[u] ?? "", pause: 0 });
  const result = deal(["マルちゃん正麺 醤油味"]);
  await book.fill([result]);
  expect(result.deals[0].buy.price).toBeUndefined();
});

test("다른 상품 페이지가 나오면 값을 붙이지 않는다", async () => {
  const cache = createCache(tmpFile(), { ttl: Number.MAX_SAFE_INTEGER });
  const pages = {
    [searchUrl("seven", "爽 バニラ")]: '<a href="https://www.sej.co.jp/products/a/item/450215/">x</a>',
    "https://www.sej.co.jp/products/a/item/450215/": fixture("seven-item.html"),
  };
  const book = createPriceBook({ store: cache, fetchPage: async (u) => pages[u] ?? "", pause: 0 });
  const result = deal(["爽 バニラ"], "ロッテ");
  await book.fill([result]);
  expect(result.deals[0].buy.price).toBeUndefined();
});

test("찾는 규칙이 바뀌면 지난 실패는 잊고 다시 찾는다", async () => {
  const cache = createCache(tmpFile(), { ttl: Number.MAX_SAFE_INTEGER });
  cache.set("seven|幻の商品", { rules: 1 });
  let calls = 0;
  const book = createPriceBook({ store: cache, fetchPage: async () => (calls++, ""), pause: 0 });
  await book.fill([{ store: "seven", deals: [{ buy: { names: ["幻の商品"] }, get: { names: ["別の商品"] } }] }]);
  expect(calls).toBeGreaterThan(0);
});

test("한 번에 정해진 개수의 상품만 찾는다", async () => {
  const cache = createCache(tmpFile(), { ttl: Number.MAX_SAFE_INTEGER });
  const asked = new Set();
  const book = createPriceBook({
    store: cache,
    fetchPage: async (url) => {
      const kw = decodeURIComponent(/kw=([^&]*)/.exec(url)?.[1] ?? "").replace(/\s+/g, "");
      if (kw) asked.add(kw);
      return "";
    },
    budget: 2,
    pause: 0,
  });
  const many = {
    store: "seven",
    deals: [1, 2, 3, 4, 5].map((n) => ({ buy: { names: [`商品${n}番`] }, get: { names: [`景品${n}番`] } })),
  };
  await book.fill([many]);
  expect(asked.size).toBe(2);
});

test("못 찾은 상품은 잠시 다시 찾지 않는다", async () => {
  const cache = createCache(tmpFile(), { ttl: Number.MAX_SAFE_INTEGER });
  let calls = 0;
  const book = createPriceBook({ store: cache, fetchPage: async () => (calls++, ""), pause: 0 });
  const one = () => ({ store: "seven", deals: [{ buy: { names: ["幻の商品"] }, get: { names: ["別の商品"] } }] });
  await book.fill([one()]);
  const first = calls;
  await book.fill([one()]);
  expect(calls).toBe(first);
});

test("값을 찾을 수 없는 상품은 제조사·상품명·価格 웹 검색으로 보낸다", () => {
  const cache = createCache(tmpFile(), { ttl: Number.MAX_SAFE_INTEGER });
  const book = createPriceBook({ store: cache, fetchPage: async () => "" });
  const result = { store: "lawson", deals: [{ buy: { maker: "コカ・コーラ", names: ["コカ・コーラゼロ 500ml"] }, get: { names: ["別の商品"] } }] };
  book.hint(result);
  expect(result.deals[0].buy.priceSearch).toBe(webSearchPage("コカ・コーラ コカ・コーラゼロ 500ml 価格"));
  expect(result.deals[0].buy.priceSearch).toStartWith("https://www.google.com/search?q=");
  expect(result.deals[0].get.priceSearch).toBe(webSearchPage("別の商品 価格"));
});

test("검색할 곳이 없는 매장은 찾으러 나가지 않는다", async () => {
  const cache = createCache(tmpFile(), { ttl: Number.MAX_SAFE_INTEGER });
  let calls = 0;
  const book = createPriceBook({ store: cache, fetchPage: async () => (calls++, ""), pause: 0 });
  await book.fill([{ store: "lawson", deals: [{ buy: { names: ["コカ・コーラゼロ 500ml"] }, get: { names: ["別の商品"] } }] }]);
  expect(calls).toBe(0);
});
