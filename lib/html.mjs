const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", yen: "¥", copy: "©", reg: "®", trade: "™", hellip: "…", middot: "·", mdash: "—", ndash: "–" };

export function decode(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

/** <br>은 줄바꿈으로 남긴다 — 로손처럼 줄 단위로 뜻이 갈리는 페이지가 있다 */
export function text(html, { keepBreaks = false } = {}) {
  if (!html) return "";
  let s = html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "");
  s = s.replace(/<br\s*\/?>/gi, keepBreaks ? "\n" : " ");
  if (keepBreaks) s = s.replace(/<\/(p|div|dd|dt|li|h[1-6]|tr)>/gi, "\n");
  s = s.replace(/<[^>]*>/g, "");
  s = decode(s).replace(/\u3000/g, " ").replace(/[ \t\u00a0]+/g, " ");
  return keepBreaks
    ? s.split("\n").map((l) => l.trim()).filter(Boolean).join("\n")
    : s.trim();
}

const classes = (tagHtml) => {
  const m = /\bclass\s*=\s*"([^"]*)"/i.exec(tagHtml);
  return m ? m[1].trim().split(/\s+/) : [];
};

const attr = (tagHtml, name) => {
  const m = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i").exec(tagHtml);
  return m ? decode(m[1]) : "";
};

export { attr };

/**
 * 같은 태그가 겹쳐 있어도 깊이를 세어 블록 하나를 온전히 떼어낸다.
 * 이미 떼어낸 블록 안쪽은 다시 훑지 않는다(중첩 li 오탐 방지).
 */
export function blocks(html, tag, matcher) {
  const open = new RegExp(`<${tag}(\\s[^>]*)?>`, "gi");
  const found = [];
  let m;
  while ((m = open.exec(html))) {
    const tagHtml = m[0];
    const hit = matcher == null
      ? true
      : typeof matcher === "function"
        ? matcher(classes(tagHtml), tagHtml)
        : classes(tagHtml).includes(matcher);
    if (!hit) continue;
    const end = blockEnd(html, tag, m.index + tagHtml.length);
    found.push({ open: tagHtml, inner: html.slice(m.index + tagHtml.length, end) });
    open.lastIndex = end;
  }
  return found;
}

function blockEnd(html, tag, from) {
  const scan = new RegExp(`<(/)?${tag}(\\s[^>]*)?>`, "gi");
  scan.lastIndex = from;
  let depth = 1, m;
  while ((m = scan.exec(html))) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return m.index;
  }
  return html.length;
}

export const block = (html, tag, matcher) => blocks(html, tag, matcher)[0] || null;

export function imgSrc(html) {
  const m = /<img[^>]*\bsrc\s*=\s*"([^"]*)"/i.exec(html || "");
  return m ? decode(m[1]) : "";
}

export function imgAlt(html) {
  const m = /<img[^>]*\balt\s*=\s*"([^"]*)"/i.exec(html || "");
  return m ? decode(m[1]) : "";
}

export const absolute = (src, base) => (src ? new URL(src, base).toString() : "");

/** <dt>라벨 / <dd>값 짝을 순서대로 모은다 */
export function pairs(html) {
  const dts = [...html.matchAll(/<dt[^>]*>([\s\S]*?)<\/dt>/gi)].map((m) => text(m[1]));
  const dds = [...html.matchAll(/<dd[^>]*>([\s\S]*?)<\/dd>/gi)].map((m) => text(m[1]));
  return dts.map((label, i) => ({ label, value: dds[i] || "" })).filter((p) => p.label || p.value);
}

export function tagTexts(html, tag) {
  return [...html.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "gi"))]
    .map((m) => text(m[1]))
    .filter(Boolean);
}
