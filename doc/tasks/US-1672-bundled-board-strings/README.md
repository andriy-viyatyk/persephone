# US-1672: Bundled boards — REST Client packs, Excalidraw `langCode`

Epic: [EPIC-126 — Boards localization](../../epics/EPIC-126.md), F1–F9. Reviewed plan; implementation in progress.

## Goal

Make the bundled REST Client’s user-facing copy use its English board pack and make Excalidraw render in the best locale available in its locally bundled language set. Preserve English for HTTP/data values and all agent-facing text.

## Background

Boards declare `languages: { folder: "lang", default: "en" }`, require bridge `1.36.0`, store the default messages in `lang/en.json`, and call `persephone.i18n.t(key, params)`. The shim exposes `persephone.locale.code`; lookup is current locale, base locale, default pack, then key. English manifest values remain in `board-manifest.json`. Per F1/F7, `manifest.*` entries belong only in translated packs; this task adds none. `en-XA` pseudo-localizes board-pack strings.

The REST Client is plain JavaScript and is outside lint coverage. `index.html` runs `src/main.js` as an ES module in both the main and Requests board views. Each frame receives the board shim before the module runs, so a small `src/i18n.js` can export `t = (key, params) => persephone.i18n.t(key, params)` and be imported from views, components, and the model. The model is also used by the UI; user-visible model errors need the same helper. `src/ai-vision-model.js` is only exposed through `persephone.aiVision.expose()` and describes the `.app` surface/elements for agents; its summaries and thrown diagnostics are agent-facing and remain English under D3.

Excalidraw’s `assets/boards/excalidraw/index.html` creates the React root and mounts `Excalidraw` from `./lib/index.js`. Its current `Excalidraw` prop defaults to the vendor `defaultLang` (`en`); pass a selected `langCode` prop. The vendor bundle exports `languages` (`xi`) and contains a dynamic-import map for locale chunks. `scripts/build-board-lib.mjs` currently filters out all locale files except `locales/en-*`. `board-manifest.json` grants `network: false`, so fetching locales remotely is not an option. Bundle every Excalidraw locale available for a non-English language in roadmap §4: `uk-UA`, `pl-PL`, `lt-LT`, `lv-LV`, `ro-RO`, `sk-SK`, `hu-HU`, `de-DE`, `fr-FR`, `es-ES`, `pt-BR`, `it-IT`, `zh-CN`, `ja-JP`, and `ko-KR` (15 chunks, about 33 KB each; Estonian and Belarusian have no Excalidraw locale and use English). Exact/base mapping must only select a locale whose chunk is packaged, otherwise fall back to `en`.

Bundled boards are read directly from `<appRoot>/assets/boards` by `src/renderer/editors/board/bundled-board-registry.ts`; there is no startup install/copy step. `electron-builder.yml` copies the complete `assets` directory to resources. Thus a new REST Client `lang/` pack and the additional Excalidraw locale chunk ship through the existing asset paths. The current app bridge is raised to `1.36.0` in US-1667, and bundled boards are shipped with that app, so this manifest minimum is satisfied by the bundled distribution.

### REST Client inventory

Count: **94 distinct English message definitions** proposed for `lang/en.json`. Each distinct key below is one message; repeated uses share a key. Concatenated messages and plural forms stay a single message with placeholders. Dynamic request names, file paths, HTTP response fields, and user-authored content are placeholders/data, never extracted as source strings.

In the REST Client inventory, `src/...` paths are relative to `assets/boards/rest-client/`.

#### `assets/boards/rest-client/src/main.js`

| File:line | Proposed key | English text |
|---|---|---|
| `src/main.js:21` | `errors.send` | Unable to send request. |
| `src/main.js:31` | `errors.collection.read` | Unable to read REST Client collection |

#### `assets/boards/rest-client/src/request-builder.js`

