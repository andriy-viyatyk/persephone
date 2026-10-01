# EPIC-118: Security hardening — hostile web pages and files

## Status

**Status:** Active
**Created:** 2026-10-01
**Completed:** —

## Overview

A security review on 2026-10-01 asked one question: can a hostile web page, or a hostile file the
user opens, reach the user's files or run code on the machine? Persephone's browser tab is
already well hardened. Two paths around it are not. Markdown is rendered with raw HTML in the
privileged main window, where it runs with Node. The MCP server on localhost accepts requests from
any web page that uses DNS rebinding. Both lead to full code execution.

This epic closes those two holes first. It then adds the layered protections Chrome and Firefox
rely on, so that a single bug no longer leads straight to code execution: a strict page security
policy, no page-initiated jumps into the app, locked Electron fuses, and Mark-of-the-Web on
downloads.

## Threat model

- **Attacker:** a web page loaded in Persephone's browser or in any other browser on the machine;
  a file the user opens (`.md`, `.html`, `.svg`, a document shown by a viewer board, an archive
  entry); text an agent relays from such a page into the Log View.
- **Not in scope:** local malware already running as the user (it can do everything Persephone
  can); boards the user explicitly trusted acting maliciously (the trust dialog is the gate, per
  the trusted-board design); scripts the user runs themselves.
- **Goal of the attacker:** run code (the main window has `nodeIntegration: true` and
  `contextIsolation: false`, so any script in it owns the machine); read or delete files; drive
  Persephone or Mneme through MCP; open local resources without the user asking.

## Goals

- No content Persephone renders — Markdown in any editor, guides, Log View, MCP Inspector, Mneme
  notes — can run script in the main window.
- No web page, in any browser, can talk to Persephone's or Mneme's MCP server.
- A web page cannot make Persephone open an internal page (`mneme:`, `persephone-board:`,
  `folder-editor:`, …) on its own.
- If an injection bug slips in later, the main window's security policy still blocks remote and
  inline script (defense in depth).
- Release binaries cannot be reused as a Node runtime or tampered with in place (fuses + asar
  integrity), before signed releases start (US-1585).
- Downloaded files carry Mark-of-the-Web, so Windows SmartScreen and Office Protected View apply.

## Findings (verified 2026-10-01)

Evidence is from the source and from live probes in the running app (installed 5.0.x release).
Every test page was closed afterwards.

### F1 — Critical: Markdown runs script with Node (confirmed live)

- `src/renderer/editors/markdown/MarkdownBlockView.ts:349-350`: `remarkRehype` with
  `allowDangerousHtml: true` + `rehypeRaw`, so raw HTML in Markdown becomes HAST elements.
- `MarkdownBlockView.ts:378-388` (`renderElement`): every tag goes through `document.createElement`,
  including `script`, `iframe`, `object`, `embed`, `base`, `meta`, `form`, `style`. A script element
  created via the DOM **does** execute when it is connected.
- `src/renderer/editors/markdown/hast-dom.ts:17-19,121`: the only filter strips `on*` properties.
  `href="javascript:…"` passes, and so does `<iframe srcdoc>`.
- `index.html:7` CSP: `script-src 'self' 'unsafe-inline' 'unsafe-eval' file: data: blob: https: http:`
  — no protection against inline or remote script. `child-src` blocks remote iframes but not `srcdoc`.
- `src/main/open-window.ts:52-54`: `nodeIntegration: true`, `contextIsolation: false`, `webSecurity: false`.
- **Live probe:** a page with `<script>` set a global; `typeof require` was `"function"`. An
  `<iframe srcdoc>` reached `parent.require` too. The `javascript:` href was kept.
- Every `MarkdownBlockView` user is exposed: `MarkdownEditor`/`MarkdownBodyView` (`.md` files,
  `persephone-guide://`, archive entries, and remote `https://…/x.md` URLs, which `resolveHttp` in
  `src/renderer/content/builtin-schemes.ts:136-149` opens in an editor because `.md` is a content
  extension), `log-view/items/MarkdownOutputView.ts` (agent-written entries),
  `mcp-inspector/McpInspectorView.ts` and `ResourceContentView.ts` (text from remote MCP servers),
  `mneme-root/MnemeRootEditorView.ts`.
