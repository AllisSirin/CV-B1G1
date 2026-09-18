import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/** 편의점 페이지는 하루 한두 번만 바뀌므로 파일 캐시로 재방문을 줄인다 */
export function createCache(file, { ttl = 3 * 60 * 60 * 1000, now = () => Date.now() } = {}) {
  let store = {};
  if (existsSync(file)) {
    try { store = JSON.parse(readFileSync(file, "utf8")); } catch { store = {}; }
  }

  const save = () => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(store, null, 2), "utf8");
  };

  const isFresh = (key) => store[key] && now() - store[key].fetchedAt < ttl;

  return {
    get: (key) => store[key],
    fresh: isFresh,
    set(key, value) {
      store[key] = { fetchedAt: now(), value };
      save();
      return store[key];
    },
    /** 새로 못 가져오면 오래된 캐시라도 내주고 error를 함께 알린다 */
    async resolve(key, loader, { refresh = false } = {}) {
      if (!refresh && isFresh(key)) return { ...store[key], stale: false };
      try {
        return { ...this.set(key, await loader()), stale: false };
      } catch (error) {
        const old = store[key];
        if (old) return { ...old, stale: true, error: String(error.message || error) };
        throw error;
      }
    },
  };
}
