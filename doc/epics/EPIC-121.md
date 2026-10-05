# EPIC-121: REST client as a bundled board

## Status

**Status:** Completed (2026-10-05)
**Created:** 2026-10-05
**Completed:** —

## Overview

Move the built-in REST client (`src/renderer/editors/rest-client/`, ~3.8k lines) out of the core and
into a bundled board at `assets/boards/rest-client/`, shipped in the installer the way the Excalidraw
board is ([EPIC-109](EPIC-109.md)) and then removed from the core the way `draw-view` was
([EPIC-110](EPIC-110.md)). This is follow-up work named in the
[platform roadmap](../platform-roadmap.md) §1 ("move the heavy built-ins out — Excalidraw, REST
client, video/audio") and "After the roadmap" ("Video and REST client extraction as ordinary
epics"). It is also the test case the roadmap reserved for the network permission model (§6:
"the REST client will be the test").

Unlike Excalidraw, no new platform axis is needed. Everything the board uses has already shipped:
bundled-board discovery (`editors/board/bundled-board-registry.ts`), `persephone.fetch` gated by the
manifest's `network` permission (`editors/board/board-fetch.ts`), `fileMasks` plus `contentMasks`,
board secondary views (`editors/board/board-secondary.ts`, EPIC-044), capabilities, and the exposed
`aiVision` model.

## Goals

- A bundled **REST Client** board that opens every existing `.rest.json` file, and any JSON page
  with `"type": "rest-client"` and `"requests"`, with no change to the file format.
- Feature parity with today's editor: request tree and collections, all five body types (none,
  form-urlencoded, raw with a language, binary from disk, multipart form-data), headers and form
  tables, response viewer (text, JSON, image and binary preview, save), **Copy as** cURL / fetch /
  Node fetch, and paste of a cURL or fetch snippet.
- "Open in REST client" from the Explorer tree context menu, cURL links and the browser network log
  keeps working, routed through a capability instead of a hardcoded editor id.
- The agent API keeps working through the board's exposed `aiVision` model.
- `src/renderer/editors/rest-client/`, its facade, its types and its registry rows are deleted.

## Non-goals

- A new request format. `.http` files (backlog "REST Client" idea) stay a separate idea.
- New REST features: environments, variables, auth helpers, history. Parity first; the board makes
  them cheap to add later, outside the core.
- Changing `app.fetch` / `api/node-fetch.ts`. Scripts keep `app.fetch` as the no-UI route.
- Any change to the board platform beyond per-page state (D8) and what a gap found during
  investigation strictly needs.
  Such a gap is a finding to raise, not something to build silently (see D10).

## Decisions

**D1 — One epic, two halves, removal last.** EPIC-109/110 split Excalidraw into two epics because a
new platform mechanism (bundled boards) shipped alongside it. Nothing new ships here, so one epic is
enough. The built-in editor stays registered as a fallback until the board passes parity, and the
removal is the final task behind an abort boundary (D9).

**D2 — Bundled, read in place, never trust-prompted.** The board lives in `assets/boards/rest-client/`
and is registered like `assets/boards/excalidraw/` (EPIC-109 D1/D2). A catalog board with the same id
lands in a user folder and is prompted for normally.

**D3 — Network through `persephone.fetch` with `"network": "full"`.** A REST client's main use is
`localhost` and private-network APIs, so `"internet"` would break the common case. The board's
permission list in the trust UI shows it, though a bundled board is never prompted. `persephone.fetch`
already runs through `api/node-fetch` (the same path the editor uses today, `RestClientEditor.ts:674`)
and streams the response back. The investigation must confirm parity on: redirects, TLS
(`rejectUnauthorized`), proxy and Tor settings, the MCP-endpoint block when `appScripting` is off,
request-body streaming, and binary responses. The roadmap's "RPC first, CSP relaxation if a migration
proves it necessary" is decided here: RPC is enough, unless the investigation shows otherwise.

**D4 — UI technology: plain JS plus CodeMirror 6 in a prebuilt `lib/`.** *(Confirmed by the user,
2026-10-05.)* Boards cannot import `uikit/` or `MonacoEditorHostView`. The body editor and the
response viewer need highlighting and folding. Recommended: **CodeMirror 6**, bundled once into a
committed `lib/` by a script modelled on `scripts/build-board-lib.mjs` (EPIC-110 D4, so it goes in
`devDependencies` only). It is far lighter than a second Monaco in an iframe. The rest is plain DOM
styled on the `--p-*` theme contract; tables can use `av-grid` from `boards-assets/` if it fits. For
a very large response, an "Open in editor" action hands the body to a real Persephone page through
`openContent`.

**D5 — File format and editor claim unchanged.** `fileMasks: ["*.rest.json"]`, plus a
`contentMasks` regex equal to today's `detectsContent` (`editors/base/editor-matchers.ts:113-123`),
with `editorKind: "content-host"` so Persephone keeps owning the file, dirty state and saving. While
the built-in is still registered, the board must win the default: the built-in accepts at 20, and
`custom-editor-registry.ts` uses a strict `>` so built-ins win exact ties. Settle the priority
against the code during investigation, as EPIC-109 D7 did.

**D6 — "Open in REST client" becomes a capability.** The three entry points that send
`target: "rest-client"` (`content/tree-context-menus.ts:25-40`, `content/builtin-schemes.ts:282`,
`editors/browser/network-log-links.ts:127`) route through a capability the board declares (id to
settle, e.g. `http.request.open`), carrying `{ url, method, headers, body }`. This mirrors EPIC-110
D6. `open-in-rest-client.ts`'s request-building logic moves into the board. If no board handles the
capability, the user gets a clear notice; the code does not fall back to a deleted editor id.