| File:line | Proposed key | English text |
|---|---|---|
| `src/request-builder.js:41` | `request.empty.selection` | No request selected |
| `src/request-builder.js:47,49` | `request.collection.label` | Collection |
| `src/request-builder.js:54,56` | `request.name.label` | Request name |
| `src/request-builder.js:58` | `request.copyAs.title` | Copy request as... |
| `src/request-builder.js:64` | `request.delete.title` | Delete request |
| `src/request-builder.js:66` | `confirm.request.delete` | Delete “{name}”? (`{name}` uses `request.empty.label` when unnamed) |
| `src/request-builder.js:72` | `request.method.label` | HTTP method |
| `src/request-builder.js:75` | `request.url.placeholder` | Enter request URL |
| `src/request-builder.js:75` | `request.url.label` | Request URL |
| `src/request-builder.js:78` | `toolbar.sending` | Sending... |
| `src/request-builder.js:78` | `toolbar.send` | Send |
| `src/request-builder.js:81` | `toolbar.cancel` | Cancel |
| `src/request-builder.js:113` | `request.headers.title` | Headers |
| `src/request-builder.js:115` | `request.headers.view` | Headers view |
| `src/request-builder.js:116` | `request.headers.copyJson` | Copy headers as JSON |
| `src/request-builder.js:122` | `errors.copyHeaders` | Unable to copy headers. |
| `src/request-builder.js:136` | `request.headers.json.label` | Request headers JSON |
| `src/request-builder.js:140` | `request.headers.json.objectError` | Headers JSON must be an object. |
| `src/request-builder.js:153` | `request.headers.json.invalidBeforeTable` | Fix invalid JSON in headers before switching to Table |
| `src/request-builder.js:160` | `request.body.title` | Body |
| `src/request-builder.js:161` | `request.body.type` | Body type |
| `src/request-builder.js:13` | `request.body.option.none` | none |
| `src/request-builder.js:13` | `request.body.option.formData` | form-data |
| `src/request-builder.js:13` | `request.body.option.formUrlEncoded` | x-www-form-urlencoded |
| `src/request-builder.js:13` | `request.body.option.raw` | raw |
| `src/request-builder.js:13` | `request.body.option.binary` | binary |
| `src/request-builder.js:162` | `request.body.language` | Body language |
| `src/request-builder.js:115` | `view.mode.table` | Table |
| `src/request-builder.js:115` | `view.mode.json` | JSON |
| `src/request-builder.js:187,196` | `errors.selectFile` | Unable to select a file. |
| `src/request-builder.js:193` | `request.file.noneSelected` | No file selected |
| `src/request-builder.js:194` | `request.file.browse` | Browse |
| `src/request-builder.js:200` | `request.body.empty` | This request has no body. |

#### `assets/boards/rest-client/src/views/request-tree.js`

| File:line | Proposed key | English text |
|---|---|---|
| `src/views/request-tree.js:3` | `request.empty.label` | (empty) |
| `src/views/request-tree.js:23` | `requests.title` | Requests |
| `src/views/request-tree.js:24` | `request.add.title` | Add request |
| `src/views/request-tree.js:88` | `request.add.context` | Add Request |
| `src/views/request-tree.js:89` | `collection.delete.title` | Delete Collection |
| `src/views/request-tree.js:91` | `confirm.collection.delete` | Delete all requests in “{name}”? |
| `src/views/request-tree.js:123` | `request.duplicate` | Duplicate |
| `src/views/request-tree.js:124` | `request.delete.context` | Delete |

#### `assets/boards/rest-client/src/views/response-viewer.js`

| File:line | Proposed key | English text |
|---|---|---|
| `src/views/response-viewer.js:30` | `response.title` | Response |
| `src/views/response-viewer.js:35` | `response.empty.sending` | Sending request... |
| `src/views/response-viewer.js:35` | `response.empty.prompt` | Send a request to see the response. |
| `src/views/response-viewer.js:41` | `response.status.error` | Error |
| `src/views/response-viewer.js:42` | `response.time` | {time} ms |
| `src/views/response-viewer.js:43` | `response.size` | {size} |
| `src/views/response-viewer.js:48` | `response.tab.body` | Body ({size}) |
| `src/views/response-viewer.js:49` | `response.tab.headers` | Headers ({count}) — plural object with `one` / `other` and `{count}` |
| `src/views/response-viewer.js:51` | `response.view` | Response view |
| `src/views/response-viewer.js:53` | `response.headers.view` | Response headers view |
| `src/views/response-viewer.js:48` | `response.tab.body` | Body ({size}) (same key as above) |
| `src/views/response-viewer.js:49` | `response.tab.headers` | Headers ({count}) — plural object with `one` / `other` and `{count}` (same key as above) |
| `src/views/response-viewer.js:53` | `view.mode.table` | Table (reuse the key above) |
| `src/views/response-viewer.js:53` | `view.mode.json` | JSON (reuse the key above) |
| `src/views/response-viewer.js:54` | `response.headers.copyJson` | Copy headers as JSON |
| `src/views/response-viewer.js:57` | `errors.copyResponseHeaders` | Unable to copy response headers. |
| `src/views/response-viewer.js:61` | `response.language` | Response language |
| `src/views/response-viewer.js:62` | `response.openTab.title` | Open in new tab |
| `src/views/response-viewer.js:64` | `response.openTab.documentTitle` | Response |
| `src/views/response-viewer.js:65` | `errors.openResponse` | Unable to open response. |
| `src/views/response-viewer.js:89` | `response.binary.description` | {contentType} · {size} (with `Unknown content type` fallback) |
| `src/views/response-viewer.js:90` | `response.binary.save` | Save to File |
| `src/views/response-viewer.js:96` | `response.image.alt` | Response image preview |
| `src/views/response-viewer.js:96` | `response.image.open` | Open in Image Viewer |
| `src/views/response-viewer.js:111` | `response.binary.saved` | Response saved. |
| `src/views/response-viewer.js:112` | `errors.saveResponse` | Unable to save response. |

