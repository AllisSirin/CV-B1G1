import { blocks, block, text, imgSrc, absolute, pairs, tagTexts } from "./html.mjs";

/** 상품명이 "공통 접두어 + 변형 목록"으로 쪼개져 있으면 붙여서 온전한 이름으로 만든다 */
function nameList(html) {
  const variants = tagTexts(html, "li");
  if (!variants.length) return [text(html)].filter(Boolean);
  const prefix = tagTexts(html, "p")[0] || "";
  return variants.map((v) => (prefix ? `${prefix} ${v}` : v));
}

const side = (html, base) => {
  if (!html) return null;
  const info = block(html, "div", "item-info");
  const name = info && block(info.inner, "div", "name");
  const names = name ? nameList(name.inner) : [];
  return {
    anyone: /class="anyone"/.test(html),
    image: absolute(imgSrc(html), base),
    maker: info ? text(block(info.inner, "p", "company")?.inner || "") : "",
    names: names.filter(Boolean),
    volume: info ? text(block(info.inner, "p", "volume")?.inner || "") : "",
    notes: info ? blocks(info.inner, "p", "kome").map((b) => text(b.inner)) : [],
  };
};

/** 레시트(무료교환권) 1+1: li.item 안에 side-buy / side-get 한 쌍 */
export function parseReceipt(html, url) {
  const info = block(html, "div", "campaign-info") || block(html, "dl");
  const periods = info ? pairs(info.inner) : [];
  const notes = blocks(html, "dd", "info-red").map((b) => text(b.inner)).filter(Boolean);
  const list = block(html, "ul", "item_list");
  const deals = blocks(list ? list.inner : html, "li", "item").map((li) => ({
    periods: [],
    buy: side(block(li.inner, "div", "side-buy")?.inner, url),
    get: side(block(li.inner, "div", "side-get")?.inner, url),
  })).filter((d) => d.buy && d.get);
  return { url, periods, deals, notes };
}

const famipaySide = (html, base) => {
  if (!html) return null;
  const container = block(html, "div", "item_container");
  const inner = container ? container.inner : html;
  const textBox = block(inner, "div", "item_text");
  return {
    anyone: /class="item_anyone"/.test(inner),
    image: absolute(imgSrc(block(inner, "p", "item_pic")?.inner || inner), base),
    maker: text(block(textBox?.inner || inner, "dt", "item_maker")?.inner || ""),
    names: blocks(textBox?.inner || inner, "dd", (cls) => cls.includes("item_name")).map((b) => text(b.inner)).filter(Boolean),
    volume: text(block(inner, "p", "item_Qty")?.inner || ""),
    notes: blocks(inner, "div", "kome").map((b) => text(b.inner)).filter(Boolean),
    periods: pairs(block(html, "div", "date")?.inner || ""),
  };
};

/** 파미페이 한정 1+1: div.item 안에 item_buy / item_get, 기간이 상품마다 다르다 */
export function parseFamipay(html, url) {
  const deals = blocks(html, "div", "item").map((it) => {
    const buy = famipaySide(block(it.inner, "div", "item_buy")?.inner, url);
    const get = famipaySide(block(it.inner, "div", "item_get")?.inner, url);
    if (!buy || !get) return null;
    return { periods: [...(buy.periods || []), ...(get.periods || [])], buy, get };
  }).filter(Boolean);
  return { url, periods: [], deals, notes: [] };
}