**D7 — Agent API compatibility.** The board's `aiVision` model re-provides the members of
`RestClientEditorFacade` (`scripting/api-wrapper/RestClientEditorFacade.ts`), as Excalidraw did for
`DrawEditorFacade`. `pages[i].editor.id === "rest-client"` stops being true, and `IRestClientEditor`
leaves `api/types/page.d.ts` and `common.d.ts`. That is a documented breaking change for scripts,
with the same treatment as EPIC-110 D5.

**D8 — Per-page board state is a new platform feature, and the response cache uses it.**
*(User decision, 2026-10-05.)* Boards that act as editors or viewers need what built-in editors
have: state saved per page, restored after a restart, and deleted when the page closes. Today the
REST client keeps its text-response cache in `EditorStateStorage` (`RestClientEditor.saveResponseCache`),
and boards have no equivalent. US-1621 adds one.

- **Storage is outside the page descriptor.** A board's state can be megabytes, and its shape is
  unknowable, so it must not go into the persisted page state. It reuses the cache folder that
  built-in editors already use: `TextFileModel.stateStorage` writes `<editorId>_<name>.txt` through
  `fs.saveCacheFile` (`api/fs.ts:545-557`, `editors/text/TextEditorModel.ts:161-163`).
- **Cleanup comes from the existing lifecycle.** `PageModel` calls `fs.deleteCacheFiles(editor.id)`,
  which removes every `<editorId>*` cache file, when a page closes (`api/pages/PageModel.ts:900`) or
  its editor is replaced without transferring the id (`:571`). Files written under the board page's
  editor id are therefore deleted on close with no new bookkeeping. The investigation must confirm
  this for both content-host and standalone boards, and what happens to the state on an editor
  switch, where `BoardContentEditorModel` preserves the cache id.
- **Bridge surface** (names to settle in the task document): a per-page get / set / remove keyed by
  a short board-chosen name. Values are strings or JSON, with a documented size cap. No permission
  is needed, because it is the board's own data about its own page. It needs a `BOARD_BRIDGE_VERSION`
  bump and an entry in the board authoring guide (`assets/board-template/CLAUDE.md` and the boards
  guide corpus).
- The REST client board stores its text-response cache through it (US-1623), text only and capped
  as today. Binary responses still are not persisted.

**D9 — Abort boundary before deletion.** Removal starts only when all of the following hold: a real
`.rest.json` collection restores into the board, sends every body type, and round-trips saving; a
persisted page whose descriptor names `rest-client` restores without an error (no migration — see
the 2026-10-05 note); and the three entry points in D6 open the board. If any of
these fails, stop and report. Do not delete around a failure.

**D10 — Expected gaps to verify, not assume.**
- **Binary body from disk** streams today (`fs.createReadStream`). Through the bridge it becomes an
  `ArrayBuffer` body in memory, and a file picker needs `fileSystem` access. Measure a large file and
  decide whether a size cap is enough.
- **Pasting a cURL snippet**: a `paste` event inside the iframe needs no `clipboardRead`. Verify that
  before granting the permission.
- **Sidebar request tree** (`panels/RestPanelSecondaryView.ts`, registered at
  `register-editors.ts:89`) becomes a board secondary view, so the layout stays where users expect
  it.
- **New-page entry** in `ui/sidebar/tools-editors-registry.ts:140` and the `RestClientIcon` glyph
  carry over to the board's standalone entry and icon (EPIC-110 D2 and D10).

## Linked Tasks

Task documents are written per task by the usual investigation step; IDs below are reserved.

| Task | Title | Status |
|------|-------|--------|
| US-1621 | Platform: per-page board state in the cache folder, cleaned up on page close (D8) | Completed |
| US-1622 | Board skeleton: bundled registration, masks, content-host load/save, CodeMirror `lib/` | Completed |
| US-1623 | Request execution through `persephone.fetch`: all body types, response viewer, cache (D3, D8) | Completed |
| US-1624 | Request tree and collections, secondary view, Copy as, paste parsing, new-page entry | Completed |
| US-1625 | "Open in REST client" capability routing for the three entry points (D6) | Completed |
| US-1626 | `aiVision` model parity, guide moved to the board, QA surface (D7) | Completed |
| US-1627 | Removal: delete `editors/rest-client` and its seams without migration (D9) | Completed |

## Exit criteria

- On a fresh install with no network, every existing `.rest.json` opens in the board, and a JSON
  page with the REST content shape is offered the board.
- Requests to `localhost`, a private address and a public HTTPS API all succeed, with every body type.
- The three "Open in REST client" entry points open the board with the request filled in.
- Agent scripts that used `RestClientEditorFacade` members work against the board's model, and the
  breaking `editor.id` change is in the release notes.
- `src/renderer/editors/rest-client/` and `RestClientEditorFacade.ts` are gone, and so are the
  `rest-client` rows in `register-editors.ts`, `editor-matchers.ts`, `PageWrapper.ts`,
  `page.d.ts` and `common.d.ts`. Typecheck, lint and the production build pass.

## Notes

### 2026-10-05
- Epic created from the platform roadmap's follow-up list. D4 (UI technology) is a recommendation
  awaiting the user's confirmation; everything else follows the EPIC-109/110 precedents.
- Same day: user confirmed CodeMirror 6 (D4) and asked for per-page board state as a platform
  feature, stored outside the page descriptor in the cache folder and cleaned up on page close.
  Added as US-1621 (D8); the board tasks were renumbered US-1622 to US-1627.
- Later the same day: the user reviewed the board and approved removal (US-1627), and decided
  against backward compatibility for restored pages: with almost no users, a persisted `rest-client`
  page or pinned `rest-client` new-page entry is not migrated to the board. Keeping the code simple
  outweighs it; the only requirement is that an old session restores without an error.
