import { dealStatus, tidyPeriods } from "./period.mjs";
import { createFavorites, dealKey } from "./favorites.mjs";

/** https 로 올린 판에서만 홈 화면 설치·오프라인을 켠다 (개발 중 localhost 는 캐시에 갇히지 않게) */
if ("serviceWorker" in navigator && location.protocol === "https:") {
  addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}

const els = {
  stores: document.getElementById("stores"),
  sub: document.getElementById("sub"),
  alerts: document.getElementById("alerts"),
  list: document.getElementById("list"),
  status: document.getElementById("status"),
  q: document.getElementById("q"),
  activeChk: document.getElementById("active-chk"),
  onlyActive: document.getElementById("only-active"),
  onlyFav: document.getElementById("only-fav"),
  favCount: document.getElementById("fav-count"),
  refresh: document.getElementById("refresh"),
};

const favorites = createFavorites(globalThis.localStorage);
const state = { stores: [], results: [], prices: { known: 0, pending: 0 }, polls: 0, store: "all", source: null, q: "", onlyActive: true, onlyFav: false, loading: false, snapshot: false };
/** 스냅샷으로 올린 판은 그림을 우리 쪽에 두므로 상대 주소, 서버로 돌 때는 프록시를 지난다 */
const img = (url) => (!url ? "" : /^https?:/i.test(url) ? `/img?u=${encodeURIComponent(url)}` : url);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

async function load({ refresh = false } = {}) {
  state.loading = true;
  render();
  await pull(refresh);
  state.loading = false;
  renderStores();
  render();
  watchPrices();
}

/**
 * 정적으로 올린 판(GitHub Pages 등)에는 API 가 없다 — 만들어 둔 스냅샷을 읽는다.
 * 한 번 스냅샷으로 확인되면 다시 API 를 찾지 않는다.
 */
async function fetchDeals(refresh) {
  if (!state.snapshot) {
    try {
      const res = await fetch(`/api/deals${refresh ? "?refresh=1" : ""}`);
      if (res.ok) return await res.json();
    } catch { /* 정적 판 */ }
    state.snapshot = true;
    els.refresh.hidden = true;
  }
  const res = await fetch(`data/deals.json?t=${Date.now()}`);
  return res.ok ? await res.json() : { results: [] };
}

async function pull(refresh) {
  const body = await fetchDeals(refresh);
  state.stores = body.stores || [];
  state.results = body.results || [];
  state.prices = body.prices || { known: 0, pending: 0 };
}

/** 값은 뒤에서 조금씩 채워지므로 다 채워질 때까지 조용히 다시 받아온다 */
function watchPrices() {
  clearTimeout(watchPrices.timer);
  if (!state.prices?.pending || state.polls >= 40) return;
  watchPrices.timer = setTimeout(async () => {
    state.polls += 1;
    const before = state.prices.known;
    await pull(false);
    if (state.prices.known !== before) render();
    else els.status.textContent = statusText();
    watchPrices();
  }, 5000);
}

function renderStores() {
  const tabs = [{ id: "all", label: "すべて", icon: "★", brand: "#1c1f23" }, ...state.stores];
  els.stores.innerHTML = tabs.map((t) => {
    const n = visibleDeals(t.id).length;
    return `<button class="store" data-store="${t.id}" aria-selected="${state.store === t.id}" style="color:${t.brand}">
      <span class="icon" style="background:${t.brand}">${esc(t.icon)}</span>
      <span class="label">${esc(t.short || t.label)}</span><span class="count">${n}件</span>
    </button>`;
  }).join("");
}

const sourcesOf = (store) => state.results.filter((r) => store === "all" || r.store === store);

function visibleDeals(store) {
  return sourcesOf(store).flatMap((r) => r.deals.map((d) => ({ deal: d, source: r })));
}

const sideText = (side) => [side?.maker, ...(side?.names || [])].join(" ");
/** 담기·거르기는 카드(딜) 하나가 단위다 — 안에 든 상품 이름으로 딜을 알아본다 */
const keyOf = (deal) => dealKey({ buy: items(deal?.buy), get: items(deal?.get) });

const isLive = ({ deal, source }) => dealStatus([...(source.periods || []), ...(deal.periods || [])]).live;
const inScope = ({ source }) => !state.source || source.id === state.source;

function filtered() {
  const q = state.q.trim().toLowerCase();
  return visibleDeals(state.store)
    .filter(inScope)
    .filter((x) => !state.onlyActive || isLive(x))
    .filter(({ deal }) => !state.onlyFav || favorites.has(keyOf(deal)))
    .filter(({ deal }) => !q || `${sideText(deal.buy)} ${sideText(deal.get)} ${deal.title || ""}`.toLowerCase().includes(q));
}

