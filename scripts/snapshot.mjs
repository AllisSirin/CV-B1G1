import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createImageStore } from "../lib/images.mjs";
import { buildDeals, countPrices, priceCache } from "../lib/deals.mjs";
import { createPriceBook } from "../lib/price.mjs";
import { fetchPage } from "../lib/fetchPage.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "dist");
/** 서버가 쓰는 그림 캐시를 그대로 나눠 쓴다 — 스냅샷을 다시 만들어도 원본을 또 두드리지 않는다 */
const images = createImageStore(join(ROOT, "data", "img"));

const itemsOf = (side) => (side?.items?.length ? side.items : side ? [side] : []);
const allItems = (results) =>
  results.flatMap((r) => (r.deals || []).flatMap((d) => [d.buy, d.get].flatMap(itemsOf)));

/**
 * 정적으로 올린 판에는 이미지 프록시가 없다.
 * 그림을 우리 쪽으로 내려 두고 상대 주소로 바꿔 둔다 — 보는 사람이 편의점 서버를 두드리지 않는다.
 */
export async function localizeImages(results, save) {
  const done = new Map();
  for (const item of allItems(results)) {
    const url = item.image;
    if (!url || !/^https?:/i.test(url)) continue;
    if (!done.has(url)) done.set(url, await save(url));
    item.image = done.get(url) || "";
  }
  return [...done.values()].filter(Boolean).length;
}

const saveImage = async (raw) => {
  try {
    const got = await images.load(raw);
    if (!got) return null;
    await writeFile(join(OUT, "img", got.name), got.body);
    return `img/${got.name}`;
  } catch {
    return null;
  }
};

/**
 * 링크 미리보기(LINE·X)는 상대 주소를 못 읽는 곳이 있다.
 * 올릴 주소를 알 때(SITE_URL)만 og:image·og:url 을 절대 주소로 바꿔 준다.
 */
export function absolutizeMeta(html, siteUrl) {
  if (!siteUrl) return html;
  const base = siteUrl.endsWith("/") ? siteUrl : `${siteUrl}/`;
  return html
    .replace('content="./og.png"', `content="${base}og.png"`)
    .replace('<meta property="og:type"', `<meta property="og:url" content="${base}" />\n<meta property="og:type"`);
}

async function main() {
  await rm(OUT, { recursive: true, force: true });
  await cp(join(ROOT, "public"), OUT, { recursive: true });
  await mkdir(join(OUT, "img"), { recursive: true });
  await mkdir(join(OUT, "data"), { recursive: true });

  const site = process.env.SITE_URL || "";
  if (site) {
    const page = join(OUT, "index.html");
    await writeFile(page, absolutizeMeta(await readFile(page, "utf8"), site));
  }

  const body = await buildDeals({ refresh: true });
  const book = createPriceBook({ store: priceCache, fetchPage, budget: 300, pause: 400 });
  await book.fill(body.results);
  /** 정적 판은 뒤에서 더 채울 수 없으니 남은 개수를 알리지 않는다(화면이 기다리지 않게) */
  const prices = { known: countPrices(body.results).known, pending: 0 };
  const saved = await localizeImages(body.results, saveImage);

  await writeFile(join(OUT, "data", "deals.json"), JSON.stringify({ ...body, prices, builtAt: Date.now() }));
  const deals = body.results.reduce((n, r) => n + (r.deals?.length || 0), 0);
  console.log(`dist/ 준비 완료 — 딜 ${deals}건 · 값 ${prices.known}건 · 그림 ${saved}장${site ? ` · ${site}` : ""}`);
  for (const r of body.results) if (r.error) console.warn(`[!] ${r.id} — ${r.error}`);
}

if (process.argv[1] && process.argv[1].endsWith("snapshot.mjs")) await main();
