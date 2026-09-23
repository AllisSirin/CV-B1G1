import { test, expect } from "bun:test";
import { parseRange, dealStatus, formatRange, isDealClosed, tidyPeriods, withoutEnded } from "../public/period.mjs";

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

const ended = { label: "対象期間", value: "8月1日（金）～8月7日（木）" };
const soon = { label: "発券期間", value: "9月28日（月）～10月4日（日）" };
const live = { label: "発券期間", value: "9月14日（月）～9月23日（水）" };

test("끝난 딜은 내보내지 않는다 — 기획 전체가 끝났으면 그 출처의 딜이 모두 빠진다", () => {
  const r = { periods: [ended], deals: [{ id: 1 }, { id: 2 }] };
  expect(withoutEnded(r, today("2026-09-18")).deals).toEqual([]);
});

test("딜마다 기간이 다르면 끝난 것만 뺀다", () => {
  const r = { periods: [], deals: [{ id: "old", periods: [ended] }, { id: "now", periods: [live] }] };
  const out = withoutEnded(r, today("2026-09-18"));
  expect(out.deals.map((d) => d.id)).toEqual(["now"]);
});

test("시작 전(開始前)과 기간을 모르는 딜은 남긴다 — 곧 쓸 수 있거나 판단할 근거가 없다", () => {
  const r = { periods: [], deals: [{ id: "soon", periods: [soon] }, { id: "unknown", periods: [{ label: "備考", value: "なくなり次第終了" }] }] };
  const out = withoutEnded(r, today("2026-09-18"));
  expect(out.deals.map((d) => d.id)).toEqual(["soon", "unknown"]);
  expect(out).toBe(r);
});

test("発券 기간이 지나면 引換 기간이 남아 있어도 뺀다 — 지금 가서는 쿠폰을 받을 수 없다", () => {
  const r = { periods: [], deals: [{ id: "exchange-only", periods: [
    { label: "発券期間", value: "9月1日（火）～9月7日（月）" },
    { label: "引換期間", value: "9月8日（火）～9月21日（月）" },
  ] }] };
  expect(withoutEnded(r, today("2026-09-18")).deals).toEqual([]);
});

test("引換期間만 적힌 딜은 남긴다 — 発券 기간을 못 읽었을 뿐 지울 근거가 없다", () => {
  const r = { periods: [], deals: [{ id: "get-only", periods: [{ label: "引換期間", value: "9月8日（火）～9月21日（月）" }] }] };
  expect(withoutEnded(r, today("2026-09-18")).deals.map((d) => d.id)).toEqual(["get-only"]);
});

test("isDealClosed: 화면의 「いま使えるものだけ」도 withoutEnded 와 같은 기준을 쓴다", () => {
  const buyEndedGetOpen = [
    { label: "発券期間", value: "9月1日（火）～9月7日（月）" },
    { label: "引換期間", value: "9月8日（火）～9月21日（月）" },
  ];
  // dealStatus 만 보면 引換 기간이라 live:true 다 — 그걸 그대로 「사용 가능」으로 쓰면 안 된다.
  expect(dealStatus(buyEndedGetOpen, today("2026-09-18")).live).toBe(true);
  expect(isDealClosed(buyEndedGetOpen, today("2026-09-18"))).toBe(true);

  const buyLive = [
    { label: "発券期間", value: "9月17日（木）～9月23日（水）" },
    { label: "引換期間", value: "9月24日（木）～10月7日（水）" },
  ];
  expect(isDealClosed(buyLive, today("2026-09-18"))).toBe(false);

  const getOnly = [{ label: "引換期間", value: "9月8日（火）～9月21日（月）" }];
  expect(isDealClosed(getOnly, today("2026-09-18"))).toBe(false);
});
