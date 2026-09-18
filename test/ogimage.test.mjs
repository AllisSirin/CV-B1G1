import { test, expect } from "bun:test";
import { iconCanvas, ogCanvas, pngBuffer } from "../scripts/ogimage.mjs";

const at = (g, x, y) => [...g.rgb.subarray((y * g.width + x) * 3, (y * g.width + x) * 3 + 3)];

test("미리보기 그림은 1200×630, 바탕은 밝고 가운데에 표가 있다", () => {
  const g = ogCanvas();
  expect([g.width, g.height]).toEqual([1200, 630]);
  expect(at(g, 5, 5)).toEqual([0xf6, 0xf7, 0xf9]);
  const marked = at(g, 600, 315).join() !== "246,247,249" || at(g, 405, 430).join() !== "246,247,249";
  expect(marked).toBe(true);
});

test("아이콘은 정사각이고 어두운 바탕에 흰 표다", () => {
  const g = iconCanvas(192);
  expect([g.width, g.height]).toEqual([192, 192]);
  expect(at(g, 3, 3)).toEqual([0x1c, 0x1f, 0x23]);
});

test("PNG 로 쓴다 — 서명과 크기가 맞는다", () => {
  const buf = pngBuffer(iconCanvas(64));
  expect([...buf.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(buf.subarray(12, 16).toString("ascii")).toBe("IHDR");
  expect(buf.readUInt32BE(16)).toBe(64);
  expect(buf.readUInt32BE(20)).toBe(64);
  expect(buf.subarray(-8, -4).toString("ascii")).toBe("IEND");
});
