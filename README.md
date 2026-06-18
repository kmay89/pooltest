# Pool Water Console

**Dose it right, not twice.** A no-guesswork web console that turns your pool
test readings into the exact amounts of chemical to add — in the right order —
plus seasonal supplies, care routines, trends, and fix-it playbooks.

> Live site: **https://poolwaterconsole.netlify.app/**

![Pool Water Console](og-image.png)

It's tuned out of the box for a **21 ft above-ground vinyl pool (~10,000 gal)**
running tablet chlorine, but every target adapts to your pool from **Pool setup**
on the Dose tab (volume, chlorine product, salt cell, season).

---

## Who it's for

Anyone who tests their own water and would rather add the right dose once than
chase the numbers all week — owners of above-ground or small in-ground pools.
Set your volume, chlorine type, and whether you run a salt cell, and the targets
follow automatically. A first-run **welcome tour** (and the `?` button, top-right)
explains who it's for and how each tab works.

## How to use it — the six tabs

| Tab | What it does |
| --- | --- |
| **Dose** | Enter strip/kit readings (or **Scan strip** from a photo) → exact, ordered add-list. |
| **Buy** | A season shopping list scaled to your pool, with the cheapest time to buy each item. |
| **Care** | Cleaning rhythm, pump runtime, and fill / electricity calculators. |
| **Plan** | This week's outlook (add your ZIP for a live forecast) plus opening, closing, and leak playbooks. |
| **Trends** | Log readings to chart them against the safe band and catch drift early. |
| **Fix-it** | A symptom solver and the stubborn mustard-algae playbook. |

## Your data — local only

No accounts, no analytics, no tracking. All persistence is **`localStorage` in
your browser**: readings, history, maintenance reminders, settings, and your ZIP
are saved **only on your device** — nothing is uploaded to a server. Strip photos
are processed on-device. Export/import (JSON or CSV) on the Trends tab lets you
back up or move your history between devices. **Add to Home Screen** (the install
button) for a full-screen app.

Two optional features make outbound calls **only when you ask**:
- **Plan → Get forecast** geocodes your ZIP ([Zippopotam](https://zippopotam.us/))
  and pulls a 7-day outlook ([Open-Meteo](https://open-meteo.com/)). No account,
  no tracking; the ZIP is stored locally.
- Google Fonts are loaded from a CDN for typography.

Everything else — dosing math, strip color-reading, charts — runs entirely in
the browser with no network.

---

## Architecture

This is a **single self-contained file**: [`index.html`](./index.html). It
inlines all CSS and JavaScript, embeds its own icons and PWA manifest as data
URIs, and ships no build step or dependencies. That makes it trivial to host —
any static file server (or just opening the file locally) works.

```
.
├── index.html      # the entire app (HTML + CSS + JS, ~230 KB)
├── 404.html        # branded not-found page
├── og-image.png    # social share / Open Graph card (1200×630)
├── robots.txt      # crawl directives + sitemap pointer
├── sitemap.xml     # single-URL sitemap
├── netlify.toml    # Netlify deploy, security headers, caching
├── LICENSE         # Apache-2.0
└── README.md
```

## Deploying to Netlify

Netlify serves **`index.html` at the site root** — the HTML is the page.
`netlify.toml` pins down the production config:

- `publish = "."` and an empty `command` — no build, publish the repo root.
- **Security headers** on every route: a scoped Content-Security-Policy,
  HSTS, `X-Frame-Options: DENY` / `frame-ancestors 'none'`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`,
  and COOP/CORP.
- **Caching:** `index.html` always revalidates so updates ship immediately;
  `og-image.png` is allowed to cache.
- **No catch-all rewrite** — the app has no URL-based routing (tabs are
  client-side), so unknown paths return a real 404 via `404.html`. This keeps
  the indexable site free of soft-404s.

**To deploy:**

1. Connect this repo to Netlify (or drag the folder into the Netlify UI).
2. Build command: *(none)* · Publish directory: `.`
3. Deploy. `localStorage` works on any HTTPS origin, so memory persists per
   browser automatically.

For local preview, just open `index.html` in a browser, or:

```bash
npx serve .       # or: python3 -m http.server 8000
```

> A PWA installs best from a hosted HTTPS URL; opening the raw file is fine for
> testing but the manifest behavior is most reliable on the deployed site.

### Regenerating the share image

`og-image.png` (1200×630) is the social-share card. To regenerate it, edit and
re-run the Pillow script used to create it (see commit history), or replace the
PNG directly — keep it 1200×630 and re-scrape caches afterward with the
[Facebook Sharing Debugger](https://developers.facebook.com/tools/debug/).

---

## The dosing math (assumptions)

All amounts are per your configured volume (default 10,000 gal) using
well-established pool-chemistry constants:

- **Free chlorine target scales with CYA** (the Trouble Free Pool model):
  target ≈ **7.5 %** of CYA, algae floor ≈ **5 %**, shock ≈ **40 %**
  (salt cell: ~6 % target, CYA 60–80).
- **Chlorine:** ~10.5 fl oz of 12.5 % liquid per +1 ppm FC / 10k gal
  (and the equivalent for 10 %/8.25 %/6 % bleach, 65 % cal-hypo, 56 % dichlor).
- **Alkalinity:** 24 oz (1.5 lb) baking soda per +10 ppm / 10k gal.
- **pH:** ~8 fl oz muriatic acid (31.45 %) per −0.2 pH; ~6 oz soda ash per +0.2 pH / 10k gal.
- **Stabilizer:** 13 oz cyanuric acid per +10 ppm / 10k gal.
- **Calcium:** ~1.84 oz calcium chloride per +1 ppm / 10k gal (low priority on vinyl).
- **Pump/fill:** turnover = volume ÷ GPM; gal-per-inch = π·r²·(1/12)·7.48 for a
  round pool; pump cost = volts × amps ÷ 1000 × hours × rate.

These are guidance estimates — confirm large or unusual doses against a reliable
drop-test kit before adding. Add chemicals to water (never the reverse), one at a
time, with the pump running. **Not professional, medical, or safety advice.**

---

## License

Copyright © 2026 Karl Meves (ERRERLabs). Licensed under the
[Apache License 2.0](./LICENSE).
