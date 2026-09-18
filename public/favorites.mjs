const KEY = "konbini.favorites.v2";

/** 표기가 조금 달라도 같은 상품으로 보이게 — 전각·반각, 공백, 기호를 지운다 */
export const favKey = (name) =>
  String(name ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\u3000]+/g, "")
    .replace(/[・･,、.。()（）「」『』【】[\]"'!?！？~〜ー-]/g, "");

const sideKey = (list) => (list || []).map((it) => favKey(it?.names?.[0])).filter(Boolean).join("+");

/**
 * 딜은 주마다 새로 만들어져 번호가 남지 않는다 — 안에 든 상품 이름으로 딜을 알아본다.
 * 사는 쪽과 받는 쪽을 나눠 두므로, 같은 상품이라도 짝이 바뀌면 다른 딜이다.
 */
export const dealKey = ({ buy, get } = {}) => {
  const key = `${sideKey(buy)}>${sideKey(get)}`;
  return key === ">" ? "" : key;
};

/**
 * 담아 둔 딜은 브라우저에만 둔다 — 정적으로 올려도 로그인 없이 쓸 수 있다.
 */
export function createFavorites(storage) {
  let set = new Set();
  try {
    const raw = storage?.getItem(KEY);
    if (raw) set = new Set(JSON.parse(raw).filter(Boolean));
  } catch { /* 처음이거나 못 읽으면 빈 목록 */ }

  const save = () => {
    try { storage?.setItem(KEY, JSON.stringify([...set])); } catch { /* 저장을 막아 둔 브라우저 */ }
  };

  return {
    get size() { return set.size; },
    keys: () => [...set],
    has: (key) => Boolean(key) && set.has(key),
    toggle(key) {
      if (!key) return false;
      if (set.has(key)) set.delete(key);
      else set.add(key);
      save();
      return set.has(key);
    },
  };
}