/** 홈에서는 매장 탭과 겹치기만 한다 — 한 매장 안에 여러 기획이 있을 때만 낸다 */
function renderSub() {
  const sources = sourcesOf(state.store);
  const show = state.store !== "all" && sources.length > 1;
  els.sub.hidden = !show;
  if (!show) return;
  els.sub.innerHTML = [{ id: null, label: "すべて" }, ...sources].map((s) => `
    <button data-source="${s.id ?? ""}" aria-selected="${(state.source ?? "") === (s.id ?? "")}">
      ${esc(s.label)}${s.id ? ` <span class="count">${s.deals.length}</span>` : ""}
    </button>`).join("");
}

const items = (side) => (side?.items?.length ? side.items : side ? [side] : []);

/** 가격은 공식 상품 페이지에서 찾은 것만 쓴다 — 없으면 웹 검색으로 보낸다 */
const renderPrice = (it) => {
  const price = it.price;
  if (!price) {
    return it.priceSearch
      ? `<p class="price hint"><a href="${esc(it.priceSearch)}" target="_blank" rel="noopener">Googleで価格を調べる ↗</a></p>`
      : "";
  }
  const body = `${price.approx ? "≈" : ""}税込${price.yen}円`;
  const note = price.approx ? `<span class="from">${esc(price.name)}</span>` : "";
  return price.url
    ? `<p class="price"><a href="${esc(price.url)}" target="_blank" rel="noopener">${body}</a>${note}</p>`
    : `<p class="price">${body}${note}</p>`;
};

/** 「5品のいずれか1個」처럼 개수를 먼저 알려주면 양쪽 수가 크게 달라도 헷갈리지 않는다 */
const countLabel = (side, list) => {
  if (list.length > 1) return side?.anyone ? `${list.length}品のいずれか1個` : `${list.length}品`;
  return "1品";
};

const renderRow = (it) => `<li class="row">
  ${it.image ? `<img src="${img(it.image)}" alt="" loading="lazy" />` : '<span class="noimg"></span>'}
  <div class="row-body">
    ${it.maker ? `<p class="maker">${esc(it.maker)}</p>` : ""}
    <p class="name">${(it.names || []).map(esc).join("<br />")}</p>
    ${it.volume ? `<p class="volume">${esc(it.volume)}</p>` : ""}
    ${renderPrice(it)}
    ${(it.notes || []).map((n) => `<p class="note">${esc(n)}</p>`).join("")}
  </div>
</li>`;

const renderSide = (side, kind) => {
  const list = items(side);
  const tag = kind === "buy" ? "これを買うと" : "これがもらえる";
  return `<section class="side ${kind}">
    <p class="tag">${tag}<span class="n">${esc(countLabel(side, list))}</span></p>
    <ul class="rows">${list.map(renderRow).join("")}</ul>
  </section>`;
};

/** 기간은 세븐처럼 카드마다 적는다 — 기획 전체 기간이든 딜별 기간이든 그 딜에 걸리는 건 같다 */
function renderCard({ deal, source }) {
  const periods = [...(source.periods || []), ...(deal.periods || [])];
  const status = dealStatus(periods);
  const key = keyOf(deal);
  const on = favorites.has(key);
  /**
   * 상태 배지는 「보통이 아닐 때」만 낸다.
   * 발권이 끝난 딜은 서버에서 이미 빠지므로 「購入でクーポン発券中」은 모든 카드에 똑같이 붙어 알려주는 게 없다.
   */
  const badge = status.code === "buy"
    ? ""
    : `<span class="badge ${status.live ? "live" : "done"}">${esc(status.label || "期間不明")}</span>`;
  return `<article class="card">
    <div class="head">
      ${badge}
      ${tidyPeriods(periods).map((p) => `<span class="badge">${esc(p.label)} ${esc(p.value)}</span>`).join("")}
      ${key ? `<button type="button" class="fav" data-fav="${esc(key)}" aria-pressed="${on}"
        title="${on ? "気になるリストから外す" : "気になるリストに入れる"}">★</button>` : ""}
      ${deal.title ? `<span class="title">${esc(deal.title)}</span>` : ""}
    </div>
    <div class="flow">
      ${renderSide(deal.buy, "buy")}
      <p class="join">1個買うと</p>
      ${renderSide(deal.get, "get")}
    </div>
  </article>`;
}

