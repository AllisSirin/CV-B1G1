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

/** 세븐 상품 검색 결과 한 장 (목록에 이름과 값이 함께 실려 온다) */
const listPage = (...items) =>
  items
    .map(({ name, yen, id = "450215" }) => `
      <div class="list_inner -item-code-${id}">
        <div class="detail">
          <div class="item_ttl"><p><a href="/products/a/item/${id}/">${name}</a></p></div>
          <div class="item_price"><p>${yen}円（税込${yen}円）</p></div>
        </div>
      </div>`)
    .join("");

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
  expect(searchUrl("seven", "雪見だいふく")).toContain("www.sej.co.jp/products/a/itemresult/");
  expect(searchUrl("familymart", "のむヨーグルト")).toContain("marsflag.com");
  expect(searchUrl("lawson", "コカ・コーラ")).toBeNull();
  expect(searchable("lawson")).toBe(false);
});

const deal = (names, maker = "") => ({
  deals: [{ buy: { maker, names }, get: { names: ["別の商品"] } }],
  store: "seven",
});

test("검색 결과 목록에서 값을 읽어 붙이고 캐시에 남긴다", async () => {
  const cache = createCache(tmpFile(), { ttl: Number.MAX_SAFE_INTEGER });
  const page = listPage({ name: "別のアイス", yen: 150 }, { name: "ロッテ 雪見だいふく", yen: 227 });
  const book = createPriceBook({ store: cache, fetchPage: async () => page, pause: 0 });
  const result = deal(["雪見だいふく"], "ロッテ");
  await book.fill([result]);
  expect(result.deals[0].buy.price.yen).toBe(227);
  expect(result.deals[0].buy.price.url).toBe("https://www.sej.co.jp/products/a/item/450215/");

  const again = deal(["雪見だいふく"], "ロッテ");
  book.attach(again);
  expect(again.deals[0].buy.price.yen).toBe(227);
});

test("규격만 덧붙은 이름은 근사 일치로 값을 읽고 그렇다고 표시한다", async () => {
  const cache = createCache(tmpFile(), { ttl: Number.MAX_SAFE_INTEGER });
  const page = listPage({ name: "ロッテ 雪見だいふく カップ", yen: 227 });
  const book = createPriceBook({ store: cache, fetchPage: async () => page, pause: 0 });
  const result = deal(["雪見だいふく"], "ロッテ");
  await book.fill([result]);
  expect(result.deals[0].buy.price.yen).toBe(227);
  expect(result.deals[0].buy.price.approx).toBe(true);
  expect(result.deals[0].buy.price.name).toBe("ロッテ 雪見だいふく カップ");
});

test("짧은 이름은 근사 일치를 쓰지 않는다 — 맛이 다른 상품에 값이 붙으면 안 된다", async () => {
  const cache = createCache(tmpFile(), { ttl: Number.MAX_SAFE_INTEGER });
  const page = listPage({ name: "大粒ラムネ アイスボックス味", yen: 227 });
  const book = createPriceBook({ store: cache, fetchPage: async () => page, pause: 0 });
  const result = deal(["大粒ラムネ"]);
  await book.fill([result]);
  expect(result.deals[0].buy.price).toBeUndefined();
});

test("묶음(５食パック)은 근사 일치로도 인정하지 않는다", async () => {
  const cache = createCache(tmpFile(), { ttl: Number.MAX_SAFE_INTEGER });
  const page = listPage({ name: "マルちゃん正麺 醤油味 ５食パック", yen: 734 });
  const book = createPriceBook({ store: cache, fetchPage: async () => page, pause: 0 });
  const result = deal(["マルちゃん正麺 醤油味"]);
  await book.fill([result]);
  expect(result.deals[0].buy.price).toBeUndefined();
});