- Related: `src/renderer/editors/mermaid/render-mermaid.ts:143` uses `securityLevel: "loose"`. The
  result is shown as an `<img>` data URL (safe), but Mermaid renders it into the live DOM while
  measuring. The live probe was inconclusive, so move to `"strict"` regardless.

### F2 — High: MCP server open to DNS rebinding (confirmed in code)

- `src/main/mcp-http-server.ts:219` binds `127.0.0.1:7865` (good), with no authentication and no
  `Host` or `Origin` check. `StreamableHTTPServerTransport` is built at `:167-173` without
  `enableDnsRebindingProtection`/`allowedHosts`. SDK 1.29.0 defaults that protection to **off**
  (`node_modules/@modelcontextprotocol/sdk/dist/cjs/server/webStandardStreamableHttp.js:73,112`).
- A plain cross-site request is stopped by the SDK's `Content-Type: application/json` requirement,
  which forces a CORS preflight the server never answers. DNS rebinding is not: the attacker's domain
  re-resolves to 127.0.0.1, the requests become same-origin, and the page can initialize a session,
  read `mcp-session-id`, and call `script.execute` — code execution.
- Mneme (`mneme/src/mcp/server.rs:349-358`) serves rmcp's `StreamableHttpService` with
  `StreamableHttpServerConfig::default()` on loopback. Whether rmcp 1.7 checks `Host` by default is
  **not verified**; Mneme exposes read/write/delete over notes, so it must be checked.

### F3 — Medium: web pages open internal Persephone pages (confirmed live)

- `src/main/browser-service.ts:430-433`: any page-initiated navigation to a scheme outside
  `CHROMIUM_NAVIGATION_PROTOCOLS` is cancelled and sent to the host as `eOpenPipelineCandidate`.
- `src/renderer/api/internal/RendererEventsService.ts:110-117` opens it through `openRawLink` if the
  scheme is registered — no user gesture, no confirmation.
- Registered schemes (`builtin-schemes.ts:337-347`) include `mneme`, `mneme-folder`,
  `persephone-board`, `persephone-guide`, `persephone-toolset`, `folder-editor` (any editor anchored
  at an attacker-chosen folder), `git-tree`, `tree-category`.
- **Live probe:** `location.href = "persephone-guide://editors/browser"` from page script with no
  click opened a Markdown tab. A top-level `data:` navigation did not open anything.
- Chrome's equivalent: the external-protocol prompt ("Open … ?"), shown only after a user gesture.

### F4 — Medium: main-window policy has no defense in depth

- `index.html:7` CSP allows inline script and any `http:`/`https:` script. The only inline script is
  the theme bootstrap at `index.html:14-34`. `'unsafe-eval'` is needed by the scripting runner
  (`src/renderer/scripting/ScriptRunnerBase.ts:84,96` uses `new Function`).
- `webSecurity: false` on the main window (`open-window.ts:54`). The live probes showed the HTML
  preview sandbox (`HtmlBodyView.ts:56`, `sandbox="allow-scripts"`) and board frames
  (`board://<host>`) still isolated from the host, so it is not an escape on its own. Its reason is
  undocumented and needs investigating before anything is removed.

### F5 — Medium: Electron fuses not set

- No fuse configuration exists (`electron-builder.yml`, `scripts/`). `@electron/fuses` 1.8.0 is
  already installed, and electron-builder 26.15.3 supports an `electronFuses` config.
- With defaults, `RunAsNode`, `EnableNodeOptionsEnvironmentVariable`,
  `EnableNodeCliInspectArguments` stay on, and `EnableEmbeddedAsarIntegrityValidation` /
  `OnlyLoadAppFromAsar` stay off. A signed `persephone.exe` would be a signed Node runtime, and the
  portable ZIP's `app.asar` can be edited.
- **Blocker:** `src/main/board-bridge.ts:368-370` runs board Node scripts with
  `ELECTRON_RUN_AS_NODE=1` on `process.execPath`. Turning `RunAsNode` off needs that path moved
  to `utilityProcess.fork` first — the pattern `module-service-supervisor.ts:379` already uses.

### F6 — Medium: Mark-of-the-Web on downloads unverified

- `src/main/download-service.ts:150-235` always asks for a save path (good), and
  `openDownload` (`:75-79`) runs `shell.openPath`. Whether Electron writes the `Zone.Identifier`
  stream is not verified. Without it, a downloaded `.exe` runs without the SmartScreen warning and
  Office documents skip Protected View.

