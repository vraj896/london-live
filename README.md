# NEXT BUS — London live arrivals

A mobile-first webapp showing live London bus, Tube, Overground, Elizabeth line,
DLR and tram arrivals, styled after the amber dot-matrix countdown signs at
London bus stops.

**Live at <https://vraj896.github.io/london-live/>** — open it on your phone
and "Add to Home Screen" to install it like an app. Deploys automatically on
every push to `main`.

## Run it

No build step, no dependencies. Serve the folder over HTTP:

```sh
cd london-live
python3 -m http.server 8642
```

Then open <http://localhost:8642>. (Serving over HTTP rather than `file://` is
needed for geolocation and the PWA manifest.)

To use it on your phone on the same Wi-Fi, open `http://<your-mac-ip>:8642`
— then "Add to Home Screen" installs it like an app. Note that browsers only
allow geolocation on `localhost` or HTTPS, so for the Nearby tab on your phone
deploy it to any static host (GitHub Pages, Netlify, Cloudflare Pages — it's
just five static files).

## Features

- **Nearby** — geolocates you and lists stops/stations within 700 m, closest first.
- **Search** — find any stop or station; bus stops show their "towards" direction and zone.
  Full postcodes (e.g. `SW9 8HE`) work too, geocoded via [postcodes.io](https://postcodes.io).
- **Saved** — star a stop on its board to pin it (stored in `localStorage`).
- **Live board** — arrivals sorted by time, auto-refreshing every 30 s, with
  TfL line colours, platform/stop letters, and blinking "due" for <1 min.
- **Line status strip** — live Tube/DLR/Overground/Elizabeth/tram status, refreshed every 2 min.

## Data

[TfL Unified API](https://api.tfl.gov.uk) — free, CORS-enabled, no API key
required (anonymous use is rate-limited to ~50 requests/min, plenty for one
user). The app displays the "Powered by TfL Open Data" attribution required
by TfL's licence. Polling pauses while the tab is hidden. Hub stations (e.g. `HUBBRX`) return no arrivals directly, so the app
expands them to child stop points and queries each (capped at 12, results
cached per stop). Trains terminating at the viewed station are filtered out.

**National Rail** services (Southeastern, Thameslink etc.) are not included —
TfL's arrivals feed doesn't cover them. Adding them would need the National
Rail Darwin API (free registration + token, and a small proxy server to keep
the token off the client).

## Files

- `index.html` — markup: three tabs + the arrivals board overlay
- `styles.css` — the countdown-sign aesthetic (Doto dot-matrix + Hanken Grotesk)
- `app.js` — TfL API calls, geolocation, search, favourites, board refresh
- `manifest.json`, `icon.svg` — PWA install metadata

## Dev note

The `.claude/launch.json` preview config serves a copy from
`/tmp/london-live-preview` because the sandboxed preview server can't read
`~/Documents` (macOS privacy). After editing files, re-copy them there, or
just run the `python3 -m http.server` command above yourself.