test("우리가 아는 이름이 더 길면 근사 일치로 인정하지 않는다 — 다른 상품이다", async () => {
  const cache = createCache(tmpFile(), { ttl: Number.MAX_SAFE_INTEGER });
  const page = listPage({ name: "サッポロ一番 みそラーメン", yen: 147 });
  const book = createPriceBook({ store: cache, fetchPage: async () => page, pause: 0 });
  const result = deal(["サッポロ一番 みそラーメン味〆のご飯"]);
  await book.fill([result]);
  expect(result.deals[0].buy.price).toBeUndefined();
});

test("규격이 덧붙은 상품(ミニどんぶり)은 근사 일치로도 인정하지 않는다", async () => {
  const cache = createCache(tmpFile(), { ttl: Number.MAX_SAFE_INTEGER });
  const page = listPage({ name: "サッポロ一番 塩らーめんミニどんぶり", yen: 168 });
  const book = createPriceBook({ store: cache, fetchPage: async () => page, pause: 0 });
  const result = deal(["サッポロ一番 塩らーめん"]);
  await book.fill([result]);
  expect(result.deals[0].buy.price).toBeUndefined();
});

test("다른 상품만 나오면 값을 붙이지 않는다", async () => {
  const cache = createCache(tmpFile(), { ttl: Number.MAX_SAFE_INTEGER });
  const page = listPage({ name: "ロッテ 雪見だいふく", yen: 227 });
  const book = createPriceBook({ store: cache, fetchPage: async () => page, pause: 0 });
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
      const kw = decodeURIComponent(/key=([^&]*)/.exec(url)?.[1] ?? "").replace(/\s+/g, "");
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

test("상대가 막으면(403) 「값 없음」으로 굳히지 않고 쉬었다 다시 찾는다", async () => {
  const cache = createCache(tmpFile(), { ttl: Number.MAX_SAFE_INTEGER });
  let calls = 0;
  let clock = 0;
  const book = createPriceBook({
    store: cache,
    fetchPage: async () => {
      calls += 1;
      throw new Error("403");
    },
    pause: 0,
    now: () => clock,
  });
  const one = () => ({ store: "seven", deals: [{ buy: { names: ["幻の商品"] }, get: { names: ["別の商品"] } }] });
  await book.fill([one()]);
  expect(calls).toBe(1);

  await book.fill([one()]);
  expect(calls).toBe(1);

  clock += 11 * 60 * 1000;
  await book.fill([one()]);
  expect(calls).toBe(2);
});

test("같은 낱말을 쓰는 상품들은 목록 한 장으로 함께 해결한다", async () => {
  const cache = createCache(tmpFile(), { ttl: Number.MAX_SAFE_INTEGER });
  const page = listPage(
    { name: "カップヌードル チリトマト", yen: 268, id: "340438" },
    { name: "カップヌードル シーフード", yen: 168, id: "341636" },
  );
  let calls = 0;
  const book = createPriceBook({ store: cache, fetchPage: async () => (calls += 1, page), pause: 0 });
  const result = {
    store: "seven",
    deals: [{ buy: { names: ["カップヌードル チリトマト"] }, get: { names: ["カップヌードル シーフード"] } }],
  };
  await book.fill([result]);
  expect(result.deals[0].buy.price.yen).toBe(268);
  expect(result.deals[0].get.price.yen).toBe(168);
  expect(calls).toBe(1);
});

test("검색 결과에 값이 없는 매장은 상세 페이지를 열어 읽는다", async () => {
  const cache = createCache(tmpFile(), { ttl: Number.MAX_SAFE_INTEGER });
  const pages = {
    [searchUrl("familymart", "ひざつき")]: JSON.stringify({
      organic: { docs: [{ url: "https://www.family.co.jp/goods/snack/5030606.html" }] },
    }),
    "https://www.family.co.jp/goods/snack/5030606.html": fixture("familymart-item.html"),
  };
  const book = createPriceBook({ store: cache, fetchPage: async (u) => pages[u] ?? "", pause: 0 });
  const result = {
    store: "familymart",
    deals: [{ buy: { names: ["ひざつき カレー揚げせん爆マヨ"] }, get: { names: ["別の商品"] } }],
  };
  await book.fill([result]);
  expect(result.deals[0].buy.price.yen).toBe(170);
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

test("내려간 딜의 값은 버리고, 같은 상품이 돌아오면 다시 찾는다", async () => {
  const cache = createCache(tmpFile(), { ttl: Number.MAX_SAFE_INTEGER });
  cache.set("seven|むかしの商品", { yen: 100 });
  cache.set("seven|いまの商品", { yen: 200 });
  let calls = 0;
  const book = createPriceBook({ store: cache, fetchPage: async () => (calls += 1, ""), pause: 0 });
  const live = () => ({ store: "seven", deals: [{ buy: { names: ["いまの商品"] }, get: { names: ["ほかの商品"] } }] });

  expect(book.prune([live()])).toBe(1);
  expect(cache.get("seven|むかしの商品")).toBeUndefined();
  expect(cache.get("seven|いまの商品").value.yen).toBe(200);

  await book.fill([{ store: "seven", deals: [{ buy: { names: ["むかしの商品"] }, get: { names: ["いまの商品"] } }] }]);
  expect(calls).toBeGreaterThan(0);
});

test("가져오기에 실패했거나 딜이 없는 매장의 값은 버리지 않는다", () => {
  const cache = createCache(tmpFile(), { ttl: Number.MAX_SAFE_INTEGER });
  cache.set("seven|むかしの商品", { yen: 100 });
  cache.set("familymart|ほかの商品", { yen: 300 });
  const book = createPriceBook({ store: cache, fetchPage: async () => "", pause: 0 });
  expect(book.prune([{ store: "seven", deals: [], error: "403" }, { store: "familymart", deals: [] }])).toBe(0);
  expect(cache.get("seven|むかしの商品").value.yen).toBe(100);
  expect(cache.get("familymart|ほかの商品").value.yen).toBe(300);
});

test("한 매장이 막혀도 다른 매장은 계속 찾는다", async () => {
  const cache = createCache(tmpFile(), { ttl: Number.MAX_SAFE_INTEGER });
  const item = "https://www.family.co.jp/goods/snack/5030606.html";
  const asked = [];
  const book = createPriceBook({
    store: cache,
    fetchPage: async (url) => {
      asked.push(url);
      if (url.includes("sej.co.jp")) throw new Error("403");
      return url === item ? fixture("familymart-item.html") : JSON.stringify({ organic: { docs: [{ url: item }] } });
    },
    pause: 0,
  });
  const seven = { store: "seven", deals: [{ buy: { names: ["幻の商品"] }, get: { names: ["別の商品"] } }] };
  const familymart = {
    store: "familymart",
    deals: [{ buy: { names: ["ひざつき カレー揚げせん爆マヨ"] }, get: { names: ["別の商品"] } }],
  };

  await book.fill([seven, familymart]);
  expect(seven.deals[0].buy.price).toBeUndefined();
  expect(familymart.deals[0].buy.price.yen).toBe(170);
  /** 막힌 매장에는 한 번만 묻고 그만둔다 */
  expect(asked.filter((url) => url.includes("sej.co.jp")).length).toBe(1);
});

test("한 매장이 몫을 다 써도 다른 매장 몫은 남는다", async () => {
  const cache = createCache(tmpFile(), { ttl: Number.MAX_SAFE_INTEGER });
  const asked = [];
  const book = createPriceBook({ store: cache, fetchPage: async (url) => (asked.push(url), ""), budget: 1, pause: 0 });
  const many = (store) => ({
    store,
    deals: [1, 2, 3].map((n) => ({ buy: { names: [`商品${n}番`] }, get: { names: [`景品${n}番`] } })),
  });
  await book.fill([many("seven"), many("familymart")]);
  expect(asked.filter((url) => url.includes("sej.co.jp")).length).toBe(1);
  expect(asked.filter((url) => url.includes("marsflag.com")).length).toBe(1);
});
