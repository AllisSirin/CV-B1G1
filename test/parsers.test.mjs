import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseReceipt, parseFamipay } from "../lib/familymart.mjs";
import { parseSeven } from "../lib/seven.mjs";
import { findCampaignLinks, hasCampaign, listArticles, parseLawson } from "../lib/lawson.mjs";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const fixture = (name) => readFileSync(join(FIXTURES, name), "utf8");

test("훼미리마트 레시트: 기간과 사면/받으면 한 쌍을 뽑는다", () => {
  const r = parseReceipt(fixture("familymart-receipt.html"), "https://www.family.co.jp/campaign/spot/2023_1buy1-receipt_cp.html");
  expect(r.deals.length).toBe(6);
  expect(r.periods.map((p) => p.label)).toEqual(["キャンペーン期間", "引換期間"]);
  const first = r.deals[0];
  expect(first.buy.maker).toBe("伊藤園");
  expect(first.buy.names).toEqual(["タリーズ 無糖ラテ"]);
  expect(first.buy.volume).toBe("370ml");
  expect(first.buy.image).toStartWith("https://www.family.co.jp/content/dam/");
  expect(first.get.names).toEqual(["タリーズ 無糖ラテ"]);
});

test("훼미리마트 레시트: 여러 종류는 공통 접두어를 붙여 온전한 이름으로 만든다", () => {
  const r = parseReceipt(fixture("familymart-receipt.html"), "https://www.family.co.jp/x.html");
  const yogurt = r.deals[1];
  expect(yogurt.buy.anyone).toBe(true);
  expect(yogurt.buy.names).toEqual([
    "ブルガリアのむヨーグルト LB81 ONE SHOT",
    "ブルガリアのむヨーグルト ブルーベリー風味 LB81 ONE SHOT",
  ]);
  expect(yogurt.buy.notes).toEqual(["※沖縄県では実施しておりません。"]);
});

test("훼미리마트 파미페이: 상품별 배포·이용 기간을 함께 담는다", () => {
  const r = parseFamipay(fixture("familymart-famipay.html"), "https://www.family.co.jp/campaign/spot/famipay_1buy1_cp.html");
  expect(r.deals.length).toBe(2);
  const [first] = r.deals;
  expect(first.periods).toEqual([
    { label: "クーポン配信期間", value: "9月15日（火）～ 9月21日（月）" },
    { label: "クーポン利用期間", value: "9月22日（火）～ 9月28日（月）" },
  ]);
  expect(first.buy.maker).toBe("森永");
  expect(first.buy.names).toHaveLength(3);
  expect(first.get.image).toContain("260915_buy_get_01.jpg");
});

test("세븐일레븐: 발권중·교환중 두 탭을 모두 읽는다", () => {
  const r = parseSeven(fixture("seven.html"), "https://www.sej.co.jp/cmp/plaichi.html");
  expect(r.deals).toHaveLength(21);
  expect(r.deals.filter((d) => d.status === "ticketing")).toHaveLength(9);
  expect(r.deals.filter((d) => d.status === "exchange")).toHaveLength(12);
});

test("세븐일레븐: 상품 여러 개면 각각 이미지를 유지한다", () => {
  const r = parseSeven(fixture("seven.html"), "https://www.sej.co.jp/cmp/plaichi.html");
  const [first, second] = r.deals;
  expect(first.buy.names).toEqual(["ロッテ 雪見だいふく"]);
  expect(first.get.names).toEqual(["ロッテ 爽 バニラ"]);
  expect(first.periods).toEqual([
    { label: "発券期間", value: "9月17日（木）～9月23日（水）" },
    { label: "引換期間", value: "9月24日（木）～10月7日（水）" },
  ]);
  expect(second.buy.anyone).toBe(true);
  expect(second.buy.items).toHaveLength(5);
  expect(second.buy.items.every((i) => i.image.startsWith("https://www.sej.co.jp/library/"))).toBe(true);
});

test("로손: 목록에서 이번 주 기사 URL을 찾아낸다", () => {
  const links = findCampaignLinks(fixture("lawson-index.html"), "https://www.lawson.co.jp/recommend/index.html");
  expect(links).toHaveLength(1);
  expect(links[0].url).toBe("https://www.lawson.co.jp/lab/tsuushin/art/1531640_4659.html");
  expect(links[0].hash).toBe("promotion03");
});

