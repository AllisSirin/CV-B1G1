const BUY_LABELS = /発券|購入|キャンペーン期間|配信|対象期間/;
const GET_LABELS = /引換|引換期間|利用|交換/;

const DATE_RE = /(?:(\d{4})年)?\s*(\d{1,2})[月/](\d{1,2})/g;

/** "9月24日（木）～10月7日（水）", "9/22火AM7:00～9/28月" 처럼 표기가 갈려도 시작·끝만 뽑는다 */
export function parseRange(value, today = new Date()) {
  if (!value) return null;
  const hits = [...String(value).matchAll(DATE_RE)].map((m) => ({
    year: m[1] ? Number(m[1]) : null,
    month: Number(m[2]),
    day: Number(m[3]),
  })).filter((d) => d.month >= 1 && d.month <= 12 && d.day >= 1 && d.day <= 31);
  if (!hits.length) return null;
  const base = hits[0].year || today.getFullYear();
  const start = new Date(base, hits[0].month - 1, hits[0].day);
  const last = hits[hits.length - 1];
  let end = new Date(last.year || base, last.month - 1, last.day);
  if (end < start) end = new Date(end.getFullYear() + 1, end.getMonth(), end.getDate());
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

const pick = (periods, re, today) => {
  for (const p of periods || []) {
    if (!re.test(p.label || "")) continue;
    const range = parseRange(p.value, today);
    if (range) return range;
  }
  return null;
};

/**
 * 지금 뭘 할 수 있는지로 상태를 정한다.
 * buy = 사면 쿠폰이 나오는 기간, get = 쿠폰 교환만 되는 기간.
 */
export function dealStatus(periods, today = new Date()) {
  const buy = pick(periods, BUY_LABELS, today);
  const get = pick(periods, GET_LABELS, today);
  const inRange = (r) => r && today >= r.start && today <= r.end;
  if (inRange(buy)) return { code: "buy", label: "購入でクーポン発券中", live: true, buy, get };
  if (inRange(get)) return { code: "get", label: "引換のみ可能", live: true, buy, get };
  if (buy && today < buy.start) return { code: "soon", label: "開始前", live: false, buy, get };
  if ((get || buy) && today > (get || buy).end) return { code: "ended", label: "終了", live: false, buy, get };
  return { code: "unknown", label: "", live: true, buy, get };
}

const kindOf = (label = "") => (GET_LABELS.test(label) ? "get" : BUY_LABELS.test(label) ? "buy" : "other");

/**
 * 같은 기간을 라벨만 바꿔 두 번 알려 주는 곳이 있다
 * (로손: 対象期間 = 発券対象商品購入期間) → 한 줄로 줄인다.
 * 남기는 쪽은 긴 라벨 — 무슨 기간인지 말해 주는 쪽이 공식 표기다.
 * 값은 공식 표기 그대로 둔다(자르면 매장 페이지와 대조하기 어렵다).
 */
export function tidyPeriods(periods) {
  const out = [];
  for (const p of periods || []) {
    const value = String(p.value ?? "").trim();
    if (!value) continue;
    const range = parseRange(value);
    const key = `${kindOf(p.label)}|${range ? `${+range.start}-${+range.end}` : value}`;
    const same = out.find((o) => o.key === key);
    if (!same) out.push({ key, label: p.label, value });
    else if ((p.label || "").length > (same.label || "").length) same.label = p.label;
  }
  return out.map(({ label, value }) => ({ label, value }));
}

export const formatRange = (range) =>
  range ? `${range.start.getMonth() + 1}/${range.start.getDate()}~${range.end.getMonth() + 1}/${range.end.getDate()}` : "";
