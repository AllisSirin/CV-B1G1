import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, extname, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SOURCES, STORES, meta } from "./lib/sources.mjs";
import { buildDeals, priceBook } from "./lib/deals.mjs";
import { createImageStore } from "./lib/images.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 5176);
let filling = null;

const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml" };
/** 그림은 한 번만 받아 두고 그다음부터 우리 쪽에서 내보낸다 */
const images = createImageStore(join(ROOT, "data", "img"));

const json = (res, code, body) => {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
};

async function proxyImage(res, raw) {
  const got = await images.load(raw).catch(() => null);
  if (!got) return json(res, 404, { error: "no image" });
  res.writeHead(200, { "Content-Type": got.type, "Cache-Control": "public, max-age=86400" });
  res.end(got.body);
}

async function serveStatic(res, pathname) {
  const rel = pathname === "/" ? "index.html" : normalize(pathname).replace(/^([/\\])+/, "");
  const file = join(ROOT, "public", rel);
  if (!file.startsWith(join(ROOT, "public")) || !existsSync(file)) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("not found");
  }
  const type = MIME[extname(file)] || "application/octet-stream";
  res.writeHead(200, {
    "Content-Type": type.startsWith("image/") ? type : `${type}; charset=utf-8`,
    "Cache-Control": "no-store",
  });
  res.end(await readFile(file));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const refresh = url.searchParams.get("refresh") === "1";
  try {
    if (url.pathname === "/api/sources") {
      return json(res, 200, { stores: STORES, sources: SOURCES.map(meta) });
    }
    if (url.pathname === "/api/deals") {
      const body = await buildDeals({ refresh, source: url.searchParams.get("source") });
      if (!body) return json(res, 404, { error: "unknown source" });
      /** 값 찾기는 시간이 걸리니 응답을 막지 않고 뒤에서 조금씩 채운다 */
      if (body.prices.pending && !filling) {
        filling = priceBook.fill(body.results).catch(() => {}).finally(() => { filling = null; });
      }
      return json(res, 200, body);
    }
    if (url.pathname === "/img") return await proxyImage(res, url.searchParams.get("u") || "");
    return await serveStatic(res, url.pathname);
  } catch (e) {
    return json(res, 500, { error: String(e.message || e) });
  }
});

if (!process.env.NO_LISTEN) {
  server.listen(PORT, () => console.log(`konbini 1+1 → http://localhost:${PORT}`));
}

export { server };
