import { test, expect } from "bun:test";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { imageName } from "../lib/images.mjs";
import { absolutizeMeta, localizeImages, pruneImages, usedImages } from "../scripts/snapshot.mjs";

const results = () => [{
  store: "seven",
  deals: [{
    banner: "https://www.sej.co.jp/mv.jpg",
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

test("지금 하는 딜이 쓰는 그림만 남긴다 — 배너도 함께 지킨다", async () => {
  const dir = mkdtempSync(join(tmpdir(), "konbini-img-"));
  const kept = ["https://www.sej.co.jp/a.jpg", "https://www.sej.co.jp/b.jpg", "https://www.sej.co.jp/mv.jpg"];
  const gone = "https://www.sej.co.jp/old.jpg";
  for (const url of [...kept, gone]) writeFileSync(join(dir, imageName(url)), "x");

  expect(await pruneImages(dir, usedImages({ results: results() }))).toBe(1);
  expect(readdirSync(dir).sort()).toEqual(kept.map(imageName).sort());
});

test("그림 폴더가 아직 없어도 넘어간다", async () => {
  expect(await pruneImages(join(tmpdir(), "konbini-nope-지금없음"), new Set())).toBe(0);
});