#### `assets/boards/rest-client/src/components/confirm.js`

| File:line | Proposed key | English text |
|---|---|---|
| `src/components/confirm.js:7` | `confirm.title` | Confirm |
| `src/components/confirm.js:7` | `confirm.delete` | Delete |
| `src/components/confirm.js:29` | `confirm.cancel` | Cancel |

#### `assets/boards/rest-client/src/components/key-value-table.js`

| File:line | Proposed key | English text |
|---|---|---|
| `src/components/key-value-table.js:32` | `fields.header.enable` | Enable header |
| `src/components/key-value-table.js:32` | `fields.field.enable` | Enable field |
| `src/components/key-value-table.js:37` | `fields.header.name` | Header name |
| `src/components/key-value-table.js:37` | `fields.key` | Key |
| `src/components/key-value-table.js:46` | `fields.value` | Value |
| `src/components/key-value-table.js:55` | `fields.row.delete` | Delete row |

#### `assets/boards/rest-client/src/components/form-data-table.js`

| File:line | Proposed key | English text |
|---|---|---|
| `src/components/form-data-table.js:17` | `fields.field.enable` | Enable field (reuse the key above) |
| `src/components/form-data-table.js:19` | `fields.key` | Key (reuse the key above) |
| `src/components/form-data-table.js:22` | `formData.file` | File |
| `src/components/form-data-table.js:22` | `formData.text` | Text |
| `src/components/form-data-table.js:23` | `formData.type.toggleTitle` | Switch between a text value and a file |
| `src/components/form-data-table.js:28` | `request.file.noneSelected` | No file selected (reuse the key above) |
| `src/components/form-data-table.js:29` | `request.file.browse` | Browse (reuse the key above) |
| `src/components/form-data-table.js:33` | `fields.value` | Value (reuse the key above) |
| `src/components/form-data-table.js:39` | `formData.field.delete` | Delete field |

#### `assets/boards/rest-client/src/components/splitter.js`

| File:line | Proposed key | English text |
|---|---|---|
| `src/components/splitter.js:8` | `accessibility.resizeHeadersBody` | Resize headers and body |
| `src/components/splitter.js:8` | `accessibility.resizeRequestResponse` | Resize request and response panes |

#### `assets/boards/rest-client/src/request-copy.js`

| File:line | Proposed key | English text |
|---|---|---|
| `src/request-copy.js:72` | `request.copyAs.curlBash` | Copy as cURL (bash) |
| `src/request-copy.js:73` | `request.copyAs.curlCmd` | Copy as cURL (cmd) |
| `src/request-copy.js:74` | `request.copyAs.fetch` | Copy as fetch |
| `src/request-copy.js:75` | `request.copyAs.fetchNode` | Copy as fetch (Node.js) |
| `src/request-copy.js:92` | `errors.copyRequest` | Unable to copy request. |

#### `assets/boards/rest-client/src/request-execution.js`, `src/rest-client-model.js`, and `src/response-cache.js`

