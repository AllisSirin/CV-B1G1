import { text, imgSrc, absolute, block, decode } from "./html.mjs";

/** 「1個買うと1個もらえる」 「1本買うと、1本もらえる」 등 표기 흔들림을 견딘다 */
const CAMPAIGN_RE = /[1１][個本袋点]\s*買うと[\s\S]{0,12}?[1１][個本袋点]\s*(?:無料で)?もらえる/;
const ARTICLE_RE = /\/lab\/tsuushin\/art\/[\w-]+\.html/;

/**
 * 로손은 주마다 기사 URL이 바뀌므로 목록에서 1+1 링크를 찾아 따라간다.
 * 같은 주에 기사가 둘 걸릴 수 있으므로 하나만 집지 않고 다 모은다.
 */
export function findCampaignLinks(indexHtml, baseUrl) {
  const found = [];
  for (const m of indexHtml.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]{0,600}?)<\/a>/gi)) {
    const title = text(m[2]);
    if (!CAMPAIGN_RE.test(title)) continue;
    let url;
    try { url = new URL(decode(m[1]), baseUrl); } catch { continue; }
    const link = { url: url.origin + url.pathname, hash: url.hash.replace("#", ""), title };
    if (!found.some((f) => f.url === link.url && f.hash === link.hash)) found.push(link);
  }
  return found;
}

/** 목록의 제목 표현이 바뀌어도 살아남기 위한 대비: 통신 기사 주소만 새것부터 모은다 */
export function listArticles(indexHtml, baseUrl) {
  const urls = [];
  for (const m of indexHtml.matchAll(/href="([^"]+)"/g)) {
    if (!ARTICLE_RE.test(m[1])) continue;
    let url;
    try { url = new URL(decode(m[1]), baseUrl); } catch { continue; }
    const clean = url.origin + url.pathname;
    if (!urls.includes(clean)) urls.push(clean);
  }
  return urls;
}

/** 기사 안에 1+1 꼭지가 있는지 (제목이 아니라 본문으로 판단) */
export const hasCampaign = (html) => Boolean(section(html));

/** 기사 안에서 1+1 꼭지만 잘라낸다 (다음 <a name="..."> 앵커가 경계) */
function section(html, anchor) {
  const start = anchor
    ? html.search(new RegExp(`<a[^>]+name="${anchor}"`, "i"))
    : html.search(/<h2[^>]*>[^<]*[1１][個本袋点]\s*買うと/i);
  if (start < 0) return "";
  const rest = html.slice(start + 1);
  const next = rest.search(/<a[^>]+name="[^"]+"/i);
  return next < 0 ? rest : rest.slice(0, next);
}

const PERIOD_RE = /^(.*?期間)\s*[：:]\s*(.+)$/;

/** "(1) ソフトドリンクを1本買うと…" 뒤에 발권/교환 대상이 줄 단위로 온다 */
function deals(lines) {
  const out = [];
  let side = null;
  for (const line of lines) {
    const head = /^[(（](\d+)[)）]\s*(.*)$/.exec(line);
    if (head) {
      out.push({ title: head[2], periods: [], buy: emptySide(), get: emptySide() });
      side = null;
      continue;
    }
    if (!out.length) continue;
    const deal = out[out.length - 1];
    if (/発券対象商品|購入対象商品/.test(line)) { side = "buy"; continue; }
    if (/交換対象商品|引換対象商品/.test(line)) { side = "get"; continue; }
    if (!side) {
      if (!deal.title) deal.title = line;
      continue;
    }
    const parsed = product(line);
    deal[side].maker = deal[side].maker || parsed.maker;
    deal[side].names.push(...parsed.names);
  }
  return out.filter((d) => d.buy.names.length || d.get.names.length);
}

const emptySide = () => ({ anyone: false, image: "", maker: "", names: [], volume: "", notes: [] });

/** "アサヒ　おいしい水 600ml、green cola 500ml" → 제조사 + 상품 여러 개 */
function product(line) {
  const parts = line.split(/\s+/);
  const maker = parts.length > 1 && parts[0].length <= 8 ? parts[0] : "";
  const rest = maker ? line.slice(maker.length).trim() : line;
  return { maker, names: rest.split(/[、,]/).map((s) => s.trim()).filter(Boolean) };
}

export function parseLawson(html, url, anchor) {
  const sec = section(html, anchor);
  if (!sec) return { url, periods: [], deals: [], notes: [] };
  const lines = text(sec, { keepBreaks: true }).split("\n");
  const periods = lines.flatMap((l) => {
    const m = PERIOD_RE.exec(l);
    return m ? [{ label: m[1], value: m[2] }] : [];
  });
  const banner = absolute(imgSrc(block(sec, "div", "figureBlock")?.inner || ""), url);
  const items = deals(lines.filter((l) => !PERIOD_RE.test(l)));
  return {
    url: anchor ? `${url}#${anchor}` : url,
    banner,
    periods,
    deals: items,
    notes: lines.filter((l) => l.startsWith("※")),
  };
}
