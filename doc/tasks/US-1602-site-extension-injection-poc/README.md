# US-1602: PoC — injection hook + late-model discovery fix

**Epic:** [EPIC-120](../../epics/EPIC-120.md) · **Status:** implemented (proof of concept), 2026-10-03

## Goal

Inject a developer-provided script into matching web pages in the browser editor, so that the
script can publish an AiVision model, and make sure a model that appears after the page finished
loading is still found.

## Background

- `BrowserWebviewModel.probeAiVision` reads `window.__aiVision` after `did-stop-loading`, and from
  `dom-ready` for a restored tab. A probe that finds nothing ends the search for that document.
- A shape signal (`refresh()` → `Runtime.addBinding` host signal) was ignored unless the tab already
  had a registration, so a model published late was never discovered.
- The board shim already bundles `ai-vision/remote` as an IIFE (`scripts/dev.mjs`,
  `scripts/build-prod.mjs`).

## What was built

No store, no UI, no trust: a developer-only folder.

| Piece | File |
|---|---|
| Runtime bundle: `expose` + `createElements` (with the highlight overlay) as `window.__persephoneSiteRuntime`; 52 KB, unminified | `src/site-extension-runtime.ts` |
| IIFE build in dev (watch) and prod; `boardShimConfig()` became `iifeConfig(input)` | `scripts/dev.mjs`, `scripts/build-prod.mjs` |
| `getSiteExtensionRuntime` endpoint: reads `site-extension-runtime.js` beside `main.js` (cached when packaged) | `src/ipc/api-types.ts`, `src/ipc/main/core-handlers.ts`, `src/ipc/renderer/api.ts` |
| Source lookup `<data>/site-extensions-poc/<host>.js` (https only, exact host), the injected wrapper, and a timing log `window.__siteExtensionPoc.events` (phases and times only) | `src/renderer/editors/browser/site-extension-poc.ts` |
| `injectSiteExtension(tabId)`: never on Incognito/Tor (even when an agent opened the page); attach CDP with the AI-vision binding, `Runtime.evaluate` in the main world, then probe again | `src/renderer/editors/browser/BrowserWebviewModel.ts` |
| Called on every `dom-ready` | `src/renderer/editors/browser/BrowserView.ts` |
| Late-model fix: a shape signal from a tab with no registration probes again, at most once a second per tab | `BrowserWebviewModel.handleAiVisionSignal` |

The wrapper re-checks `location.protocol`/`hostname` inside the page (the document may have changed
since the URL was read) and sets a non-enumerable `window.__persephoneSiteExtension` marker, so one
document is never injected twice. A throwing site script is caught and logged to the page console.

## Injection methods compared

| Method | Result |
|---|---|
| CDP `Runtime.evaluate` on `dom-ready` (**kept**) | Works on Outlook. CDP evaluation is not subject to the page's Content Security Policy. Injects 60–400 ms after navigation; the model registers within 10–100 ms after that. |
| CDP `Page.addScriptToEvaluateOnNewDocument` | Not built. It only helps a script that must run before the page's own scripts. A model that reads the DOM lazily does not need that, and the debugger would have to be attached before the first navigation. Revisit only for a site that needs early hooks. |
| Webview preload | Not built. A preload runs in the isolated world, so `window.__aiVision` would not be visible to the probe without the rework the epic rules out. |

## Late-model discovery

`expose()` alone sends no signal; only `refresh()` does. A page or extension that publishes late must
call `refresh()` once after `expose()` — the guide must say so (US-1607). Verified with a test
extension that published 3 s after load: found at 3,016 ms.

## Acceptance criteria

- [x] A script in the PoC folder is injected into matching https pages and publishes a model.
- [x] The injection survives the Outlook Content Security Policy.
- [x] Never injected into a private page (verified with an agent-opened Incognito page).
- [x] A model published after load is discovered.
- [x] `npm run typecheck` and lint pass. `build-prod` was not run (it shares `.vite/build` with the
  running dev session); the runtime IIFE was built with the same config by hand.
