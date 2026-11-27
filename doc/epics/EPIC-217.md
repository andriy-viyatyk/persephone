# EPIC-217: Board tree providers (remote trees phase 1)

## Status

**Status:** Planned
**Created:** 2026-11-27

## Overview

Phase 1 of the [remote trees roadmap](../reviews/remote-trees-roadmap.md). A board can already supply the content of a
single file (`contentProviders` + `persephone.providers.register`, used by the Torrent Viewer). This epic lets a board
also supply a **tree** that Persephone shows in the Explorer panel, so later boards (SSH, FTP, Kudu — phases 3–5, in
`persephone-boards`) can browse and edit remote folders. Copying between trees is roadmap phase 2.

| Area | Today | File |
|---|---|---|
| Tree interface | General already: `list`, `stat`, `resolveLink`, `getNavigationUrl`, `getCategorySegments`, optional `mkdir`, `rename`, `deleteItem(s)`, `moveToCategory`, `search`, … | `src/renderer/api/types/io.tree.d.ts` |
| Tree construction | Each host calls a constructor directly: Explorer → `new FileTreeProvider(rootPath)` (`ensureTreeProvider`); archive → `new ArchiveTreeProvider`; Mneme root → `new MnemeTreeProvider`; also `MenuBarView`, `ScriptLibraryPanelView`, `PageCollectionWrapper` | `src/renderer/editors/explorer/ExplorerEditorModel.ts:94`, `editors/archive/ArchiveEditor.ts`, `editors/mneme-root/MnemeRootEditorModel.ts`, `ui/sidebar/MenuBarView.ts`, `ui/sidebar/ScriptLibraryPanelView.ts`, `scripting/api-wrapper/PageCollectionWrapper.ts` |
| Category links | `tree-category://` carries `{ type, url, category }`; no shared code maps `type` back to a provider | `src/renderer/content/tree-providers/tree-provider-link.ts`, `editors/category/CategoryEditorModel.ts` |
| Explorer state | Persists a local `rootPath` only | `ExplorerEditorModel.ts` |
| Board file content | `ProxyProvider` over the module-service provider channel; descriptor persisted; **Provider missing** while the board is absent | `src/renderer/content/providers/ProxyProvider.ts`, `src/ipc/module-service-channels.ts`, `src/shared/provider-operation-policy.ts`, `src/renderer/content/registry.ts` |
| Manifest | `contentProviders: [{ type, schemes }]` normalized here | `src/shared/board/board-manifest-schema.ts` |
| Board `openRawLink` | Fixed scheme list with a hard-coded `torrent:` | `src/main/board-host/rpc/app.ts:73` |

## Goals

- **Exit:** a test board opens a tree page, browses folders, opens a file in the normal editor, edits and saves it,
  creates/renames/deletes items, survives an app restart, and shows **Provider missing** while untrusted, recovering
  when trusted again.
- One place maps a tree `type` to a provider; no host constructs tree providers directly.
- Boards declare trees in the manifest and implement them in their module service, over the existing provider channel.
- The Explorer panel can show and persist any tree, not only a local folder.
- Boards can open a tree page (`persephone.openTree`) and open links in their own claimed schemes.

## Linked Tasks

