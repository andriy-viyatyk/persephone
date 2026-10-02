# EPIC-120: Site extensions — injected AiVision models for web pages

## Status

**Status:** Planned (proof of concept first; the full feature is decided after it)
**Created:** 2026-10-02
**Completed:** —

## Overview

An agent reading a web app such as Outlook in Persephone's browser today snapshots and clicks its
way through the page. That is slow and costs many tokens per question. A web page can already
publish an AiVision model (`window.__aiVision`, mounted at `pages[id].editor.app`), but only if
the site's own code does it. This epic lets the user register a **site extension**, a script
for a host that Persephone injects into matching pages. The script publishes an AiVision model,
so the agent asks `app.messages` instead of reading the page.

The agent writes the script itself: it studies the page once, writes the model, and checks it
through `$help`. After that it uses the model, not snapshots.

The epic starts with a **proof of concept** (US-1602, US-1603). It shows whether an injected model
on a real, heavy single-page app stays reliable through reloads, navigation, session restore and
sign-in redirects. The full feature (US-1604 onward) is built only if the proof of concept passes,
and its task list is revised from what it finds.

## What already exists (verified 2026-10-02)

- **Probe.** `BrowserWebviewModel.probeAiVision` (`src/renderer/editors/browser/BrowserWebviewModel.ts:397`)
  runs on `did-stop-loading` and on `dom-ready` for a restored tab. It evaluates `window.__aiVision`
  through CDP and registers the shape for that tab and document generation. A navigation
  (`did-start-loading`) clears it.
- **Re-probe and staleness.** `refresh()` in the page sends a shape signal through the
  `Runtime.addBinding` host signal (`src/main/cdp-service.ts:512`). The host re-probes. The proxy
  also checks `version` before every request.
- **Isolation.** Page content is labelled `page:` and stays inside `.app`. Private browser pages
  (Incognito, Tor) are refused by `agentMayAccessBrowserPage` (`editors/browser/agent-access.ts`).
- **Authoring guide.** "Web pages in the browser editor" in `assets/guides/agents/ai-vision.md`.

### Gap the proof of concept must close first

A model that appears **after** the page finishes loading is never found. `probeAiVision` marks the
generation as probed even when it finds nothing (`BrowserWebviewModel.ts:405-407`), and a later
`refresh()` signal is ignored because `handleAiVisionSignal` needs an existing registration
(`:463-464`). Outlook builds its UI long after `did-stop-loading`, so this must change. One option:
a shape signal with no registration triggers one probe for the current generation, rate-limited.
Another: the injector probes again after it injects.

## Decisions

- **2026-10-02 (user): proof of concept before the feature.** Reliability has to be shown on a
  real site (Outlook) across reloads, navigation and restore before the store, trust and UI are
  built.
- **Injected into the page's main world.** The probe reads `window.__aiVision` there. An isolated
  world would protect the model from the page's own scripts, but the probe would need rework.
  Revisit only if the proof of concept shows page scripts interfering.
- **The `ai-vision/remote` runtime is injected with the script**, built as one standalone script,
  in the same way the highlight overlay is injected. The site does not ship it.
- **Never on private pages.** Incognito and Tor tabs get no injection, the same rule as automation.
- **The model returns what the agent needs, and no more.** A mailbox can hold sensitive data, so
  lists return headers (subject, sender, date, ids). Bodies come only from an explicit `read(id)`.
  Proof-of-concept reports give counts, timings and pass/fail, never mailbox content.
- **The script runs in the user's signed-in session**, so it can do anything the page can. In
  the full feature an extension is registered and trusted like a board, matched by exact host over
  https, and members that send, move or delete carry `caution`.

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-1602 | PoC: injection hook (developer-only, no UI) + fix late-model discovery | Planned |
| US-1603 | PoC: Outlook model + reliability test matrix + go/no-go report | Planned |
| US-1604 | Site extension store: folder layout, manifest, host matching, injection on navigation | Draft (after PoC) |
| US-1605 | Registration and trust: trust prompt, list, enable/disable, remove | Draft (after PoC) |
| US-1606 | Agent tools: scaffold an extension for the current host, reload it in place, list, remove | Draft (after PoC) |
| US-1607 | Guides: site-extension authoring in `ai-vision.md` / `browser.md`; agent workflow | Draft (after PoC) |

### Task scope notes

- **US-1602 — injection hook.** No store, no UI, no trust. A developer-only setting or fixed
  folder (for example `<data>/site-extensions-poc/<host>.js`) and the bundled remote runtime.
  Compare three ways to inject, and keep the one that survives the matrix:
  1. CDP `Page.addScriptToEvaluateOnNewDocument`. It runs before the page's scripts on every
     navigation, but the debugger must already be attached when the first navigation happens.
  2. `executeJavaScript` on `dom-ready` / `did-frame-finish-load` from main.
  3. A webview preload.

  Also close the late-model gap described above. Check that the site's Content Security Policy
  does not block the injected code.
- **US-1603 — Outlook PoC and matrix.** An agent studies Outlook once and writes the model, for
  example:
  - `folders`;
  - `messages` (indexable, headers only);
  - `read(id)`;
  - `search(text)`;
  - `open(id)`;
  - `refresh()` when the list changes.

  It uses roles and labels rather than generated class names. Run each case and record pass/fail,
  time to model, and how many calls a stale model refuses:
  - first load after sign-in, including the `login.microsoftonline.com` → Outlook redirect;
  - soft reload and hard reload (Ctrl+Shift+R);
  - switching folders inside the app, with no document navigation;
  - opening a message; using the browser's back and forward;
  - session restore at app start;
  - a tab in the background, then made active;
  - two internal tabs on the same host;
  - new mail arriving while the page is open (does `refresh()` fire?);
  - the message list is virtualized, so `messages` must report what it can see or page
    through it honestly;
  - leaving the page open idle for a long time or across sleep and wake;
  - the hosts `outlook.office.com` / `outlook.office365.com` / `outlook.live.com`;
  - a private tab gets nothing;
  - the page's own console shows no new errors.

  Compare the tokens a typical "what is new in my inbox" question costs through the model and
  through snapshots. The report ends with a go/no-go and the changes US-1604+ need.
- **US-1604 to US-1607** are placeholders. They are rewritten after US-1603's report.
