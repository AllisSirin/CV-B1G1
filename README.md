# Japanese Convenience Store "Buy 1 Get 1" Campaign

All the "buy one, get one free" (「1個買うと1個もらえる」) campaigns from 7-Eleven, FamilyMart and Lawson on one screen.
Tap a store icon to see only that store, or `すべて` to see all four feeds at once.

[日本語版 README](README.ja.md)

## Run

```
cd konbini && node server.mjs   # http://localhost:5176
bun test                        # 81 tests
```

## Sources

| Icon | Source | Page |
| --- | --- | --- |
| 7 | 7-Eleven Plaichi | `https://www.sej.co.jp/cmp/plaichi.html` |
| F | FamilyMart receipt coupon | `.../2023_1buy1-receipt_cp.html` |
| F | FamilyMart FamiPay only | `.../famipay_1buy1_cp.html` |
| L | Lawson 1個買うと1個もらえる | found weekly from the recommend / otoku listings |

Lawson changes the article URL every week, so it is never hard-coded. We look for it three ways:

1. Collect **every** link on `/recommend/index.html` whose title reads 「1個/1本/1袋 買うと…もらえる」 (there can be two in one week).
2. If the wording changed and nothing matches, open the four newest `/lab/tsuushin/` articles and decide by whether the body contains a 1+1 section.
3. If both fail, serve the previous cached data with 「読み込み失敗…（前回のデータを表示）」 — the screen never goes blank.

The leading digit is pinned to 1 on purpose so that different offers such as `2個買うと1個もらえる` are not picked up.

## Prices

`lib/catalog.mjs` scrapes each chain's product listing pages (7-Eleven `/products/a/*`, FamilyMart `/goods/*.html`,
Lawson `/recommend/original/*`) behind a 12-hour cache, builds a `name → tax-included price` index, and attaches a price
**only when the name matches exactly** (with a link to the official product page).
Partial matching is deliberately disabled: it would attach the price of 「大粒ラムネ アイスボックス味」 to 「大粒ラムネ」.

For products missing from the listings, `lib/lookup.mjs` falls back to each chain's own search.
For 7-Eleven that is the product database search **`/products/a/itemresult/?key=…&limit=100`** — its results use the very
same markup as the listing pages (`div.list_inner` + `item_ttl` + `item_price`), so the `lib/catalog.mjs` parser reads
**name and price straight off the result page** without opening any product page.
For FamilyMart we call the MarsFlag JSON that its search screen uses, then read the price with `lib/itempage.mjs`.

7-Eleven's mobile full-text search (`search.html?kw=`) is **not used**: it only indexes recent releases, so long-selling
products like 「綾鷹」「カップヌードル」「リポビタン」 return nothing at all, and it is served as Shift_JIS, which garbles
every name when read as UTF-8. Switching to the product database search found those very items right away
(`綾鷹 ６５０ｍｌ 187円`, `ロッテ パイの実 256円`).

The search matches per word, so passing a whole product name easily returns zero hits because of transcription
differences (the official title is 「森永 ｉｎバーエネルギー サツマイモ」, so `森永inバー` is not a substring).
`lib/price.mjs` therefore asks up to three times: **longest single word → the full name → the two longest words**.
Asking by a single word first is cheaper because one result page resolves a whole family at once (7 kinds of カップヌードル);
the same word is fetched only once per refresh.
7-Eleven also serves regional URLs (`/item/480112/chugoku/`), so duplicates are removed by **product number**, not URL.

When the names are not identical but one is a prefix of the other and the leftover tail is short (6 characters or less),
the price is still used, but the screen shows `≈` together with the name it was read from. A tail containing digits or a
pack/size marker (`パック`·`箱`·`入`·`ミニ`·`どんぶり`·`ビッグ`·`大盛`) is rejected because the price differs — this is what keeps
`５食パック 734円` off 「マルちゃん正麺 醤油味」 and `…塩らーめんミニどんぶり 168円` off 「サッポロ一番 塩らーめん」.
Found prices stay in `data/prices.json` until the deal is over (misses for 7 days), and only a few are looked up per
request to go easy on the other side.

Everything above counts **per chain**, never across them. 7-Eleven answers **403** when asked too quickly and then blocks
everything that follows, so a 403 or any network failure is **never cached as "no price"** (that would skip the product
for 7 days); instead **that chain alone rests for 10 minutes** and the others keep going. The per-refresh allowance is
per chain too, so one chain full of unknown products cannot eat the share of the next one. The screen keeps asking for a
refresh every few seconds until all prices are in, so without the rest we would keep knocking.

Note: all three chains publish product pages mainly for their **own brands and some new releases**. 1+1 targets are
mostly manufacturer (NB) products, so as of 2026-09-18 only 14 of 50 items carry a price. Lawson has no usable source
at all — its search is an external widget and it only lists its own products.
Items without a price get a `Googleで価格を調べる ↗` link that searches 「maker product name 価格」 — we never invent a number.
Chain search screens only show what the chain itself listed, which did not help for manufacturer products.

## Layout