| Task | Title | Owner | Status |
|------|-------|-------|--------|
| [US-2243](../tasks/US-2243-tree-provider-factory/README.md) | **Tree provider factory.** `createTreeProvider({ type, config, rootPath })` in `src/renderer/content/tree-providers/` returns file, archive, Mneme or (after US-2245) board trees. The Explorer, Category editor / `tree-category://` resolution and the other direct-constructor call sites use it. Pure refactor: no behavior change; existing UI tests stay green | Codex (plan + implement), Claude check | Done |
| [US-2244](../tasks/US-2244-board-tree-service-api/README.md) | **Manifest tree flag and service API.** `tree: true` on a `contentProviders` entry, normalized in `board-manifest-schema.ts`, owned through the existing provider ownership registry (`content/registry.ts`), shown in Board Info. Service side: `persephone.treeProviders.register(type, { list(config, path), stat(config, path), mkdir?, rename?, delete? })`; new operations join `ProviderOperation` with deadlines in the same policy table and travel on the existing provider channel (no new correlator or envelope, guardrail 1). Registering a tree for a type not declared with `tree: true` is refused like other undeclared registrations | Codex (plan + implement), Claude check | Done |
| [US-2245](../tasks/US-2245-proxy-tree-provider/README.md) | **`ProxyTreeProvider`.** Core `ITreeProvider` forwarding to the board service. Validates results (bounded names and counts, every href in the board's own claimed scheme). `resolveLink` returns the scheme URL so file opens go through `ProxyProvider`; folders become `tree-category://` links with the board type. Exposes only the write methods the board registered; no `search`. `describeRoot` gives the board's icon. Wired into the US-2243 factory | Codex (plan + implement), Claude check | Planned |
| [US-2246: Explorer shows and persists any tree](../tasks/US-2246-explorer-any-tree/README.md) | **Explorer shows and persists any tree.** Explorer state gains `tree?: { type, config, rootPath }` beside `rootPath`; restore rebuilds via the factory. Absent/untrusted board → **Provider missing** in the panel with recovery when the board returns (same contract as file providers). Explorer search UI and local-only actions (reveal in OS, terminal, …) hidden for trees that cannot do them. Connection errors from the service show in the panel's existing error/empty state | Codex (plan + implement), Claude check | Planned |
| [US-2247](../tasks/US-2247-bridge-open-tree/README.md) | **Bridge: `openTree` and claimed-scheme links.** `persephone.openTree({ type, config, rootPath, title? })` opens a page with the Explorer panel on that tree; only the calling board's own types. Reuses a page already showing the same `{ type, config, rootPath }` (decision 2). Board `openRawLink` accepts schemes claimed by the calling board, replacing the hard-coded `torrent:` (the Torrent Viewer keeps working because it claims `torrent`). `BOARD_BRIDGE_VERSION` minor bump with a history line (guardrail 6) | Codex (plan + implement), Claude check | Planned |
| [US-2248: Test board and UI tests](../tasks/US-2248-tree-test-board/README.md) | **Test board and UI tests.** A board in `C:\projects\test-boards` serving an in-memory tree (read + write, a few nested folders, text and JSON files) with a page that has an **Open** button calling `openTree`. UI tests under `integration-test/tests/` cover the exit criteria above | Codex (write + run tests), Claude runs the new tests at epic close | Planned |
| US-2249 | **Guides.** `assets/guides/boards/content-providers.md` (tree flag, service API, `openTree`, claimed-scheme `openRawLink`), the agent board guides (`assets/guides/agents/boards/`), `bridge-versions.md`, and a `whats-new.md` line. `npm run guides:check` passes | Codex (via `/userdoc` at close) | Planned |

**Order:** US-2243 → US-2244 → US-2245 → US-2246 → US-2247. US-2248 starts once US-2245 lands (the test board's service
can be written earlier) and grows with each task. US-2249 at epic close.

## Epic-level decisions

From the roadmap's "Decisions"; recorded here are the ones this epic implements, plus the roadmap's open questions,
settled by Claude's recommendation (the user may override before the plans are written).

1. **One provider type serves files and folders.** A tree is a flag on a `contentProviders` entry, not a separate
   declaration; the same type and scheme cover file content and tree listing.
2. **`openTree` reuses a matching page.** If a page's Explorer already shows the same `{ type, config, rootPath }`,
   that page is focused; otherwise a new page opens. Same spirit as `reuseKey`, no new option needed.
3. **No new "remote" marker in the Explorer header.** The root row carries the board's icon (`describeRoot`); status
   and errors use the panel's existing provider-missing and error states.
4. **Drag-and-drop between a local and a board tree is roadmap phase 2**, not this epic (the user needs it; it gets
   its own transfer engine). Here, moves inside one board tree go through `rename`, and a drop from another tree is
   refused cleanly rather than half-handled.
5. **The persisted descriptor is opaque config owned by the board.** Core stores and returns `config` untouched and
   never interprets it; boards put a connection key there, never credentials (roadmap decision 2).
6. **No new protocol.** Tree operations are provider operations on the existing module-service channel.
7. **Board rules live in `src/shared/board/`** and the provider registry; no board-specific branch elsewhere.

## Out of scope

- Cross-tree copy and move (roadmap phase 2).
- The SSH, FTP and Kudu boards themselves (roadmap phases 3–5, `persephone-boards`).
- Search in board trees, live log tail.
- Board trees in the Category editor beyond what the factory gives for free.

## Concerns

- **Explorer coupling to local disk.** Explorer code (search, file watchers, reveal-in-OS, drag-out to the OS, script
  library) may assume a filesystem path in more places than the table lists. US-2246's plan must inventory them and
  gate each on the provider type or capability, not on `type === "file"` scattered at call sites.
- **Latency.** Remote `list` can take seconds. The tree must show a loading state per folder and stay responsive;
  provider deadlines for `list`/`stat` should follow the content-read rule (cancellation, not a short timer).
- **Large folders.** `/var/log`-sized listings: US-2245 sets a bounded item count per `list` and warns with a
  notification ("listing truncated") rather than an unbounded transfer.
- **Cold start.** A restored tree page starts the board service on first `list`, like a restored file page; check that
  restoring several such pages does not race the service start.