function statusText(count = filtered().length) {
  const oldest = Math.min(...sourcesOf(state.store).map((r) => r.fetchedAt || Date.now()));
  const updated = new Date(oldest).toLocaleString("ja-JP", { hour12: false });
  const pending = state.prices?.pending ? `・価格を取得中 残り${state.prices.pending}品` : "";
  return `${count}件${state.onlyActive ? "（実施中）" : ""}・更新 ${updated}${pending}`;
}

const ago = (ts) => {
  const min = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (min < 60) return `${min}分前`;
  const hour = Math.round(min / 60);
  return hour < 24 ? `${hour}時間前` : `${Math.round(hour / 24)}日前`;
};

/**
 * 취득 실패는 매장 카드 안 작은 글씨로는 놓치기 쉽다.
 * (로손은 주마다 기사 주소가 바뀌어 언젠가는 못 찾을 수 있다)
 */
function renderAlerts() {
  const bad = state.results.filter((r) => r.error);
  els.alerts.hidden = !bad.length;
  els.alerts.innerHTML = bad.map((r) => `<p class="alert">
    <span class="icon">⚠</span>
    <span class="body"><b>${esc(r.storeLabel)}・${esc(r.label)}</b>を取得できませんでした
      ${r.fetchedAt ? `<span class="sub">${esc(ago(r.fetchedAt))}のデータを表示中 · ${esc(r.error)}</span>`
                    : `<span class="sub">表示できるデータがありません · ${esc(r.error)}</span>`}</span>
    <a href="${esc(r.url)}" target="_blank" rel="noopener">公式 ↗</a>
  </p>`).join("");
}

function render() {
  renderSub();
  renderAlerts();
  els.favCount.textContent = favorites.size ? `${favorites.size}` : "";
  if (state.loading) {
    els.status.textContent = "各社のページを読み込み中…";
    els.list.innerHTML = "";
    return;
  }
  /** 지난 딜·시작 전 딜이 하나도 없으면 「いま使えるものだけ」는 걸러낼 게 없다 — 그럴 때는 내지 않는다 */
  els.activeChk.hidden = !visibleDeals(state.store).filter(inScope).some((x) => !isLive(x));

  const rows = filtered();
  els.status.textContent = statusText(rows.length);

  const groups = sourcesOf(state.store).filter((r) => !state.source || r.id === state.source);
  els.list.innerHTML = groups.map((r) => {
    const mine = rows.filter((x) => x.source.id === r.id);
    /** 값을 못 받은 매장(deals 0건)은 지금 걸어 둔 검색·필터 때문에 0건인 것과 다르다 — 후자는 조용히 숨긴다.
     * 0건이 「캠페인이 확실히 없다」인지 「구조가 바뀌어 못 찾았다」인지는 이 자리에서 가릴 수 없다
     * (ファミペイ限定 주소가 바뀌어 404 였던 사례 참고) — 그래서 단정하지 않고 「읽어올 수 없었다」고만 말하고,
     * 공식 페이지 링크는 그대로 남겨 사용자가 직접 확인하게 한다.
     */
    const empty = !(r.deals || []).length;
    if (!mine.length && !r.error && !empty) return "";
    return `<section class="group">
      <h2><span class="icon-dot" style="color:${r.brand}">●</span> ${esc(r.storeLabel)} · ${esc(r.label)}
        <a href="${esc(r.url)}" target="_blank" rel="noopener">公式ページ ↗</a></h2>
      ${r.error ? `<p class="err">読み込み失敗: ${esc(r.error)}${r.fetchedAt ? "（前回のデータを表示）" : ""}</p>`
        : empty ? `<p class="empty">1+1情報を読み込めませんでした。上の公式ページでご確認ください。</p>` : ""}
      ${mine.map(renderCard).join("")}
    </section>`;
  }).join("") || `<p class="status">${state.onlyFav && !favorites.size
      ? "気になる1+1がまだありません。カードの ★ を押すと、ここにまとまります。"
      : "該当する1+1はありません。"}</p>`;
  renderStores();
}

els.stores.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-store]");
  if (!btn) return;
  state.store = btn.dataset.store;
  state.source = null;
  render();
});
els.sub.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-source]");
  if (!btn) return;
  state.source = btn.dataset.source || null;
  render();
});
els.list.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-fav]");
  if (!btn) return;
  favorites.toggle(btn.dataset.fav);
  render();
});
els.q.addEventListener("input", () => { state.q = els.q.value; render(); });
els.onlyActive.addEventListener("change", () => { state.onlyActive = els.onlyActive.checked; render(); });
els.onlyFav.addEventListener("change", () => { state.onlyFav = els.onlyFav.checked; render(); });
els.refresh.addEventListener("click", () => load({ refresh: true }));

load();