test("로손: 「1本買うと1本もらえる」처럼 표기가 바뀌어도 찾는다", () => {
  const index = `
    <a href="/lab/tsuushin/art/1/1.html#promotion01">【ハピとく祭】1本買うと、1本もらえるキャンペーン！</a>
    <a href="/lab/tsuushin/art/2/2.html#promotion02">１個買うと１個無料でもらえる</a>
    <a href="/lab/tsuushin/art/3/3.html">2個買うと1個もらえる</a>`;
  expect(findCampaignLinks(index, "https://www.lawson.co.jp/recommend/index.html").map((l) => l.hash))
    .toEqual(["promotion01", "promotion02"]);
});

test("로손: 같은 주에 기사가 둘이면 둘 다 모은다", () => {
  const index = `
    <a href="/lab/tsuushin/art/1/1.html#promotion03">1個買うと1個もらえる（お菓子）</a>
    <a href="/lab/tsuushin/art/1/1.html#promotion03">1個買うと1個もらえる（お菓子）</a>
    <a href="/lab/tsuushin/art/9/9.html#promotion01">1本買うと1本もらえる（ドリンク）</a>`;
  const links = findCampaignLinks(index, "https://www.lawson.co.jp/recommend/index.html");
  expect(links.map((l) => l.url + "#" + l.hash)).toEqual([
    "https://www.lawson.co.jp/lab/tsuushin/art/1/1.html#promotion03",
    "https://www.lawson.co.jp/lab/tsuushin/art/9/9.html#promotion01",
  ]);
});

test("로손: 목록 제목이 바뀌면 최신 기사 주소를 새것부터 훑는다", () => {
  const hub = `
    <a href="/lab/tsuushin/art/1531640_4659.html">今週のローソン通信</a>
    <a href="/lab/tsuushin/art/1531639_4659.html#x">先週</a>
    <a href="/recommend/original/detail/1532075_1996.html">商品</a>`;
  expect(listArticles(hub, "https://www.lawson.co.jp/lab/tsuushin/")).toEqual([
    "https://www.lawson.co.jp/lab/tsuushin/art/1531640_4659.html",
    "https://www.lawson.co.jp/lab/tsuushin/art/1531639_4659.html",
  ]);
});

test("로손: 기사 본문만 보고도 1+1 꼭지가 있는지 안다", () => {
  expect(hasCampaign(fixture("lawson-article.html"))).toBe(true);
  expect(hasCampaign("<h2>新商品のお知らせ</h2>")).toBe(false);
});

test("로손: 1+1 꼭지만 잘라 발권·교환 상품을 나눈다", () => {
  const [link] = findCampaignLinks(fixture("lawson-index.html"), "https://www.lawson.co.jp/recommend/index.html");
  const r = parseLawson(fixture("lawson-article.html"), link.url, link.hash);
  expect(r.deals).toHaveLength(4);
  expect(r.url).toBe("https://www.lawson.co.jp/lab/tsuushin/art/1531640_4659.html#promotion03");
  expect(r.periods).toEqual([
    { label: "対象期間", value: "2026年9月15日(火) 0:00 ～ 9月21日(月) 23:59" },
    { label: "発券対象商品購入期間", value: "2026年9月15日(火) 0:00 ～ 9月21日(月) 23:59" },
    { label: "交換対象商品引換期間", value: "2026年9月22日(火) 0:00 ～ 9月28日(月) 23:59" },
  ]);
  const [first] = r.deals;
  expect(first.buy.maker).toBe("アサヒ");
  expect(first.buy.names).toEqual(["おいしい水 天然水 シンプルecoラベル 600ml", "green cola 500ml"]);
  expect(first.get.names).toEqual(["ウィルキンソンタンサン 1L", "ウィルキンソン タンサンレモン 1L"]);
  expect(r.deals[3].get.names).toHaveLength(2);
});

test("로손: 1+1 링크가 없으면 빈 목록", () => {
  expect(findCampaignLinks("<a href=\"/x.html\">新商品</a>", "https://www.lawson.co.jp/")).toEqual([]);
});
