import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { allowedImage, createImageStore, imageName, imageType } from "../lib/images.mjs";

const dir = () => mkdtempSync(join(tmpdir(), "konbini-img-"));

test("그림 이름은 주소마다 하나로 정해지고 확장자를 살린다", () => {
  const a = "https://www.sej.co.jp/i/450215.jpg";
  expect(imageName(a)).toBe(imageName(a));
  expect(imageName(a)).not.toBe(imageName("https://www.sej.co.jp/i/450216.jpg"));
  expect(imageName("https://www.family.co.jp/g/1.PNG")).toEndWith(".png");
  expect(imageName("https://www.lawson.co.jp/img?id=3")).toEndWith(".jpg");
  expect(imageType("a.png")).toBe("image/png");
});

test("허용한 곳의 그림만 받아온다", () => {
  expect(allowedImage("https://www.sej.co.jp/a.jpg")?.hostname).toBe("www.sej.co.jp");
  expect(allowedImage("https://evil.example/a.jpg")).toBeNull();
  expect(allowedImage("not a url")).toBeNull();
});

test("한 번 받은 그림은 디스크에서 내보낸다 — 원본을 다시 두드리지 않는다", async () => {
  let calls = 0;
  const store = createImageStore(dir(), {
    get: async () => (calls++, new Response(new Uint8Array([1, 2, 3]), { status: 200 })),
  });
  const url = "https://www.sej.co.jp/a.jpg";
  const first = await store.load(url);
  expect(first.cached).toBe(false);
  expect([...first.body]).toEqual([1, 2, 3]);
  const second = await store.load(url);
  expect(second.cached).toBe(true);
  expect(calls).toBe(1);
  expect(await store.load("https://evil.example/a.jpg")).toBeNull();
});
