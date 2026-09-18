import { test, expect } from "bun:test";
import { absolutizeMeta, localizeImages } from "../scripts/snapshot.mjs";

const results = () => [{
  store: "seven",
  deals: [{
    buy: { items: [{ image: "https://www.sej.co.jp/a.jpg" }, { image: "https://www.sej.co.jp/a.jpg" }] },
    get: { image: "https://www.sej.co.jp/b.jpg" },
  }],
}];

test("같은 그림은 한 번만 받고 상대 주소로 바꾼다", async () => {
  const asked = [];
  const data = results();
  const saved = await localizeImages(data, async (url) => (asked.push(url), `img/${asked.length}.jpg`));
  expect(asked).toEqual(["https://www.sej.co.jp/a.jpg", "https://www.sej.co.jp/b.jpg"]);
  expect(saved).toBe(2);
  expect(data[0].deals[0].buy.items.map((i) => i.image)).toEqual(["img/1.jpg", "img/1.jpg"]);
  expect(data[0].deals[0].get.image).toBe("img/2.jpg");
});

test("못 받은 그림은 빈 값으로 둔다 — 깨진 그림을 보이지 않는다", async () => {
  const data = results();
  expect(await localizeImages(data, async () => null)).toBe(0);
  expect(data[0].deals[0].get.image).toBe("");
});

const page = `<meta property="og:image" content="./og.png" />\n<meta property="og:type" content="website" />`;

test("올릴 주소를 알면 미리보기 그림·주소를 절대 주소로 바꾼다", () => {
  const out = absolutizeMeta(page, "https://me.github.io/konbini");
  expect(out).toContain('content="https://me.github.io/konbini/og.png"');
  expect(out).toContain('<meta property="og:url" content="https://me.github.io/konbini/" />');
  expect(absolutizeMeta(page, "https://me.github.io/konbini/")).toContain("konbini/og.png");
});

test("주소를 모르면 상대 주소를 그대로 둔다", () => {
  expect(absolutizeMeta(page, "")).toBe(page);
  expect(absolutizeMeta(page, undefined)).toBe(page);
});
