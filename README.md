# Pool Water Console

**Dose it right, not twice.** A single-page web app that turns your test-strip
readings into an exact chlorine dose, a care plan, a shopping list, and trends
over time — tuned for a residential above-ground pool.

🔗 **Live:** https://poolwaterconsole.netlify.app/

![Pool Water Console](og-image.png)

## Features

- **Dose** — Enter your readings (free/total chlorine, pH, alkalinity, hardness,
  CYA) and get the precise amounts to add, in the right order, with the "why."
- **Camera strip-reading** — Snap a photo of an HDX 6-way strip and let the app
  estimate readings (all processed on-device).
- **Buy** — A season shopping list and budget estimate scaled to your pool.
- **Care** — Seasonal guidance plus an optional live 7-day weather outlook.
- **Plan** — Maintenance cadence and reminders.
- **Trends** — Log readings over time and watch the charts light up.
- **Fix-it** — Symptom-driven troubleshooting (cloudy water, algae, chloramines).
- **Installable PWA**, works on mobile, respects reduced-motion, keyboard
  accessible, and prints cleanly.

## The core idea

Your chlorine target isn't a fixed number — it scales with your **cyanuric acid
(CYA)**. CYA shields chlorine from sunlight but also dampens its strength, so the
right free-chlorine level is a *percentage of your stabilizer*. The app builds
every recommendation around that relationship.

## Tech

Plain HTML, CSS, and vanilla JavaScript in a single `index.html` — no build
step, no framework, no bundler. Fonts load from Google Fonts; everything else
is self-contained.

## Privacy

No accounts, no analytics, no tracking. Your readings, history, and settings
live only in your browser's local storage and are never sent to a server.
Strip photos are processed on-device. The only outbound requests are optional:
Google Fonts for typography, and — only when you tap **Get forecast** — your ZIP
sent to public lookup services ([Zippopotam](https://zippopotam.us/) and
[Open-Meteo](https://open-meteo.com/)) to fetch local weather.

## Local development

It's a static file — just open it, or serve the folder:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

### Regenerating the share image

`og-image.png` (1200×630) is the social-share card. To regenerate it, edit and
run the Pillow script used to create it (see commit history), or replace the PNG
directly — keep it 1200×630 and re-scrape caches afterward.

## Deployment

Hosted on **Netlify** as a static site (`publish = "."`, no build command).
Security headers, CSP, and caching are configured in `netlify.toml`.

After deploying changes that affect the share preview, re-scrape caches with the
[Facebook Sharing Debugger](https://developers.facebook.com/tools/debug/).

## Disclaimer

This tool provides **general guidance and estimates only** — not professional,
medical, or safety advice. Always follow product labels, never mix pool
chemicals, and confirm doses with a reliable test kit. Use at your own risk.

## License

Licensed under the [Apache License 2.0](LICENSE).
© 2026 Karl Meves (ERRERLabs).