- `lib/{seven,familymart,lawson}.mjs` — one parser per page. All of them return the same shape: `{ periods, deals:[{ periods, buy, get }] }`.
- `lib/html.mjs` — dependency-free tag extractor (counts nesting depth to lift out one whole block).
- `lib/cache.mjs` — 3-hour cache in `data/cache.json`. If fetching fails, the old data is served together with the error.
- `public/period.mjs` — reads periods like 「9月24日（木）～10月7日（水）」 and decides `発券中 / 引換のみ / 開始前 / 終了`. Shared by server and screen.
- `lib/catalog.mjs` — listing index and price matching. `lib/{lookup,itempage,price}.mjs` — official search, product page reading, price ledger.
- All user-facing text is Japanese (`public/*`, `lib/sources.mjs`). A card flows vertically: `これを買うと` → ↓ → `これがもらえる`, with the item count.
- Periods are shown as badges **on every card**, the way 7-Eleven does it (a campaign-wide period still applies to that deal, so it moves down to the card — group headers carry no period). Values are kept exactly as published; `tidyPeriods()` (`public/period.mjs`) only collapses the case where the same period is printed twice under different labels for the same purpose (Lawson `対象期間` = `発券対象商品購入期間`), keeping the longer label that says what the period is for.
- The status badge is printed **only when the state is not the normal one**. Deals whose issuing period has passed are already dropped on the server, so 「購入でクーポン発券中」 would appear identically on every card and say nothing — only `開始前` and unreadable periods get a badge. The 発券/引換 period badges are always kept.
- The campaign (chip) row appears only when a store has more than one campaign — on the home screen it just duplicated the store tabs.
- `public/favorites.mjs` — favourite 1+1 (★). The unit is **one card (deal)**. Deal numbers vanish every week, so a deal is recognised by the product names inside it: `dealKey()` joins the first product name of the buy side and the get side as `買う>もらう`, and `favKey()` strips full-width/half-width forms, spaces and symbols so slightly different transcriptions still count as the same deal (a different pairing is a different deal). The list lives in `localStorage["konbini.favorites.v2"]` — no login, so it works in the static build too, and it does not break in browsers with storage disabled (remembered for that session only). ★ sits at the right end of the badge row in the card header; the toolbar's `★ 気になる件` keeps only saved cards.
- **Deals whose coupons can no longer be issued are not served** — `loadSource()` passes through `withoutEnded()` (`public/period.mjs`). It drops not only `終了` but also deals whose **`発券` (purchase) period has passed**: even if the exchange period is still open (`引換のみ可能`), no new coupon can be issued, and that is a story for people who already hold one (7-Eleven プライチ keeps listing last week's products with 「※無料クーポンの発券は終了しています」 — 13 of 21 measured items were like that). If the period could not be read there is no ground to drop it, so it stays. The cache file keeps what was read; filtering happens only on the way out. `開始前` also stays — it is information you will soon need.
- The toolbar's `いま使えるものだけ` (`#active-chk`) appears **only when there is something to filter out**. `終了` is already dropped on the server, so all that remains is `開始前` — it shows up only in weeks that carry a not-yet-started campaign.
- `/img?u=` — the server fetches images from the original sites on our behalf (allowed hosts only). Fetched images are kept in `data/img/<sha1>.<ext>` and served from our side afterwards (`lib/images.mjs`), so more visitors never mean more traffic for the konbini servers. The snapshot shares this cache.

## Sharing (keeping it up for free)

`node scripts/snapshot.mjs` produces a single `dist/` — a copy of `public/` plus `data/deals.json` (deals and prices at
that moment) plus `img/` (the downloaded product images). It can be hosted anywhere without a server, and visitors never
touch the konbini sites.

- The screen calls `/api/deals` first and falls back to `data/deals.json` when it is absent (static build) — see `fetchDeals()`. The `更新` button is hidden in the static build.
- Images are rewritten to `img/<hash>.jpg` by the snapshot, so no proxy is needed. When run as a server they still go through `/img?u=`.
- Auto refresh: `.github/workflows/pages.yml` builds a snapshot twice a day (06:20 / 18:20 JST) and publishes it to GitHub Pages. Free for public repositories.
- **`data/prices.json` is committed as a seed** (the only tracked file under `data/` — see `.gitignore`). A runner checks out an empty cache, and looking every price up again is what gets it blocked by 7-Eleven (**403**), which also empties the product images fetched afterwards.
- Between builds the whole `data/` folder (prices **and** downloaded images) is carried by `actions/cache` under a rolling key (`konbini-data-<run_id>` plus `restore-keys`), so each build only has to look up what is genuinely new. The committed seed is the cold start for when that cache is gone.
- Every snapshot keeps only what the deals on air right now use: price entries and image files belonging to deals that are over get dropped (`prune`, `pruneImages`). If the same product shows up again in a later deal it is fetched again, so a stale price or picture is never reused and neither cache grows without bound. A source that failed to load — or has no deals at the moment — is left untouched, so one bad fetch can never empty the seed.
- Images are downloaded **before** prices are looked up, so a 403 while hunting prices no longer costs the pictures too.
- To put it up right now without git, drop the `dist/` folder onto Cloudflare Pages or Netlify Drop (refresh by hand).
- Link previews: og/twitter tags in `public/index.html`, image at `public/og.png`. `node scripts/ogimage.mjs` regenerates og.png, icon-192 and icon-512 with no packages (zlib only) — with no font available it draws 「1+1」 as boxes. When `SITE_URL` is set the snapshot rewrites og:image and og:url to absolute URLs (the workflow passes the Pages address).
- Add to home screen: `public/manifest.webmanifest` + `public/sw.js`. The service worker registers **only over https** so that localhost never gets stuck in the cache during development. Bump `VERSION` in `sw.js` whenever a screen file changes.
- A disclaimer sits at the bottom of the screen (`footer.note` in `public/index.html`): unaffiliated with any of the chains, automatically collected from their official pages, and conditions must be confirmed on the official page.
