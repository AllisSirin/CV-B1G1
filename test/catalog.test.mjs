import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCatalog, matchPrice, normalize, buildCatalog, annotateDeals } from "../lib/catalog.mjs";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const fixture = (name) => readFileSync(join(FIXTURES, name), "utf8");

test("세븐일레븐 상품 목록: 이름·세금 포함가·상품 링크", () => {
  const index = parseCatalog("seven", fixture("seven-catalog.html"), "https://www.sej.co.jp/products/a/ice_cream/");
  expect(index.length).toBeGreaterThan(5);
  const [first] = index;
  expect(first.name).toBe("ロッテ 爽 果実ころころりんご");
  expect(first.price.yen).toBe(194);
  expect(first.url).toBe("https://www.sej.co.jp/products/a/item/450677/");
});

test("훼미리마트 상품 목록: 세금 포함가를 쓴다", () => {
  const index = parseCatalog("familymart", fixture("familymart-catalog.html"), "https://www.family.co.jp/goods/snack.html");
  const item = index.find((e) => e.name === "ひざつき カレー揚げせん爆マヨ");
  expect(item.price.yen).toBe(170);
  expect(item.url).toBe("https://www.family.co.jp/goods/snack/5030606.html");
});

test("로손 상품 목록: 税込 표기 하나만 있는 경우", () => {
  const index = parseCatalog("lawson", fixture("lawson-catalog.html"), "https://www.lawson.co.jp/recommend/original/dessert/");
  const item = index.find((e) => e.name.startsWith("プレミアムロールケーキ"));
  expect(item.price.yen).toBe(275);
  expect(item.url).toContain("/recommend/original/detail/");
});

test("가격 없는 항목은 목록에서 뺀다", () => {
  const index = parseCatalog("lawson", '<li><p class="ttl">名前だけ</p></li>', "https://www.lawson.co.jp/");
  expect(index).toEqual([]);
});

const index = [
  { name: "ロッテ　爽　果実ころころりんご", price: { yen: 194, label: "180円（税込194.40円）" }, url: "https://x/1" },
  { name: "ブルボン　ひとくちルマンド", price: { yen: 138, label: "138円（税込149円）" }, url: "https://x/2" },
];

test("표기가 달라도 같은 상품이면 값을 찾는다", () => {
  const hit = matchPrice(index, { maker: "ブルボン", names: ["ひとくちルマンド"] });
  expect(hit.yen).toBe(138);
  expect(hit.url).toBe("https://x/2");
});

test("이름이 다르면 값을 붙이지 않는다", () => {
  expect(matchPrice(index, { names: ["ロッテ 爽 バニラ"] })).toBeNull();
  expect(matchPrice(index, { names: ["ガリガリ君"] })).toBeNull();
});

test("같은 계열 다른 맛에는 값을 붙이지 않는다", () => {
  const shelf = [{ name: "森永　大粒ラムネ　アイスボックスグレープフルーツ味", price: { yen: 173, label: "173円" }, url: "https://x/3" }];
  expect(matchPrice(shelf, { maker: "森永", names: ["大粒ラムネ"] })).toBeNull();
  expect(matchPrice(shelf, { maker: "森永", names: ["大粒ラムネ アイスボックスグレープフルーツ味"] }).yen).toBe(173);
});

test("너무 짧은 이름으로는 엉뚱한 값을 붙이지 않는다", () => {
  expect(matchPrice(index, { names: ["爽"] })).toBeNull();
});

test("전각·괄호·용량 차이를 무시한다", () => {
  expect(normalize("ロッテ　爽　バニラ　１４０ｍｌ")).toBe("ロッテ爽バニラ");
  expect(normalize("（数量限定）ひとくちルマンド")).toBe("数量限定ひとくちルマンド");
});

test("행사 데이터의 상품마다 값을 붙이고 못 찾으면 그대로 둔다", () => {
  const result = {
    deals: [{
      buy: { maker: "ブルボン", names: ["ひとくちルマンド"] },
      get: { items: [{ maker: "", names: ["ロッテ 爽 バニラ"] }, { maker: "", names: ["ロッテ 爽 果実ころころりんご"] }] },
    }],
  };
  annotateDeals(result, index);
  expect(result.deals[0].buy.price.yen).toBe(138);
  expect(result.deals[0].get.items[0].price).toBeUndefined();
  expect(result.deals[0].get.items[1].price.yen).toBe(194);
});

test("목록 여러 장을 합치고 중복 이름은 한 번만 남긴다", async () => {
  const pages = {
    "https://www.lawson.co.jp/recommend/original/dessert/": '<li><p class="ttl">A</p><p class="price"><span>100</span><span>円(税込)</span></p></li>',
    "https://www.lawson.co.jp/recommend/original/chilled/": '<li><p class="ttl">A</p><p class="price"><span>200</span><span>円(税込)</span></p></li><li><p class="ttl">B</p><p class="price"><span>300</span><span>円(税込)</span></p></li>',
  };
  const index = await buildCatalog("lawson", async (url) => pages[url] ?? "");
  expect(index.map((e) => [e.name, e.price.yen])).toEqual([["A", 100], ["B", 300]]);
});
