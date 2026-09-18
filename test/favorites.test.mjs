import { test, expect } from "bun:test";
import { createFavorites, dealKey, favKey } from "../public/favorites.mjs";

const fake = (init = {}) => ({
  data: { ...init },
  getItem(k) { return this.data[k] ?? null; },
  setItem(k, v) { this.data[k] = v; },
});

const item = (...names) => ({ names });

test("표기가 달라도 같은 상품으로 본다", () => {
  expect(favKey("ロッテ　雪見だいふく")).toBe(favKey("ロッテ雪見だいふく"));
  expect(favKey("ｉｎバー")).toBe(favKey("inバー"));
  expect(favKey("コカ・コーラ ゼロ")).toBe(favKey("コカコーラゼロ"));
  expect(favKey("")).toBe("");
  expect(favKey("A")).not.toBe(favKey("B"));
});

test("딜 번호는 주마다 사라지므로 안에 든 상품 이름으로 딜을 알아본다", () => {
  const deal = { buy: [item("ロッテ　雪見だいふく")], get: [item("爽 バニラ")] };
  const same = { buy: [item("ロッテ雪見だいふく", "ほかの表記")], get: [item("爽バニラ")] };
  expect(dealKey(deal)).toBe(dealKey(same));
  expect(dealKey(deal)).toBeTruthy();
});

test("짝이 바뀌면 다른 딜이다 — 사는 쪽과 받는 쪽을 나눠 센다", () => {
  const a = { buy: [item("A")], get: [item("B")] };
  const b = { buy: [item("B")], get: [item("A")] };
  expect(dealKey(a)).not.toBe(dealKey(b));

  const one = { buy: [item("A")], get: [item("B")] };
  const many = { buy: [item("A")], get: [item("B"), item("C")] };
  expect(dealKey(one)).not.toBe(dealKey(many));
});

test("이름이 없는 딜은 담을 수 없다", () => {
  expect(dealKey({ buy: [item("")], get: [] })).toBe("");
  expect(dealKey({})).toBe("");
  expect(dealKey()).toBe("");
});

test("담고 빼고, 브라우저에 남긴다", () => {
  const store = fake();
  const key = dealKey({ buy: [item("雪見だいふく")], get: [item("爽")] });
  const fav = createFavorites(store);
  expect(fav.toggle(key)).toBe(true);
  expect(fav.has(key)).toBe(true);
  expect(fav.size).toBe(1);

  expect(createFavorites(store).has(key)).toBe(true);

  expect(fav.toggle(key)).toBe(false);
  expect(fav.size).toBe(0);
  expect(store.data["konbini.favorites.v2"]).toBe("[]");
});

test("빈 키는 담지 않고, 저장을 막아 둔 브라우저에서도 죽지 않는다", () => {
  const blocked = { getItem() { throw new Error("no"); }, setItem() { throw new Error("no"); } };
  const fav = createFavorites(blocked);
  expect(fav.toggle("")).toBe(false);
  expect(fav.has("")).toBe(false);
  expect(fav.toggle("a>b")).toBe(true);
  expect(fav.size).toBe(1);
});
