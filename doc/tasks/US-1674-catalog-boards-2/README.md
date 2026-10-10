# US-1674: Catalog boards, part 2

Epic: [EPIC-126 — Boards localization](../../epics/EPIC-126.md), F1–F9. Plan only; implementation runs later in `C:/projects/persephone-boards` on `develop`.

## Goal

Make the ten catalog viewers use English board packs for user-facing UI, expose their metadata through `manifest.*` only in translated packs, and require bridge 1.36.0. Keep data and agent-facing text English.

## Background

Per EPIC-126 F1–F9 and the Languages guide, each board declares `languages: { folder: "lang", default: "en" }`, keeps English messages in `lang/en.json`, and calls `persephone.i18n.t(key, params)`. English `name`, `description`, `editorName`, view titles and capability titles remain in `board-manifest.json`; do not put `manifest.*` keys in the English pack. Update each board's `minBridgeVersion` to `1.36.0` and bump its semver `version` as required by `C:/projects/persephone-boards/CLAUDE.md`: add a one-line `WHATS-NEW.md` entry under the next version heading, keep that heading equal to the manifest version, and make the change on `develop`. Never hand-edit generated `boards-manifest.json` or `versions-manifest.json`; publishing/merging to `main` is outside this task.

Each viewer wraps a renderer or format parser. The plan extracts board-owned chrome, accessible labels, status/footer copy, toasts, prompts, empty/error states and toolbar text only. Certificate fields/OIDs, PE header names, SQL, spreadsheet/document contents, file-format identifiers and renderer payloads stay data. `.app`/AiVision descriptions, thrown agent diagnostics, console text and guides remain English (D3). Use a small helper per board matching its existing script style. Pass `persephone.locale.code` to a renderer only where its public options support locale; use locale-aware `Intl` for hand-formatted UI numbers/dates where the board currently formats them.

`persephone-boards/CLAUDE.md` requires changes on `develop`, a version bump for every shipped change, a matching top `WHATS-NEW.md` version heading, and treats publishing as a separate merge-to-main action. All ten board folders have board-specific `CLAUDE.md` notes; each will be followed during implementation. Vendored `lib/`, `vendor/`, minified bundles, and generated files are excluded from string extraction.

## Implementation Plan

For every board below: add `lang/en.json` with `messages` and no `manifest.*`; add `languages` and bridge minimum to `board-manifest.json`; update the manifest version and `WHATS-NEW.md`; add one helper and replace only listed user-facing literals with `t()`; preserve technical/data and agent-facing English. Before → after pattern: `button.textContent = "Reload"` → `button.textContent = t("toolbar.reload")`; `notify("Unable to open file", "error")` → `notify(t("errors.openFile"), "error")`. The helper is `const t = (key, params) => persephone.i18n.t(key, params)` (adapt global alias/module syntax to each board).


### `cert-viewer` — 49 messages