| File:line | Proposed key | English text |
|---|---|---|
| `src/request-execution.js:20,36,51` | `errors.requestBodyLimit` | Request body exceeds the 32 MiB limit. |
| `src/request-execution.js:35,49` | `errors.fileBridgeBinary` | The file bridge did not return binary data. |
| `src/rest-client-model.js:26` | `errors.notCollection` | This file is not a REST Client collection. |
| `src/rest-client-model.js:501` | `request.default.name` | Request (generated initial name for an empty/invalid URL) |
| `src/rest-client-model.js:387` | `errors.sendPrerequisite` | Select a request with a URL before sending. |
| `src/rest-client-model.js:388` | `errors.invalidHeadersBeforeSend` | Fix invalid JSON in headers before sending. |
| `src/rest-client-model.js:475` | `errors.saveCollection` | Unable to save REST Client collection. |
| `src/response-cache.js:27` | `errors.restoreResponseCache` | Unable to restore response cache. |
| `src/response-cache.js:62` | `errors.saveResponseCache` | Unable to save response cache. |

`src/rest-client-model.js` also throws capability input-validation messages (`:92–121`) and request/header/form access diagnostics (`:299–381`) through its agent-facing `.app` model. Leave those literals in English under D3; they are not pack entries. `src/ai-vision-model.js` is exclusively agent schema/help/description text (including its own thrown action diagnostics), not rendered UI; leave all of it English. `src/http-constants.js` HTTP methods and common header names, actual request/response header names, server reason phrases/status codes, URLs, response/body data, request names, and all other user-authored content remain data in English. Console/log text and uncaught diagnostics also remain English. `src/response-utils.js` byte-unit symbols (`B`, `KB`, `MB`, `GB`) and programming-language identifiers are technical notation; localize the surrounding size/time messages, and format numeric placeholders with the app locale where appropriate.

Manifest copy stays English in this phase: `board-manifest.json:3` name `REST Client`, `:4` description `The bundled REST Client editor.`, `:26` capability title `Open HTTP request`, and `:34` secondary view title `Requests`. There is no `editorName` or settings declaration in this manifest. No `manifest.*` messages go in `lang/en.json` (F1/F7); translated packs in a later task can carry those reserved keys. `index.html:5` `<title>REST Client</title>` is document metadata, not board-rendered copy; the host uses manifest display text. This board’s own `guides/index.md` describes UI labels and named controls, but is agent-facing documentation and remains English under D3.

### Excalidraw locale selection

Use `persephone.locale.code` as the input and the exported `languages` array from `./lib/index.js` as the authoritative set of vendor codes. Normalize a code case-insensitively. Choose: exact app-code match first; then exact base-language match (compare the primary subtags, e.g. app `de-AT` to vendor `de-DE`); otherwise `en`. Before choosing, restrict candidates to locale chunks actually present in `lib/locales/`. The built-in set is `uk-UA`, `pl-PL`, `lt-LT`, `lv-LV`, `ro-RO`, `sk-SK`, `hu-HU`, `de-DE`, `fr-FR`, `es-ES`, `pt-BR`, `it-IT`, `zh-CN`, `ja-JP`, and `ko-KR`; Estonian and Belarusian use English. Keep the list in one constant in `index.html`, aligned with `scripts/build-board-lib.mjs`. Do not add a CDN fetch; the existing entry’s dynamic import map loads the selected bundled chunk.

Excalidraw board-owned copy is currently the browser document title in `index.html` and manifest values (`name`, description, setting label/description, and capability titles). The task adds no translated packs, so keep this metadata English per F7. Its manifest declares no `languages`; it needs `minBridgeVersion: "1.36.0"` because Excalidraw reads `persephone.locale`. There is no separate board toolbar/message layer around the vendor canvas to extract into a REST Client-style pack. Excalidraw’s own UI text is supplied by the vendor locale chunk.

## Implementation Plan

