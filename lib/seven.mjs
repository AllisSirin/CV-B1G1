import { blocks, block, text, imgSrc, imgAlt, absolute, pairs } from "./html.mjs";

/** 발권중 탭은 li.item, 교환중 탭은 클래스 없는 li — ul.item_list 안의 li를 그대로 쓴다 */
const items = (html, base) =>
  blocks(html || "", "ul", "item_list").flatMap((ul) => blocks(ul.inner, "li")).map((li) => ({
    image: absolute(imgSrc(li.inner), base),
    maker: "",
    names: [text(block(li.inner, "p", "item_txt")?.inner || "")].filter(Boolean),
    volume: "",
    notes: blocks(li.inner, "p", "note").map((b) => text(b.inner)).filter(Boolean),
    anyone: false,
  }));

const side = (html, base) => {
  const list = items(html, base);
  return {
    anyone: list.length > 1,
    image: list[0]?.image || "",
    maker: "",
    names: list.flatMap((i) => i.names),
    volume: "",
    notes: list.flatMap((i) => i.notes),
    items: list,
  };
};

/**
 * 프라이치: 발권중/교환중 탭이 따로 있고, 상품마다 기간이 다르다.
 * 탭은 li#ticketing01 / li#exchange01 로 갈린다.
 */
export function parseSeven(html, url) {
  const tabs = [
    { status: "ticketing", label: "発券中", inner: block(html, "li", (c, t) => /id="ticketing/.test(t))?.inner || "" },
    { status: "exchange", label: "引換中", inner: block(html, "li", (c, t) => /id="exchange/.test(t))?.inner || "" },
  ];
  const deals = tabs.flatMap(({ status, label }, i) =>
    blocks(tabs[i].inner, "div", "plaichi_box").map((box) => {
      const buy = block(box.inner, "div", "ticketing_item");
      const get = block(box.inner, "div", "exchange_item");
      return {
        status,
        statusLabel: label,
        title: imgAlt(block(box.inner, "div", "kv")?.inner || ""),
        banner: absolute(imgSrc(block(box.inner, "div", "kv")?.inner || ""), url),
        periods: pairs(block(box.inner, "div", "plaichi_txt_date")?.inner || ""),
        buy: side(buy?.inner, url),
        get: side(get?.inner, url),
      };
    })
  ).filter((d) => d.buy.names.length || d.get.names.length);
  return { url, periods: [], deals, notes: [] };
}