| File:line | Key | English |
|---|---|---|
| `index.html:6,12,15,17,21,29-34` | `document.title`, `empty.open`, `list.title`, `order.note`, `tabs.aria`, `password.title`, `password.help`, `password.label`, `password.cancel`, `password.open` | Certificate Viewer; Open a certificate file to inspect it.; Certificates; Order is best-effort from subject and issuer names. It does not establish trust or validate a chain.; Certificate report sections; PKCS#12 password; This file may be encrypted. Enter its password to list public certificates.; Password; Cancel; Open |
| `app.js:31-33,78-80,96-98,156` | `tab.overview`, `tab.extensions`, `tab.details`, `action.copy`, `action.copyField.title`, `toast.copy.success`, `toast.copy.error`, `count.none` | Overview; Extensions; Raw / Details; Copy; Copy public certificate field; Copied public certificate value; Copy failed: {error}; none |
| `app.js:231,233,268,285,302,322-325,346,351-357` | `fingerprints.title`, `fingerprints.loading`, `fingerprints.error`, `extensions.empty`, `input.privateKey`, `input.csr`, `input.unsupported`, `input.parseError`, `certificate.pem.title`, `action.copyPem.title`, `input.contents` | Certificate fingerprints (original DER bytes); Computing SHA-1 and SHA-256…; Fingerprints unavailable: {error}; No extensions are present.; Private key block detected ({label}); key material is hidden.; Certificate request (PKCS#10); Unsupported PEM block: {label} (contents hidden).; Could not parse {label}: {error}; Certificate (PEM); Copy the certificate as PEM; Input contents |
| `app.js:393-422,448,493,641-642,670-678,690,708-739,753-760` | `title.siteCertificate`, `title.inputSummary`, `status.certificate`, `status.certificates`, `status.certificateInput`, `status.request`, `order.warning`, `password.rejected`, `errors.openSiteCertificate`, `status.requestFailed`, `status.loading`, `errors.restoreSiteCertificate`, `status.restoreFailed`, `status.loadingFile`, `status.noFile`, `empty.supportedFormats`, `status.passwordCancelled`, `errors.inspectFile`, `toolbar.reload`, `status.scope` | Site certificate; Input summary; {count} certificate; {count} certificates; Certificate input; certificate request; dynamic best-effort ordering warning; Password or file was not accepted. Try again, or cancel.; Could not open site certificate.; Certificate request failed; Loading…; Could not restore the site certificate.; Certificate restore failed; Loading certificate file…; No file open; Open a .cer, .crt, .der, .pem, .pfx, .p12, .p7b or .p7c file to inspect it.; Password entry cancelled.; Could not inspect this file.; Reload certificate; Descriptive parsing only · no chain validation or revocation checks |

The 49 are board-authored UI message definitions; file-derived certificate field labels, algorithm/OID names, PEM/DER values and `certificate.view` request validation/rejection diagnostics remain English technical or agent-facing content. `index.html` loads classic scripts in order, so add `i18n.js` before `app.js` and use a single `const t = ...` helper. Keep hand-rendered certificate dates locale-aware with `Intl.DateTimeFormat(persephone.locale.code, ...)` only if changing the current ISO UTC display is appropriate; counts should use `Intl.NumberFormat` (or a plural message with `{count}`). No renderer locale option: x509 and Forge expose format parsing, not UI locale. **Live check:** register `C:/projects/persephone-boards/boards/cert-viewer` with `boards.registerBoard`, open a synthetic `.pem`/`.p12` fixture from `boards/cert-viewer/_test/cert-viewer`, plus empty page and password cases, then inspect `ui.log` under `en-XA`.


### `drawio-viewer` — 22 messages

| File:line | Key | English |
|---|---|---|
| `index.html:5,222,226,233,246,255-256,261` | `document.title`, `board.name`, `action.openDrawing.title`, `action.save.title`, `action.copy.title`, `action.saveSvg`, `action.savePng`, `zoom.reset.title` | DrawIO Viewer; DrawIO Viewer; Open in Drawing Editor (edit a copy in Excalidraw); Save current page as an image (SVG or PNG); Copy diagram as PNG to clipboard; Save as SVG; Save as PNG; Reset zoom (double-click diagram) |
| `app.js:317,616-619,702-705,724-727,791,948,953,966` | `empty.noContent`, `toast.copy.success`, `toast.copy.error`, `toast.saveSvg.success`, `toast.saveSvg.error`, `toast.savePng.success`, `toast.savePng.error`, `toast.openDrawing.error`, `board.name` | Empty-host state; Diagram copied to clipboard as PNG.; Copy failed: {error}; Diagram saved as SVG.; Save as SVG failed: {error}; Diagram saved as PNG.; Save as PNG failed: {error}; Open in Drawing Editor failed: {error}; DrawIO Viewer |
| `app.js:486-494` | `page.tab` | Diagram page names come from user document data and stay English. |

The inventory also includes the state branches in `app.js:814,837,969` (The file is empty.; Failed to render diagram: {error}; Open a .drawio file to view it here.); after deduplicating repeated `DrawIO Viewer`, the count is **22**. The display strings embedded in diagrams remain user content. Add `i18n.js` before `app.js`; the global classic-script style uses `const P = window.persephone`, so helper should bind to `P.i18n.t`. GraphViewer is loaded from `lib/viewer-static.min.js`; its own navigation toolbar is explicitly disabled (`nav:false`) because it relies on remote assets, and it has no locale option used here. Format the zoom percent with locale-aware `Intl.NumberFormat` only if presentation changes beyond the current integer-percent UI. **Live check:** register local `boards/drawio-viewer`, open a multi-page `.drawio` fixture, and separately open an empty content-host board; verify page tabs, export/copy feedback and error state under `en-XA`.


### `excel-viewer` — 10 messages

| File:line | Key | English |
|---|---|---|
| `index.html:5,154,158-159` | `document.title`, `board.name`, `search.placeholder`, `toolbar.reload.title` | Excel Viewer; Excel Viewer; Search…; Reload the file from disk |
| `app.js:236,246,278,280,282,294,308,330` | `state.sheetEmpty`, `state.loading`, `state.noFile`, `state.supportedTypes`, `state.noSheets`, `state.openError`, `toast.openError` | This sheet is empty.; Loading…; No file open.; Open a .xlsx or .xls file to view it here.; This workbook has no sheets.; Could not open this file.; dynamic caught error shown in toast |

Count deduplicates `Excel Viewer`; sheet names, cells, column letters, row indices, formulas and SheetJS formatted cell text are user data. Put `i18n.js` before the classic-script `app.js`, bind to `P.i18n.t`, and localize only board states/toast. `av-grid` renders its own Copy/Copy as context actions; it has no locale option in this board's configuration, so those library-owned menu labels remain renderer-provided English and must be reviewed as a third-party limitation. SheetJS has no UI and its `cell.w` values are spreadsheet content; do not rewrite them with `Intl`. No hand-formatted dates/numbers. **Live check:** register local `boards/excel-viewer`, open a multi-sheet `.xlsx` fixture and a blank worksheet, exercise search/reload, and verify the board under `en-XA`.


### `force-graph` — 118 messages

Source split: treat the readable board-authored files `app.js`, `graph-actions.js`, `graph-panels.js`, `graph-ui.js`, `index.html`, and the authored portions of `graph-core.js` / `graph-renderer.js` as the translation surface. `lib/` is vendored D3 (exclude it); `graph-aivision.js` and `guides/` are agent-facing (keep English); `examples/*.fg.json` is user data. The authored source is substantial, so implementation should inventory these files separately from vendor code before extraction.

| File:line | Key families | English examples / scope |
|---|---|---|
| `index.html:32-44` | `toolbar.*`, `search.*` | Force tuning, Enable grouping, Reset view, Expand all nodes, Search nodes…, Clear search, Open in Drawing Editor, Copy Image to Clipboard; include visible fallback button text and title/aria labels |
| `app.js:122,250,416-462,519,534,644,729,936` | `toast.*`, `toolbar.expandAll`, `state.invalidJson`, `empty.open` | save/open/copy/drawing/link failures; Graph image copied to the clipboard.; Expand All Nodes; This file is not valid JSON.; Open a .fg.json file to view it here. |
| `graph-actions.js:100,217,294,312,360,376,389,409,417,467,544` | `actions.*`, `warnings.*` | Delete Nodes, Group Title, Group Options, Ungroup, Delete Group; Cannot extract group(s) only…; Select one node first…; Cannot add: would create circular group hierarchy.; Cannot group: selected nodes/groups belong to different groups. |
| `graph-panels.js:39-40,92-96,180-181,227,231,352,399-505,733-857,890-897` | `panel.*`, `legend.*`, `tuning.*`, `expansion.*`, `search.*` | Legend, Root, Group, Level {level}; Search highlighting is active, Clear search; select node for edit; Drag to resize; Batch edit level and shape for {count} selected nodes; Cancel, Apply; Charge, Distance, Collide, Reset; (auto — lowest level), No matching node; Root Node, Expand Depth, Max Visible; Depth and max visible apply when file is reopened; and {count} more…; [{count} hidden] |
| `graph-ui.js:281-282,318-402,464-484` | `dialog.*`, `context.*`, `tooltip.*` | Cancel, OK; Open link…, Add Child, Set as Root, Collapse, Select children/members, Delete Link to…, Group Selected, Remove from Group, Edit Title, Delete (Ungroup), Delete with Children, Add Node, Highlight, Copy/Open (markdown), Open in grid, Extract/Extract with children, Delete {count} Node(s); Root Node, Group; Copy as Markdown; Open in new page |

The count includes distinct authored UI messages and dynamic/plural forms after key reuse; graph node/edge labels, titles, property keys/values, IDs, group names, search queries, data validation text exposed to agents, and `graph-aivision.js` descriptions stay English. Add a classic-script `i18n.js` before authored UI modules and expose one `window.forceGraphT(key, params)` helper so all scripts share one binding without lexical `const` collisions. No Persephone-registered toolbar is present; the board's own DOM toolbar/context menus are all in scope. D3 force simulation is not a renderer UI and has no locale option. Hand-formatted graph counts should use `Intl.NumberFormat(persephone.locale.code)`; graph data values are untouched. **Live check:** register local `boards/force-graph`, open `examples/greek-gods.fg.json`, also open an untitled page containing `{"type":"force-graph"}`, then check search, grouping/actions, panels and notifications under `en-XA`.


### `pdf-viewer` — 17 board messages

| File:line | Key | English |
|---|---|---|
| `index.html:5,73,76` | `document.title`, `frame.title`, `status.loading` | PDF Viewer; PDF document; Loading… |
| `app.js:264-314,319,358-360` | `errors.bridge`, `status.opening`, `status.resolving`, `errors.read`, `toast.read`, `empty.instructions`, `errors.viewer`, `toast.viewer`, `status.reading`, `errors.open`, `toast.open` | Persephone bridge unavailable; This board must run inside Persephone.; Opening…; Resolving the document source.; Could not read the document; Failed to read the PDF source: {error}; This board opens PDF files. Open a .pdf file to view it.; Could not load the PDF viewer; PDF viewer frame failed to load — see the board for details.; Reading…; Could not open the document; Failed to open PDF: {error} |
| `app.js:199-204` | `probes.*` | Nested iframe (frame-src); pdf.js worker (worker-src); WebAssembly (wasm-unsafe-eval) |

The 15 count is the wrapper's UI copy and probe labels; caught low-level probe `note` values are technical diagnostics in the board's capability table, while `console.*` and `pdf-aivision.js` errors/descriptions remain English. Add `i18n.js` before `app.js` and bind to `P.i18n.t`. The nested stock viewer `lib/pdfjs/web/viewer.html` owns search, outline, thumbnails, zoom, print and download UI; exclude its vendored strings from extraction but inspect its locale support and bundled `web/locale` assets. During implementation pass `persephone.locale.code` through the PDF.js viewer's supported locale parameter/configuration and retain its English fallback; do not assume the frame's navigator locale matches the app. No board-hand-formatted number/date display; PDF page/document text is data. **Live check:** register local `boards/pdf-viewer`, open `_test/sample.pdf` plus an empty board, and check wrapper states and stock viewer controls under `en-XA` (PDF text remains unchanged).


### `pe-viewer` — 33 messages

| File:line | Key families | English |
|---|---|---|
| `index.html:5,264-265` | `document.title`, `board.name`, `toolbar.reload.title` | PE Viewer; PE Viewer; Reload the file from disk |
| `app.js:142-218,161-193,235-393` | `image.icon.alt`, `badge.*`, `section.*`, `copy.title`, `empty.*`, `state.detailsMissing` | icon; PE; Signed; Unsigned; Packed: {hints}; File; Security mitigations; Fingerprint; Click to copy; COFF header; Optional header; Data directories; Sections ({count}); Imports; No import table (statically linked, or resolved another way).; Exports; No exported functions{suffix}; Digital signature; Certificate names (best-effort); Hashes; Version info (all strings); Rich header (build provenance); Debug; Application manifest; Details; No version-info, manifest, debug, or Rich-header data found in this binary. |
| `app.js:208,402-404,435,443,448,490-491` | `hash.skipped`, `toast.copy.success`, `toast.copy.error`, `state.loading`, `state.noFile`, `state.openError`, `toast.openError` | skipped (large file); Copied; Copy failed: {error}; Loading…; No file open. Open an .exe, .dll, .sys, .ocx or .scr file to inspect it here.; Could not open this file.; dynamic caught error toast |

The count covers board-owned section headings/status/action copy only; PE/COFF header field names, directory names, enum values, OIDs, executable metadata/resource strings and parser diagnostics remain English/data. Add a classic `i18n.js` before `app.js`; use `window.PEViewerT` or the local binding consistently. `pe-parser.js` has no UI locale and stays unchanged. Format byte sizes, entropy/percentages and compiled timestamp with `Intl.NumberFormat` / `Intl.DateTimeFormat(persephone.locale.code)` only where these values are board-formatted; keep raw hexadecimal and format constants unchanged. **Live check:** register local `boards/pe-viewer`, open a synthetic `.exe`/`.dll` (the board notes mention system binaries; prefer safe local test fixtures), exercise tabs/copy/hash and empty/error states under `en-XA`.


### `powerpoint-viewer` — 10 messages

| File:line | Key | English |
|---|---|---|
| `index.html:5,129-145` | `document.title`, `board.name`, `slides.counter`, `slides.previous.title`, `slides.next.title`, `toolbar.reload.title` | PowerPoint Viewer; PowerPoint Viewer; – (empty counter); Previous slide; Next slide; Reload the file from disk |
| `app.js:134,146,187,209-210` | `state.loading`, `state.noFile`, `state.noSlides`, `state.openError`, `toast.openError` | Loading…; No file open. Open a .pptx file to view it here.; This deck has no slides.; Could not open this file.; dynamic caught error toast |

`pptx-preview` renders slide content (user-authored text, shapes, tables and images) and exposes no board chrome/locale UI option; keep document content, speaker notes and chart data in its source language. Add classic `i18n.js` before `app.js`, binding `P.i18n.t`. Format the hand-rendered slide counter with `Intl.NumberFormat(persephone.locale.code)` while preserving its `current / total` structure. **Live check:** register local `boards/powerpoint-viewer`, open a sample `.pptx` from the board's `_test` fixture (or a user test deck), verify previous/next, no-slides and load-error states under `en-XA`; slide text stays as authored.


### `sqlite-viewer` — 22 messages

| File:line | Key families | English |
|---|---|---|
| `index.html:5,205-228`; `tables.html:5,65` | `document.title`, `board.name`, `search.placeholder`, `action.open.title`, `action.reload.title`, `query.placeholder`, `query.run`, `query.stop`, `query.shortcut`, `tables.title`, `tables.empty` | SQLite Viewer; Search results…; Open a SQLite database file…; Re-open the database from disk; SELECT … (pick a table in the Tables sidebar panel, or type a query); Run; Stop; Ctrl+Enter; Tables; No database open. |
| `tables.js:25-26` | `tables.kind`, `views.kind` | Tables; Views |
| `app.js:282,314,323,329,341,345,347,379,402,417,461` | `state.noColumns`, `status.running`, `status.rows`, `status.error`, `status.cancelling`, `status.cancelled`, `state.opening`, `state.noTables`, `state.openError`, `state.noDatabase` | The statement returned no columns.; Running…; {count} rows in {ms} ms{truncation}; Error: {error}; Cancelling…; Query cancelled.; Opening database…; This database has no tables.; Could not open this database.; No database open. Open a .db / .sqlite file, or use the folder button above. |

No SQLite engine UI: the board owns query controls and its `Tables` secondary view (the `board-manifest.json` title remains English; no English `manifest.*`). SQL text, schema/table/column names, result rows, error payloads returned by SQLite, and database content remain English. `app.js` and `tables.js` are classic scripts; add one `i18n.js` before both, with `window.sqliteT`. `av-grid`'s Copy context actions are library-owned English and expose no locale setting here. Replace `toLocaleString()` with `Intl.NumberFormat(persephone.locale.code)` for row counts; do not localize SQL. **Live check:** register local `boards/sqlite-viewer`, open a sample `.db`, inspect the `Tables` secondary view, run the default table query and a no-columns/invalid SQL query, then check `en-XA` and `ui.log`.


### `torrent-viewer` — 76 messages

| File:line | Key families | English |
|---|---|---|
| `index.html:5,271-296` | `document.title`, `panes.torrents`, `action.removeAll.title`, `list.session.aria`, `magnet.placeholder`, `magnet.aria`, `action.add`, `splitter.aria`, `panes.files`, `list.files.aria` | Torrent Viewer; Torrents; Remove every torrent from the board; Session torrents; magnet:?xt=…, an info hash, or a .torrent path; Magnet link, info hash, or torrent path; Add; Resize torrent list; Files in {torrent}; Torrent files |
| `index.html:303-333`; `app.js:1674-1719,1776-1804` | `network.*` | Network, Close, Connection, Direct, SOCKS5 proxy, Host, Port, Username, Password, optional, The username and password are stored in plain text in this board's storage.; Trackers and peers are reached directly: the swarm sees your IP address.; Test, Cancel, Save, Save and restart, Network setting invalid, Applying the network setting…, The network setting could not be applied: {error} |
| `app.js:628-657,926,952,1003,1041,1070-1108,1135-1149,1207-1228,1418-1518,1855-1857` | `menu.*`, `status.*`, `empty.*`, `toolbar.*` | Copy magnet link; Magnet link copied.; Copy info hash; Save .torrent…; Remove; Cancel; Retry; Open; Copy link; Download this file; Resolution cancelled.; Removed.; Resolving metadata…; {name} / {count} files / metadata only; Enter a magnet link, an info hash, or choose a .torrent file.; Saved {name}.; Could not save the .torrent file.; Torrent link copied.; Reading {name}…; No active torrents.; Torrent service starting…; Torrent service stopping…; No matching torrent is active.; Torrent removed.; All torrents removed.; Some torrents could not be removed.; Metadata only. No file content is selected.; Network settings |

Include all user-visible network-setting dialog chrome, file/torrent context menus, empty/loading/error/status states and notifications in the 76-key count; keys, magnet/info hashes, paths, file names, peer/log payloads, network mode values and service diagnostics remain English/data. `app.js` is a single classic script; add `i18n.js` before it and expose one `window.torrentT`. WebTorrent/service supplies data only and has no end-user locale UI. Use `Intl.NumberFormat(persephone.locale.code)` for file/byte sizes, speeds, progress percentages and counts currently hand-formatted; do not translate swarm payloads. **Live check:** register local `boards/torrent-viewer`, inspect the empty state, menu/toolbar and proxy settings dialog under `en-XA`; for service status use only a controlled fake/no-network producer. Do not open a real torrent or join a swarm during autonomous verification; the user owns any real-torrent check.


### `word-viewer` — 7 messages

| File:line | Key | English |
|---|---|---|
| `index.html:5,148-159`; `app.js:179,194,248` | `document.title`, `board.name`, `toolbar.reload.title`, `zoom.help`, `state.loading`, `state.noFile`, `state.openError` | Word Viewer; Word Viewer; Reload the file from disk; Zoom: Ctrl + Mouse Wheel (or Ctrl and + / − / 0). Click here to reset to 100%.; Loading…; No file open. Open a .docx file to view it here.; Could not open this file. |

The docx-preview renderer and JSZip have no board chrome or locale option: they render user document content, which remains unchanged. Keep `word-aivision.js`, guide content, document text, metadata and thrown diagnostics in English/data. Add classic `i18n.js` before `app.js`, using `window.wordT`; use `Intl.NumberFormat(persephone.locale.code)` for the hand-rendered zoom percentage if formatting it with locale digits. **Live check:** register local `boards/word-viewer`, open the board's `_test/sample.docx`, verify reload/zoom and empty/error states under `en-XA`; document headings, lists, tables and image labels remain user content.



### Manifest and release version edits

Use patch releases because these changes add localization readiness without changing board capabilities. Bump both `board-manifest.json` and the top `WHATS-NEW.md` heading together; add a terse localization line. Per `persephone-boards/CLAUDE.md`, verify the next tag is unused before release. Current → planned version:

| Board | Current → planned | Minimum bridge | Metadata stays English in manifest |
|---|---:|---|---|
| `cert-viewer` | `1.0.1` → `1.0.2` | `1.36.0` | name, description, editorName, capability title |
| `drawio-viewer` | `1.1.2` → `1.1.3` | `1.36.0` | name, description, editorName |
| `excel-viewer` | `1.2.2` → `1.2.3` | `1.36.0` | name, description, editorName |
| `force-graph` | `1.0.1` → `1.0.2` | `1.36.0` | name, description, editorName |
| `pdf-viewer` | `1.1.1` → `1.1.2` | `1.36.0` | name, description, editorName |
| `pe-viewer` | `1.0.4` → `1.0.5` | `1.36.0` | name, description, editorName |
| `powerpoint-viewer` | `1.1.1` → `1.1.2` | `1.36.0` | name, description, editorName |
| `sqlite-viewer` | `1.1.1` → `1.1.2` | `1.36.0` | name, description, editorName, secondary view title |
| `torrent-viewer` | `1.9.3` → `1.9.4` | `1.36.0` | name, description, editorName |
| `word-viewer` | `1.1.1` → `1.1.2` | `1.36.0` | name, description, editorName |

Each manifest adds exactly `"languages": { "folder": "lang", "default": "en" }`; `lang/en.json` contains `{ "messages": { ... } }`, with no `manifest.*` entries. No board is honestly manifest-only: even the smallest wrapper has user-visible loading, error, empty, toolbar, or accessibility text.

### Implementation sequence

1. On `develop`, confirm each manifest/changelog current version and unused next release tag; write the inventory in the table above into each board's `lang/en.json` (using stable dot-separated keys and placeholders for dynamic values).
2. Add one helper per board in the script style listed below. Load it before consumer scripts. Replace only board-authored UI copy; replace dynamic plurals with CLDR message objects and numeric `{count}` parameters.
3. Add locale-aware formatting to board-owned numeric/date displays identified per section. Pass `persephone.locale.code` to PDF.js only via its supported locale configuration and available packaged locales; leave document/certificate/spreadsheet/slide/graph/torrent data unchanged.
4. Edit each manifest and `WHATS-NEW.md` as one release unit, then open each local board in Persephone and inspect its UI and `ui.log` under `en-XA`. Also inspect English behavior and every explicitly listed empty/error/dialog/secondary-view path.
5. Keep generated catalog manifests untouched; do not merge to `main` or publish as part of implementation.

### Concerns

- PDF.js owns a large stock viewer UI. Its localization assets/configuration are third-party and must be verified in the vendored 5.4.530 tree before wiring `persephone.locale.code`; if the requested locale is absent, use pdf.js's English fallback. Do not copy vendor strings into this board's pack.
- `av-grid` owns Copy / Copy as context menu labels for Excel and SQLite; Force Graph supplies its own board-authored menu labels to `AVGrid.showMenu`. Confirm no board labels are being mistaken for grid-generated labels during implementation.
- User payloads can resemble UI copy. Treat all cell/document/diagram/graph/database/torrent names and values as data. Preserve `.app` and AiVision descriptions, errors surfaced to agents, logs, parser constants, and user-facing guides in English per F5/D3.
- Torrent Viewer board guidance prohibits autonomous real-swarm checks. Validate its UI with an empty board and controlled fake/no-network service status; the user performs any real-torrent check.

## Acceptance Criteria

- All ten boards declare the English pack folder/default and require bridge `1.36.0`; each has a matching patch version and top changelog heading on `develop`.
- Each extracted board-owned UI message is in `lang/en.json`, and its source uses the board's single `t()` helper. English manifest values remain in the manifest and `lang/en.json` has no `manifest.*` keys.
- Under `en-XA`, every board-authored string listed in its inventory (including static HTML, attributes, notifications, menus, status items and sidebar view text) is pseudo-localized; all data and agent-facing text remains English.
- Third-party viewers keep their own controls and are passed app locale where the library supports it; unsupported libraries have no copied vendor strings in the board pack.
- Manual numbers/dates shown by board chrome use `persephone.locale.code` formatting; data display follows each underlying format.
- Every live route in the board sections is checked in Persephone, including empty/error paths and SQLite's Tables secondary view; torrent verification stays no-network.
- `boards-manifest.json` and `versions-manifest.json` are untouched; no publish or `main` merge occurs.

## Files Changed

| File | Planned change |
|---|---|
| `C:/projects/persephone-boards/boards/cert-viewer/board-manifest.json`, `WHATS-NEW.md` | Add languages, bridge minimum, patch version/changelog. |
| `C:/projects/persephone-boards/boards/cert-viewer/lang/en.json`, `i18n.js`, `index.html`, `app.js` | Add catalog/helper and translate HTML and rendered UI strings. |
| `C:/projects/persephone-boards/boards/drawio-viewer/board-manifest.json`, `WHATS-NEW.md` | Add languages, bridge minimum, patch version/changelog. |
| `C:/projects/persephone-boards/boards/drawio-viewer/lang/en.json`, `i18n.js`, `index.html`, `app.js` | Add catalog/helper and translate toolbar, menu, toast and state text. |
| `C:/projects/persephone-boards/boards/excel-viewer/board-manifest.json`, `WHATS-NEW.md` | Add languages, bridge minimum, patch version/changelog. |
| `C:/projects/persephone-boards/boards/excel-viewer/lang/en.json`, `i18n.js`, `index.html`, `app.js` | Add catalog/helper and translate search, reload and state text. |
| `C:/projects/persephone-boards/boards/force-graph/board-manifest.json`, `WHATS-NEW.md` | Add languages, bridge minimum, patch version/changelog. |
| `C:/projects/persephone-boards/boards/force-graph/lang/en.json`, `i18n.js`, `index.html`, `app.js`, `graph-actions.js`, `graph-panels.js`, `graph-ui.js` | Add catalog/helper and translate board-authored toolbar, panels, menus and notifications. |
| `C:/projects/persephone-boards/boards/pdf-viewer/board-manifest.json`, `WHATS-NEW.md` | Add languages, bridge minimum, patch version/changelog. |
| `C:/projects/persephone-boards/boards/pdf-viewer/lang/en.json`, `i18n.js`, `index.html`, `app.js` | Add catalog/helper, translate wrapper states and pass the app locale to pdf.js. |
| `C:/projects/persephone-boards/boards/pe-viewer/board-manifest.json`, `WHATS-NEW.md` | Add languages, bridge minimum, patch version/changelog. |
| `C:/projects/persephone-boards/boards/pe-viewer/lang/en.json`, `i18n.js`, `index.html`, `app.js` | Add catalog/helper and translate board-authored headings, tabs, statuses and actions. |
| `C:/projects/persephone-boards/boards/powerpoint-viewer/board-manifest.json`, `WHATS-NEW.md` | Add languages, bridge minimum, patch version/changelog. |
| `C:/projects/persephone-boards/boards/powerpoint-viewer/lang/en.json`, `i18n.js`, `index.html`, `app.js` | Add catalog/helper and translate navigation and state text. |
| `C:/projects/persephone-boards/boards/sqlite-viewer/board-manifest.json`, `WHATS-NEW.md` | Add languages, bridge minimum, patch version/changelog. |
| `C:/projects/persephone-boards/boards/sqlite-viewer/lang/en.json`, `i18n.js`, `index.html`, `app.js`, `tables.html`, `tables.js` | Add catalog/helper and translate query controls, statuses and secondary view. |
| `C:/projects/persephone-boards/boards/torrent-viewer/board-manifest.json`, `WHATS-NEW.md` | Add languages, bridge minimum, patch version/changelog. |
| `C:/projects/persephone-boards/boards/torrent-viewer/lang/en.json`, `i18n.js`, `index.html`, `app.js` | Add catalog/helper and translate board chrome, context actions, network settings and status items. |
| `C:/projects/persephone-boards/boards/word-viewer/board-manifest.json`, `WHATS-NEW.md` | Add languages, bridge minimum, patch version/changelog. |
| `C:/projects/persephone-boards/boards/word-viewer/lang/en.json`, `i18n.js`, `index.html`, `app.js` | Add catalog/helper and translate loading, empty/error and zoom guidance. |
| No change: `C:/projects/persephone-boards/boards-manifest.json`, all `versions-manifest.json` | Generated by publishing automation; never edit by hand. |
| No change: each board's `lib/`, `vendor/`, minified files, `guides/`, AiVision/agent model and parser/service data code | Vendor, user data, and agent-facing English are out of scope except the app locale bridge described above. |
| No change: `doc/epics/EPIC-126.md`, `doc/active-work.md` | Explicitly outside the requested plan-only change. |
| No change: this Persephone app's runtime/bridge source | Bridge 1.36.0 is already supplied by US-1667; this task changes catalog boards only. |

### Proposed implementation split

- **Run 1:** `force-graph`, `cert-viewer`, `drawio-viewer`, `pdf-viewer`, `word-viewer` — one complex authored UI board plus four viewers with mostly wrapper-owned strings.
- **Run 2:** `torrent-viewer`, `sqlite-viewer`, `excel-viewer`, `pe-viewer`, `powerpoint-viewer` — network/settings/status UI plus the database, spreadsheet, PE and slide viewers.