- [x] 1. Add `assets/boards/rest-client/lang/en.json` with the 94 distinct entries above in a `messages` object. Make `response.tab.headers` a CLDR plural object with `{count}`; use placeholder values for request/collection names, size, time, and content type. Avoid translating data values and stable identifiers.
- [x] 2. Add `languages: { "folder": "lang", "default": "en" }` and set `minBridgeVersion` to at least `"1.36.0"` in `assets/boards/rest-client/board-manifest.json`. Leave English metadata in the manifest and add no `manifest.*` keys.
- [x] 3. Add `assets/boards/rest-client/src/i18n.js` and import its `t` helper in each source module with user-visible strings. Localize view labels, component labels/ARIA text, notifications and UI errors. Thread `t` to any utility/model call paths that must be frame-safe, or import the helper there directly. Check both main and Requests frames. Keep request/response data, `.app` names, AI Vision descriptors/errors, console diagnostics, and server values in English.
- [x] 4. Update `assets/boards/excalidraw/board-manifest.json` to require bridge `1.36.0` or higher if its current minimum is lower; do not declare `languages`. Update `assets/boards/excalidraw/index.html`: import the exported `languages`, derive a packaged-supported locale with exact → base-language → English fallback, and pass it as `langCode` to `<Excalidraw>`. Maintain English fallback for app locales whose locale chunk is not shipped.
- [x] 5. Update `scripts/build-board-lib.mjs` to retain English plus the 15 roadmap locales listed above. Use an explicit kept-locale list with a comment that it follows the roadmap’s built-in set. Keep validation aligned with the retained locale set and verify every retained dynamic-import target is present. The vendor copy and target validation completed; esbuild’s later dependency-bundle phase exited with sandbox `spawn EPERM`. No network permission or runtime locale download was added.
- [x] 6. Do not edit REST Client `guides/index.md` or add any `manifest.*` entries: its text is agent guidance (D3), and this phase adds no translations (F7).
- [x] 7. Do not edit `doc/epics/EPIC-126.md` or `doc/active-work.md`.

### Before → after examples

```js
// Before: assets/boards/rest-client/src/request-builder.js
send.textContent = model.executing ? "Sending..." : "Send";

// After
send.textContent = model.executing ? t("toolbar.sending") : t("toolbar.send");
```

```jsx
// Before: assets/boards/excalidraw/index.html
React.createElement(Excalidraw, { initialData: scene, ... })

// After: resolveSupportedLangCode(persephone.locale.code, languages, bundledLocaleCodes)
React.createElement(Excalidraw, { langCode, initialData: scene, ... })
```

### Live check plan

- Start Persephone and open a `.rest.json` collection: the manifest declares `fileMasks: ["*.rest.json"]` and content detection also accepts `{ "type": "rest-client", "requests": [...] }`. `assets/boards/rest-client/guides/index.md` confirms both routes. No existing dedicated fixture is in the board folder; create `C:/projects/test-boards/us-1672-rest-client/demo.rest.json` with two named requests, one empty collection/request, headers/body, and a response-producing request (for example a local or known reachable endpoint) if needed. The initial file can be minimal; avoid credentials.
- Set app language to `en-XA`, reopen the board, and inspect both the main request editor/response pane and Requests sidebar view, including empty state, context menus, confirmations, binary actions where available, and notifications/errors. Pack-owned text should be pseudo-text. HTTP methods/status codes/reason phrases/header names/URLs and collection/request/response content remain English/data. REST Client manifest metadata and host chrome remain English because F7 forbids translated manifest keys in this task.
- Open Excalidraw in each supported locale as practical; verify `de` and regional `de-AT` map to `de-DE`, and a code with no bundled match falls back to English. Perform this offline to prove the locale does not depend on network access.

## Concerns

- The Excalidraw package’s source registry advertises more languages than the board will ship. The build keeps exactly the 15 roadmap locales that Excalidraw supplies, plus English; roadmap languages without vendor locales resolve to English.
- `en-XA` pseudo-text applies to the REST Client pack, while `manifest.*` translations are unavailable by F7. The manifest name, description, capability title and view title therefore remain English and are an intentional exception to “only pseudo-text and data.”
- The REST Client source is not linted. Keep extraction mechanical and preserve each existing view’s behavior, especially separate board frames and async error paths.

## Acceptance Criteria

- REST Client declares its English default pack and minimum bridge at least `1.36.0`; all 94 inventoried user-visible English message definitions use `persephone.i18n.t()` through the frame-safe helper.
- REST Client’s visible application copy is pseudo-text under `en-XA` in both main and Requests frames, apart from HTTP/data/user content, agent-facing text, and English manifest/host metadata required by F5/F7.
- Plural and concatenated UI messages use single messages with named placeholders; values such as server status/reason phrase, methods, header names, URLs and user text are not translated.
- Excalidraw manifest requires bridge `1.36.0` or higher and declares no board-owned `languages`. It passes a locally supported mapped `langCode`: exact locale wins, then base language, then English. All 15 roadmap locales that Excalidraw ships are locally bundled and load; unsupported locales, including Estonian and Belarusian, fall back without network access.
- The new `lang/` and locale chunk ship in the packaged app through `assets` resources; no startup copy/install path needs changes.
- REST Client guides, agent descriptions/diagnostics, console/log strings, `doc/epics/EPIC-126.md`, and `doc/active-work.md` remain untouched.

