import { test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCache } from "../lib/cache.mjs";

const tmpFile = () => join(mkdtempSync(join(tmpdir(), "konbini-")), "cache.json");

test("TTL 안이면 다시 가져오지 않는다", async () => {
  let calls = 0;
  const cache = createCache(tmpFile(), { ttl: 1000 });
  const load = async () => (++calls, { deals: [calls] });
  expect((await cache.resolve("a", load)).value.deals).toEqual([1]);
  expect((await cache.resolve("a", load)).value.deals).toEqual([1]);
  expect(calls).toBe(1);
});

test("refresh는 TTL을 무시한다", async () => {
  const cache = createCache(tmpFile(), { ttl: 1000 });
  await cache.resolve("a", async () => 1);
  expect((await cache.resolve("a", async () => 2, { refresh: true })).value).toBe(2);
});

test("TTL이 지나면 다시 가져온다", async () => {
  let clock = 0;
  const cache = createCache(tmpFile(), { ttl: 100, now: () => clock });
  await cache.resolve("a", async () => "old");
  clock = 500;
  expect((await cache.resolve("a", async () => "new")).value).toBe("new");
});

test("가져오기 실패 시 옛 캐시를 오류와 함께 내준다", async () => {
  const cache = createCache(tmpFile(), { ttl: 0 });
  await cache.resolve("a", async () => "old");
  const out = await cache.resolve("a", async () => { throw new Error("503"); });
  expect(out.value).toBe("old");
  expect(out.stale).toBe(true);
  expect(out.error).toContain("503");
});

test("캐시가 없으면 실패를 그대로 던진다", async () => {
  const cache = createCache(tmpFile(), { ttl: 0 });
  expect(cache.resolve("a", async () => { throw new Error("boom"); })).rejects.toThrow("boom");
});

test("파일에 남겨 다음 실행에서도 쓴다", async () => {
  const file = tmpFile();
  await createCache(file, { ttl: 10000 }).resolve("a", async () => "kept");
  expect(createCache(file, { ttl: 10000 }).get("a").value).toBe("kept");
  rmSync(file);
});