### F7 — Medium: viewer boards turn a rendering bug into code execution

- `src/main/board-protocol-service.ts:71-90` `BOARD_CSP` allows `'unsafe-inline'` script. A
  trusted board's bridge can `execute()` and spawn processes. A catalog viewer board (Word, Excel,
  PowerPoint, PDF, draw.io) parses hostile documents. One HTML-injection bug in such a viewer runs
  script with the full bridge. Board isolation from the host itself held in the live probe.
- Any bridge change here must bump `BOARD_BRIDGE_VERSION`.

### F8 — Low: defense-in-depth gaps (not reachable from a page today)

- `src/main/browser-service.ts:852-900`: `unregister`, `setAudioMuted`, `exitHtmlFullscreen`,
  `hardReload`, `clearProfileData` (any partition name), `clearCache`, and `collectDom` skip the
  `isAppRenderer` sender check the permission handlers use (`:774-778`). Today only the app
  renderer has `ipcRenderer`: the webview preload exposes nothing, and boards have no preload.
- Popup windows (`guardPopupWindow`, `:209-267`) do not get the `will-navigate` guard
  for `file:`/`app-asset:` (Chromium blocks `file:` from web origins on its own).

### Already protected (no work)

- Browser `<webview>`: the preload (`src/preload-webview.ts`) exposes only a `window.chrome` stub;
  `file:`/`app-asset:` navigation blocked; popup chains gated on user focus plus rate limit.
- Permissions (`src/main/permission-policy-service.ts`): per-site, per-profile prompts; USB, HID,
  serial and Bluetooth denied; `display-capture` denied; `openExternal` limited to
  http/https/mailto/tel.
- No `certificate-error` override, no remote-debugging switch, downloads always ask for a path.
- SVG preview and Mermaid output are shown as `<img>` data URLs.
- The HTML preview sandbox and board frames stay isolated from the host (live probes).
- Video stream server: loopback, random-UUID sessions.
- Web-page ai-vision models are labeled as page-authored — the agreed bar; no consent gate.

## Linked Tasks

Severity order is the implementation order. US-1587 and US-1588 are independent and can go first
in either order. Task documents are written when each task starts.

| Task | Title | Finding | Severity | Status |
|------|-------|---------|----------|--------|
| [US-1587](../tasks/US-1587-markdown-html-sanitize/README.md) | Sanitize Markdown HTML; Mermaid strict mode | F1 | Critical | In Progress |
| [US-1588](../tasks/US-1588-mcp-rebinding-origin/README.md) | DNS-rebinding and Origin protection for the Persephone and Mneme MCP servers | F2 | High | In Progress |
| [US-1589](../tasks/US-1589-page-internal-scheme-gate/README.md) | Web pages cannot open internal Persephone schemes | F3 | Medium | Planned |
| [US-1590](../tasks/US-1590-main-window-csp/README.md) | Main-window CSP hardening; investigate `webSecurity: false` | F4 | Medium | Planned |
| [US-1591](../tasks/US-1591-electron-fuses/README.md) | Electron fuses + asar integrity; move board Node scripts off `ELECTRON_RUN_AS_NODE` | F5 | Medium | Planned |
| US-1592 | Mark-of-the-Web on browser downloads | F6 | Medium | Planned |
| US-1593 | Least-privilege viewer boards (no `execute()`, stricter CSP) | F7 | Medium | Planned |
| US-1594 | IPC sender checks and popup navigation guard | F8 | Low | Planned |

### Task scope notes

- **US-1587:** Add `rehype-sanitize` after `rehypeRaw` (or an equivalent allowlist in
  `renderElement` plus a URL filter in `hast-dom.ts`). Base it on GitHub's schema: keep
  `details`/`summary`/`kbd`/`sup`/`sub`/`img`/`br`/tables/`span`/`div` with safe attributes. Drop
  `script`, `iframe`, `frame`, `object`, `embed`, `base`, `meta`, `link`, `form`, `style`.
  Allow `href`/`src` only for `http`, `https`, `mailto`, relative paths, `#` anchors, the
  registered Persephone schemes, and `data:image/*` for images. Keep everything the plugins
  `rehypeMarkdownOverrides`, `rehypeHeadingIds` and `rehypeHighlight` need: classes, ids,
  `data-*` used by code blocks and Mermaid. One choke point covers all users. Check the bundled
  guides and the sample `.md` files still render the same. Mermaid → `"strict"`.
