import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createImageStore, imageName } from "../lib/images.mjs";
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

const IMAGE_URL = /https?:\/\/[^"'\s]+?\.(?:jpe?g|png|gif|webp)/gi;

/** 지금 내보내는 딜이 쓰는 그림 파일 이름 — 상품 그림도 배너도 함께 센다 */
export const usedImages = (body) => new Set((JSON.stringify(body).match(IMAGE_URL) || []).map(imageName));

/**
 * 내려간 딜의 그림은 버린다.
 * 같은 상품이 나중에 다른 딜로 돌아오면 그때 다시 받아 최신 그림을 쓴다(캐시가 끝없이 불지도 않는다).
 */
export async function pruneImages(dir, keep) {
  const names = await readdir(dir).catch(() => []);
  const gone = names.filter((name) => !keep.has(name));
  for (const name of gone) await rm(join(dir, name), { force: true });
  return gone.length;
}

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
  /** 어느 매장이든 몰아 물으면 막는다(세븐은 403 뒤로 아무것도 못 읽는다) — 매장마다 조금씩, 천천히 묻는다 */
  const book = createPriceBook({ store: priceCache, fetchPage, budget: 120, pause: 2500 });
  /** 지금 하는 딜만 남긴다 — 모아 둔 값·그림이 낡은 채로 쌓이지 않는다 */
  const dropped = book.prune(body.results);
  const swept = await pruneImages(join(ROOT, "data", "img"), usedImages(body));
  /** 그림을 값보다 먼저 받는다 — 값을 캐다 세븐에 막히면(403) 그림까지 함께 빈다 */
  const saved = await localizeImages(body.results, saveImage);
  await book.fill(body.results);
  /** 정적 판은 뒤에서 더 채울 수 없으니 남은 개수를 알리지 않는다(화면이 기다리지 않게) */
  const prices = { known: countPrices(body.results).known, pending: 0 };

  await writeFile(join(OUT, "data", "deals.json"), JSON.stringify({ ...body, prices, builtAt: Date.now() }));
  const deals = body.results.reduce((n, r) => n + (r.deals?.length || 0), 0);
  console.log(
    `dist/ 준비 완료 — 딜 ${deals}건 · 값 ${prices.known}건 · 그림 ${saved}장` +
      `${dropped || swept ? ` (내려간 딜 정리 — 값 ${dropped}건 · 그림 ${swept}장)` : ""}${site ? ` · ${site}` : ""}`,
  );
  for (const r of body.results) if (r.error) console.warn(`[!] ${r.id} — ${r.error}`);
}

if (process.argv[1] && process.argv[1].endsWith("snapshot.mjs")) await main();
