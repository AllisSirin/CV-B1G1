import { test, expect } from "bun:test";
import { parseRange, dealStatus, formatRange, tidyPeriods } from "../public/period.mjs";

const today = (s) => new Date(s);

test("표기가 달라도 시작·끝 날짜를 읽는다", () => {
  const a = parseRange("9月24日（木）～10月7日（水）", today("2026-09-17"));
  expect(formatRange(a)).toBe("9/24~10/7");
  const b = parseRange("9/22火AM7:00～9/28月", today("2026-09-17"));
  expect(formatRange(b)).toBe("9/22~9/28");
  const c = parseRange("2026年9月15日(火) 0:00 ～ 9月21日(月) 23:59", today("2026-09-17"));
  expect(c.start.getFullYear()).toBe(2026);
  expect(formatRange(c)).toBe("9/15~9/21");
});

test("연말을 넘어가면 끝 날짜는 다음 해로 본다", () => {
  const r = parseRange("12月28日～1月5日", today("2026-12-30"));
  expect(r.start.getFullYear()).toBe(2026);
  expect(r.end.getFullYear()).toBe(2027);
});

test("날짜가 없으면 null", () => {
  expect(parseRange("なくなり次第終了")).toBeNull();
  expect(parseRange("")).toBeNull();
});

const periods = [
  { label: "発券期間", value: "9月17日（木）～9月23日（水）" },
  { label: "引換期間", value: "9月24日（木）～10月7日（水）" },
];

test("발권 기간이면 구매 안내, 교환 기간이면 교환 안내", () => {
  expect(dealStatus(periods, today("2026-09-18")).code).toBe("buy");
  expect(dealStatus(periods, today("2026-09-25")).code).toBe("get");
});

test("아직 시작 전이면 예정, 다 끝나면 종료", () => {
  expect(dealStatus(periods, today("2026-09-10")).code).toBe("soon");
  expect(dealStatus(periods, today("2026-10-08")).code).toBe("ended");
  expect(dealStatus(periods, today("2026-10-08")).live).toBe(false);
});

test("기간을 못 읽으면 감추지 않는다", () => {
  const s = dealStatus([{ label: "備考", value: "店舗により異なります" }], today("2026-09-18"));
  expect(s.code).toBe("unknown");
  expect(s.live).toBe(true);
});

test("같은 기간을 라벨만 바꿔 두 번 알려 주면 자세한 라벨 한 줄로 줄인다", () => {
  const lawson = [
    { label: "対象期間", value: "2026年9月15日(火) 0:00 ～ 9月21日(月) 23:59" },
    { label: "発券対象商品購入期間", value: "2026年9月15日(火) 0:00 ～ 9月21日(月) 23:59" },
    { label: "交換対象商品引換期間", value: "2026年9月22日(火) 0:00 ～ 9月28日(月) 23:59" },
  ];
  expect(tidyPeriods(lawson)).toEqual([
    { label: "発券対象商品購入期間", value: "2026年9月15日(火) 0:00 ～ 9月21日(月) 23:59" },
    { label: "交換対象商品引換期間", value: "2026年9月22日(火) 0:00 ～ 9月28日(月) 23:59" },
  ]);
});

test("기간이 다르면 지우지 않는다", () => {
  const famima = [
    { label: "キャンペーン期間", value: "9/15火～9/21月" },
    { label: "引換期間", value: "9/22火AM7:00～9/28月" },
  ];
  expect(tidyPeriods(famima)).toEqual(famima);
  expect(tidyPeriods([])).toEqual([]);
  expect(tidyPeriods(undefined)).toEqual([]);
});

test("구매와 교환이 같은 기간이면 둘 다 남긴다 — 지우면 뜻이 달라진다", () => {
  const both = [
    { label: "発券期間", value: "9月15日～9月21日" },
    { label: "引換期間", value: "9月15日～9月21日" },
  ];
  expect(tidyPeriods(both)).toHaveLength(2);
});
