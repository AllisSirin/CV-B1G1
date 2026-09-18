import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SOURCES, STORES, meta } from "./sources.mjs";
import { fetchPage } from "./fetchPage.mjs";
import { createCache } from "./cache.mjs";
import { buildCatalog, annotateDeals } from "./catalog.mjs";
import { createPriceBook } from "./price.mjs";
import { searchable } from "./lookup.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const cache = createCache(join(ROOT, "data", "cache.json"));
/** 상품 가격표는 행사 페이지보다 덜 바뀌므로 따로, 더 길게 캐시한다 */
const catalogCache = createCache(join(ROOT, "data", "catalog.json"), { ttl: 12 * 60 * 60 * 1000 });
/** 상품별 값은 한 번 찾으면 계속 쓴다 */
export const priceCache = createCache(join(ROOT, "data", "prices.json"), { ttl: Number.MAX_SAFE_INTEGER });
export const priceBook = createPriceBook({ store: priceCache, fetchPage });

/** 값을 찾을 곳이 없는 매장(lawson)은 기다릴 것도 없으므로 세지 않는다 */
export function countPrices(results) {
  let known = 0, pending = 0;
  for (const r of results) for (const d of r.deals || []) for (const side of [d.buy, d.get]) {
    for (const item of (side?.items?.length ? side.items : side ? [side] : [])) {
      if (item.price) known++;
      else if (searchable(r.store)) pending++;
    }
  }
  return { known, pending };
}

async function catalogFor(store, refresh) {
  try {
    return (await catalogCache.resolve(store, () => buildCatalog(store, fetchPage), { refresh })).value;
  } catch {
    return [];
  }
}

/** 출처가 사라지면(로손처럼 주소·표현이 바뀌면) 조용히 넘기지 않고 한 번은 알린다 */
const broken = new Map();

function report(id, error) {
  if (error) {
    if (broken.get(id) === error) return;
    broken.set(id, error);
    console.warn(`[!] ${id} 를 가져오지 못했습니다 — ${error}`);
    return;
  }
  if (broken.delete(id)) console.log(`[ok] ${id} 복구되었습니다`);
}

async function loadSource(source, refresh) {
  const entry = await cache.resolve(source.id, () => source.load(fetchPage, source), { refresh });
  report(source.id, entry.error);
  return { ...meta(source), ...entry.value, fetchedAt: entry.fetchedAt, stale: entry.stale, error: entry.error };
}

/**
 * 화면이 그대로 쓰는 한 덩이(매장 목록 + 출처별 딜 + 값 개수).
 * 서버와 정적 스냅샷이 같은 것을 만들어야 해서 여기 한 곳에 둔다.
 */
export async function buildDeals({ refresh = false, source = null } = {}) {
  const targets = source ? SOURCES.filter((s) => s.id === source || s.store === source) : SOURCES;
  if (!targets.length) return null;
  const results = await Promise.all(targets.map(async (s) => {
    try {
      return await loadSource(s, refresh);
    } catch (e) {
      const error = String(e.message || e);
      report(s.id, error);
      return { ...meta(s), deals: [], periods: [], notes: [], error };
    }
  }));
  const stores = [...new Set(targets.map((t) => t.store))];
  const catalogs = Object.fromEntries(await Promise.all(stores.map(async (s) => [s, await catalogFor(s, refresh)])));
  for (const r of results) priceBook.hint(priceBook.attach(annotateDeals(r, catalogs[r.store])));
  return { stores: STORES, results, prices: countPrices(results) };
}
