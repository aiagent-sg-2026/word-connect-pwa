# Word Connect PWA

An original, family-safe, offline-first swipe-word puzzle PWA. The M1 vertical slice is implemented locally: 20 hand-authored levels, installable PWA shell, IndexedDB save data, coins/hints, swipe and accessible tap play, save export/import, recovery/reset, and automated tests/smoke checks.

## Run locally

```bash
npm install
npm run dev
```

Vite dev uses local HTTPS via `@vitejs/plugin-basic-ssl` for PWA-compatible development.

## Test and build

```bash
npm test
npm run build
```

Browser smoke after building:

```bash
npm run preview -- --host 127.0.0.1 --port 4175
SMOKE_URL=http://127.0.0.1:4175 npm run smoke
```

The smoke check verifies the built app in Chromium at 390x844, 834x1112, 1280x900, 1440x900, and 320px narrow; checks for no horizontal overflow/page errors; plays a target through the tap fallback; then proves a warm offline reload.

## Install/offline behavior

1. Run `npm run build` and serve with `npm run preview` or any HTTPS/static host.
2. Open the app once online so the Service Worker and runtime assets cache.
3. Install from the browser PWA prompt/menu.
4. Reopen or reload offline; the app shell, content, and IndexedDB save continue to work locally.

Device-only validation still required for cold installed-PWA airplane launch and iOS standalone status-bar rendering.

## Documentation

- [DESIGN.md](DESIGN.md) — architecture and decisions
- [SPEC.md](SPEC.md) — normative requirements and acceptance criteria
- [ROADMAP.md](ROADMAP.md) — phased implementation plan
- [PROGRESS.md](PROGRESS.md) — implementation/review/QA handoff
