# EPIC-120: Site extensions — injected AiVision models for web pages

## Status

**Status:** Active. Proof of concept done (2026-10-03): **go**. US-1604 onward are to be rewritten from the report.
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

## Proof of concept result (2026-10-03)

**Go.** See the [US-1603 report](../tasks/US-1603-outlook-poc/README.md):

- **Injection.** CDP `Runtime.evaluate` on `dom-ready`, then a probe. The Content Security Policy does not block it.
- **Model timing.** The model is up within 0.1–0.4 s of every navigation, and the list is ready at 1.3–1.9 s.
- **Lifecycle.** It survives reloads, cross-host arrival, session restore and two tabs.
- **Private pages.** None get injected.
- **Cost.** The model costs 4–6 times fewer tokens than snapshots for a list, and about 19 times fewer for a body.
- **Not tested:** a real sign-in redirect, long idle or sleep, and `outlook.live.com`.

The report lists the changes US-1604 onward need. The main ones:

- a list of hosts per extension;
- no shape-changed or navigated events when the shape did not change;
- `refresh()` after a late `expose()`.

## Decisions (after the proof of concept, 2026-10-03)

- **Layout.** `<userData>/data/site-extensions/<id>/` holds `manifest.json` plus the script. The id
  is the folder name, restricted to lower-case letters, digits and hyphens. As with boards, there
  is no nesting.
- **Manifest.** `name`, `version`, `description`, `hosts` and `script` (a relative path, default
  `extension.js`). `hosts` lists exact host names: https is implied, and there are no wildcards
  and no ports. Outlook alone needs three hosts.
- **One extension per host.** If two valid extensions claim the same host, neither is injected
  there and both report the conflict. A page has one `window.__aiVision`, and a silent winner
  would be confusing.
- **The store is read in the renderer**, where injection happens. The manifest index is cached
  and revalidated by manifest modification time on each lookup. The script is read fresh on every
  injection, so an agent's edit takes effect on the next reload.
- **US-1604 injects every valid extension; US-1605 adds the trust gate.** The two ship in the same
  release, and nothing is released between them.

## Decisions for trust (US-1605, 2026-10-03)

- **Trust is keyed by extension id and its host list.** The prompt fires again when the hosts
  change, because that widens where the extension runs. It does not fire again on script edits. This
  matches boards, which are trusted by folder and asked again only when their permissions change, and
  it keeps an agent's edit-and-reload authoring loop working. The prompt says plainly that the script
  can do anything the signed-in site can do.
- **Main owns the trust file**, `<userData>/data/trustedSiteExtensions.json`, and broadcasts it to
  every window, in the same way as `trustedBoards.txt` (US-1538). Trust is never read from the
  extension folder. It is not exposed on `app` or to scripts, so nothing can trust itself.
- **No automatic trust, even for an extension an agent created** (US-1606). Unlike a board, the
  code runs inside the user's signed-in session for a real site. That is exactly what the user
  must approve.
- **The prompt appears in the browser page**, not as a modal. It shows the first time a matching
  host loads with an untrusted extension: "Site extension *Outlook* wants to run on
  outlook.cloud.microsoft", with **Trust** and **Not now**. Trusting injects into the current
  document straight away. "Not now" stays quiet for that tab until the next navigation. Agents never
  click **Trust** (the same rule as boards).
- **Management lives in a "Site extensions" section in Settings.** Each extension shows its name,
  hosts, status (valid, invalid with the reason, or conflict) and trust. The section also offers an
  **Enabled** switch (a trusted extension can be disabled without losing trust), **Revoke trust**,
  **Open folder** and **Remove**. Remove deletes the folder after a confirmation and also drops its
  trust.

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| [US-1602](../tasks/US-1602-site-extension-injection-poc/README.md) | PoC: injection hook (developer-only, no UI) + fix late-model discovery | Implemented |
| [US-1603](../tasks/US-1603-outlook-poc/README.md) | PoC: Outlook model + reliability test matrix + go/no-go report | Done: go |
| [US-1604](../tasks/US-1604-site-extension-store/README.md) | Site extension store: folder layout, manifest, host matching, injection on navigation | Implementation in progress |
| [US-1605](../tasks/US-1605-site-extension-trust/README.md) | Registration and trust: trust prompt, list, enable/disable, remove | Planned |
| US-1606 | Agent tools: scaffold an extension for the current host, reload it in place, list, remove | Draft (after PoC) |
| US-1607 | Guides: site-extension authoring in `ai-vision.md` / `browser.md`; agent workflow | Draft (after PoC) |
| US-1612 | Quieter page-model events: no `shape-changed` for an identical shape, no `navigated` for a same-document navigation under a live model | Draft |

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
- **US-1604 — store, manifest, host matching, injection.** Replaces the PoC folder and the PoC
  source lookup (`site-extension-poc.ts`); keeps the PoC's injection path (CDP `Runtime.evaluate`
  on `dom-ready`, then a probe), its private-page rule and the late-model fix. Decisions are in
  "Decisions (after the proof of concept)" below. Also: minify the runtime bundle in the production
  build, and stop the duplicate registration (the post-injection probe and the load probe often
  register the same version twice).
- **US-1605 — registration and trust.** Must land in the same release as US-1604. Decisions are in
  "Decisions for trust (US-1605, 2026-10-03)" below.
- **US-1606 — agent tools.** Reloading in place needs the old remote disposed first, because
  injection is once per document (report item 8).
- **US-1607 — guides.** Covers the authoring lessons in report item 7.
- **US-1612 — quieter events** (report items 4 and 5). This is host-side and also affects boards and
  pages that publish their own model, so it is its own task.
