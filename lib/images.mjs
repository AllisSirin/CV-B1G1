import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { createHash } from "node:crypto";

/** 상품 그림을 올리는 곳 — 이 밖의 주소는 받아오지 않는다 */
export const IMAGE_HOSTS = new Set(["www.family.co.jp", "www.sej.co.jp", "www.lawson.co.jp"]);

const EXT = /^\.(jpe?g|png|gif|webp)$/i;
const TYPE = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp" };

/** 같은 주소는 늘 같은 파일 이름으로 — 한 번 받은 그림을 다시 받지 않는다 */
export function imageName(url) {
  const hash = createHash("sha1").update(url).digest("hex").slice(0, 12);
  let ext = ".jpg";
  try {
    const raw = extname(new URL(url).pathname).toLowerCase();
    if (EXT.test(raw)) ext = raw;
  } catch { /* 주소가 아니면 기본 확장자 */ }
  return `${hash}${ext}`;
}

export const imageType = (name) => TYPE[extname(name).toLowerCase()] || "image/jpeg";

export function allowedImage(raw) {
  let url;
  try { url = new URL(raw); } catch { return null; }
  return IMAGE_HOSTS.has(url.hostname) ? url : null;
}

/** 원본 사이트가 핫링크·리퍼러로 막을 수 있어 리퍼러를 붙여 받아온다 */
export async function downloadImage(url, get = fetch) {
  const res = await get(url, { headers: { referer: `${url.origin}/`, "user-agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`upstream ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * 한 번 받은 그림은 디스크에 두고 그다음부터는 우리 쪽에서 내보낸다.
 * 사람이 볼 때마다 편의점 서버를 두드리지 않게 하는 것이 목적이다.
 */
export function createImageStore(dir, { get = fetch } = {}) {
  let ready = null;
  const ensure = () => (ready = ready || mkdir(dir, { recursive: true }));
  return {
    async load(raw) {
      const url = allowedImage(raw);
      if (!url) return null;
      const name = imageName(raw);
      const file = join(dir, name);
      await ensure();
      try {
        return { name, type: imageType(name), body: await readFile(file), cached: true };
      } catch { /* 아직 없다 */ }
      const body = await downloadImage(url, get);
      await writeFile(file, body);
      return { name, type: imageType(name), body, cached: false };
    },
  };
}