## Files Changed

| File | Planned change |
|---|---|
| `assets/boards/rest-client/board-manifest.json` | Declare English pack and bridge minimum. |
| `assets/boards/rest-client/lang/en.json` | Add the 94 English UI messages; no `manifest.*` keys. |
| `assets/boards/rest-client/src/i18n.js` | Add frame-safe `t()` helper. |
| `assets/boards/rest-client/src/main.js` | Translate user-visible send/read messages. |
| `assets/boards/rest-client/src/request-builder.js` | Translate request editor UI and errors. |
| `assets/boards/rest-client/src/request-copy.js` | Translate copy menu and copy failure. |
| `assets/boards/rest-client/src/request-execution.js` | Translate surfaced upload errors. |
| `assets/boards/rest-client/src/rest-client-model.js` | Translate errors rendered/notified to users; preserve agent diagnostics. |
| `assets/boards/rest-client/src/response-cache.js` | Translate user notifications. |
| `assets/boards/rest-client/src/response-utils.js` | Locale-aware formatting for user-visible size values if required by placeholders. |
| `assets/boards/rest-client/src/views/request-tree.js` | Translate tree, context menu, and confirmation text. |
| `assets/boards/rest-client/src/views/response-viewer.js` | Translate response controls and messages. |
| `assets/boards/rest-client/src/components/confirm.js` | Translate confirmation defaults/actions. |
| `assets/boards/rest-client/src/components/form-data-table.js` | Translate form-data controls. |
| `assets/boards/rest-client/src/components/key-value-table.js` | Translate key/value controls. |
| `assets/boards/rest-client/src/components/splitter.js` | Translate splitter accessible labels. |
| `assets/boards/excalidraw/index.html` | Resolve app locale against available bundled locales and pass `langCode`. |
| `assets/boards/excalidraw/lib/locales/` | Keep English and the 15 roadmap locale chunks in the committed vendor library. |
| `scripts/build-board-lib.mjs` | Keep English and the 15 roadmap locale chunks in the committed vendor library. |
| No change: `assets/boards/rest-client/src/ai-vision-model.js` | Agent-facing schema/help and diagnostics remain English (D3). |
| No change: `assets/boards/rest-client/src/codemirror-entry.js`, `src/rest-client-serializer.js`, `src/request-parser.js` | No board UI copy to extract; format/parser identifiers and diagnostics remain technical or agent/data-facing. |
| `assets/boards/rest-client/src/rest-client-types.js` | Use the localized default request name. |
| No change: `assets/boards/rest-client/src/components/icons.js`, `src/components/select.js`, `src/components/segmented.js` | These components render caller-supplied labels and contain no independent user-visible copy. |
| No change: `assets/boards/rest-client/src/views/request-editor.js` | Delegates rendering; no independent UI strings. |
| No change: `assets/boards/rest-client/guides/index.md` | Agent-facing guide text remains English (D3). |
| No change: `assets/boards/rest-client/index.html` | Existing document title is metadata; no rendered UI copy to extract. |
| No change: `assets/boards/rest-client/src/http-constants.js` | HTTP methods/header names are data. |
| No change: `assets/boards/rest-client/lib/codemirror.js`, `assets/boards/rest-client/styles/board.css`, `assets/boards/rest-client/styles/dialog.css`, `assets/boards/rest-client/board-base.css` | Vendor/editor bundle and styling contain no board-owned message catalog strings. |
| `assets/boards/excalidraw/board-manifest.json` | Require bridge `1.36.0` or higher; do not declare board-owned languages. |
| No change: `assets/boards/excalidraw/library-fetch.cjs`, `assets/boards/excalidraw/lib/index.css` | No board-owned text or locale-selection logic. |
| No change: `electron-builder.yml`, `src/renderer/editors/board/bundled-board-registry.ts` | Existing assets packaging/direct resource discovery includes new files. |
| No change: `doc/epics/EPIC-126.md`, `doc/active-work.md` | Explicitly outside this task-document change. |