- **US-1588:** Persephone: `enableDnsRebindingProtection: true`,
  `allowedHosts: ["127.0.0.1:<port>", "localhost:<port>"]`. Reject any request whose `Origin`
  header is present and not loopback (agents send none; the in-app MCP Inspector connects through
  Node, which sends none). Mneme: verify rmcp's behavior and add a `Host`/`Origin` tower layer
  if needed. A bearer token in the MCP setup config is optional; decide in the task.
- **US-1589:** For page-initiated navigations, open only http/https in the browser. Drop the other
  registered schemes, or require a recent user gesture plus a confirmation that names the target.
  User-initiated paths (address bar, Markdown links, agent calls) keep working.
  *Decided 2026-10-01 (user):* block platform and script schemes outright; no dialog. Only
  board-claimed schemes, such as the torrent board's `magnet`, stay routable, and only after a real
  user action.
- **US-1590:** Hash the theme bootstrap. Remove `'unsafe-inline'`, `http:`, `https:` from
  `script-src`, and confirm that dev (Vite HMR) and prod still load. Keep `'unsafe-eval'`. Find
  out why `webSecurity: false` is set; remove it if nothing needs it, otherwise document why.
- **US-1591:** Move board Node scripts to `utilityProcess.fork` and check stdin/stdout/kill parity
  with the runner channels. Then set fuses `RunAsNode=false`,
  `EnableNodeOptionsEnvironmentVariable=false`, `EnableNodeCliInspectArguments=false`,
  `EnableEmbeddedAsarIntegrityValidation=true`, `OnlyLoadAppFromAsar=true`,
  `EnableCookieEncryption=true` (check existing browser profiles survive the cookie migration).
  Coordinate with US-1585 (signing).
- **US-1592:** Verify with a live download. If no `Zone.Identifier` is written, write it in the
  `done` handler for completed downloads, with the `ZoneId=3` and `ReferrerUrl`/`HostUrl` lines
  that Chrome writes.
- **US-1593:** Design first. Add a manifest capability (for example `"execute": false`) that the
  bridge enforces, and/or a CSP without `'unsafe-inline'` for boards that opt in. Then update the
  catalog viewer boards in `persephone-boards`. Bump `BOARD_BRIDGE_VERSION`.
- **US-1594:** Add the `isAppRenderer` check to the listed handlers, validate partition names
  against known browser partitions, and give popup windows the same `will-navigate` protocol guard.

## Concerns / Open questions

- **Markdown HTML users rely on.** Guides and user notes may use `<img>`, `<details>`, `<kbd>`,
  inline `<span style>`. The allowlist must keep them, and inline `style` should stay. Embedded
  `<video>`/`<iframe>` players in notes would stop working; acceptable for safety, so say so in
  `whats-new.md`.
- **Origin rejection vs browser-based MCP clients.** A web-hosted MCP inspector would be refused.
  That is the intent, but document it in `mcp-setup.md`.
- **RunAsNode migration risk.** Board Node scripts depend on stdin/stdout/exit semantics. A
  `utilityProcess` behaves slightly differently (no TTY, `process.parentPort`), so it needs a
  regression pass over the boards that use `persephone.proc` with `node: true`.
- **US-1588 ↔ US-1590 coupling.** In-app MCP clients (`McpConnectionManager`, the Mneme
  connection) use the renderer's Chromium `fetch`, which sends no `Origin` only because the main
  window has `webSecurity: false`. US-1588 refuses any `Origin`, so if US-1590 removes
  `webSecurity: false` it must also give `McpConnectionManager` a Node-based `fetch`.
  *Resolved by US-1590:* `webSecurity: false` stays, with its reasons documented at the setting.
- **Mneme is already rebinding-safe.** rmcp 1.7's default config restricts `Host` to loopback
  names, so for Mneme US-1588 only adds the `Origin` check.
- **Cookie-encryption fuse** may invalidate existing browser profile cookies once; check before
  turning it on.

## Notes

### 2026-10-01
- Review done by Claude directly at the user's request (not delegated). The live probes used
  temporary pages in the installed release; none were saved.
- Ordered by severity: F1 and F2 are each one choke point and lead to code execution, so they come
  first. The rest are defense in depth.
