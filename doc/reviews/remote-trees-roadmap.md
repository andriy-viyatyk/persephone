# Remote trees roadmap

**Date:** 2026-11-27 · **Status:** accepted 2026-11-27; Phase 1 is [EPIC-217](../epics/EPIC-217.md) (planned). Each
phase becomes one epic, created when the previous one closes.

## Goal

Browse and edit files on remote machines from Persephone's Explorer panel: a Linux VM or server over SSH, an FTP
server, or an Azure App Service's `/home` folder through Kudu's file API. Each kind of remote is a **board**, not core
code. Persephone core only gains the ability for a board to supply a **tree** to the Explorer panel, the same way a
board can already supply single-file content through `contentProviders` (the Torrent Viewer's `torrent/viewer`).

Typical flow: open the SSH board, pick or add a connection, click **Open**. A new page opens with the Explorer panel
rooted at, for example, `/home` on that host. Clicking a file opens it in the normal editor (Monaco, grid, Markdown…);
saving writes it back to the host.

## What exists today

**Files: complete.** A board declares `contentProviders: [{ type, schemes }]` in `board-manifest.json`, and its module
service calls `persephone.providers.register(type, { readBinary, readRange?, writeBinary?, stat?, watch? })`. Core
reaches it through `ProxyProvider` (`src/renderer/content/providers/ProxyProvider.ts`) over the module-service provider
channel (`src/ipc/module-service-channels.ts`; operations in `src/shared/provider-operation-policy.ts`). The page
persists the provider descriptor, restores it after restart, and shows **Provider missing** while the board is absent
or untrusted. Board services are Node with their own npm dependencies, so `ssh2` or an FTP client fits. Secrets go to
the per-board encrypted `.env.json` ([env-vars guide](../../assets/guides/boards/env-vars.md)), never the board folder.

**Trees: no extension point.**

- `ITreeProvider` (`src/renderer/api/types/io.tree.d.ts`) is already general: `list`, `stat`, `resolveLink`,
  `getNavigationUrl`, `getCategorySegments`, plus optional `mkdir`, `rename`, `deleteItem(s)`, `moveToCategory`,
  `search`, … Nothing about it is tied to local disk.
- But every host constructs its provider directly: `ExplorerEditorModel.ensureTreeProvider` →
  `new FileTreeProvider(rootPath)`; `ArchiveEditor` → `new ArchiveTreeProvider(…)`; `MnemeRootEditorModel` →
  `new MnemeTreeProvider(…)`; plus `MenuBarView`, `ScriptLibraryPanelView`, `PageCollectionWrapper`.
- `tree-category://` links (`content/tree-providers/tree-provider-link.ts`) carry `{ type, url, category }`, yet no
  shared code maps a `type` back to a provider.
- The Explorer's persisted state is a local `rootPath` only.
- Board `openRawLink` (`src/main/board-host/rpc/app.ts:73`) accepts a fixed scheme list that hard-codes `torrent:`; a
  board cannot open its own claimed scheme otherwise.

## Decisions (apply to every phase)

1. **One provider type serves files and folders.** A board declares one `contentProviders` entry with a tree flag; the
   same `type` and scheme cover `ssh://conn/path/file.json` (content) and `ssh://conn/path/` (tree). One connection
   pool in the service backs both.
2. **Pages persist a connection key, never connection details.** The descriptor is `{ type, config: { conn, … } }`;
   host, user, port and credentials stay in the board (data + env vars). A saved page or a copied link leaks nothing.
3. **Writes are opt-in per connection.** A connection opens read-only unless the user enabled writing for it; the board
   then registers write operations, and the Explorer shows only the actions the provider actually implements.
4. **Links into a claimed scheme are untrusted input.** Web-page links already pass the per-site prompt; boards also
   open only connections that are configured, never a host named by the link.
5. **Testing never touches the customer's servers.** Everything is developed and verified on `persephone-vm`
   ([linux-development.md](../linux-development.md)) or throwaway containers/mock servers on it.
6. **No PHI-specific machinery.** Remote content is treated like any other file content.

## Phase 1 — Board tree providers (persephone)

The platform half. Owner modules follow the refactoring guardrails: board rules in `src/shared/board/`, no new protocol.

1. **Tree provider factory.** One `createTreeProvider({ type, config, rootPath })` in `src/renderer/content/tree-providers/`
   that returns file, archive, Mneme or board (proxy) trees. Explorer, Category editor and `tree-category://`
   resolution use it; the direct constructors at the call sites above go away (or call the factory). Worth doing on its
   own: the type→provider rule lives in one place.
2. **Manifest declaration.** A `tree: true` flag on a `contentProviders` entry, normalized in
   `board-manifest-schema.ts` and registered with the existing provider ownership registry
   (`content/registry.ts`). Board Info shows it.
3. **Service API.** `persephone.treeProviders.register(type, { list(config, path), stat(config, path), mkdir?, rename?,
   delete? })`. New operations join `ProviderOperation` on the existing module-service provider channel, with
   deadlines in the same policy table. No new correlator or envelope.
4. **`ProxyTreeProvider`.** Core `ITreeProvider` that forwards to the service; validates returned items (bounded
   names, href in the board's own scheme); `resolveLink` returns the scheme URL so file opens use the existing
   `ProxyProvider` path; folders become `tree-category://` links with the board type. Write actions appear only for
   registered methods. `search` stays absent at first; the Explorer hides its search UI for trees without it.
5. **Explorer persists any tree.** Explorer state gains `tree?: { type, config, rootPath }` next to `rootPath`;
   restore rebuilds through the factory; an absent or untrusted board shows **Provider missing** in the panel and
   recovers when the board returns, matching file-provider behavior.
6. **Bridge.** `persephone.openTree({ type, config, rootPath, title? })` opens a new page with the Explorer panel on
   that tree (only the calling board's own types). `openRawLink` accepts schemes claimed by the calling board,
   replacing the hard-coded `torrent:` special case. Bump `BOARD_BRIDGE_VERSION` with a history line.
7. **Test board.** A minimal board in `C:\projects\test-boards` that serves an in-memory tree (read + write) to verify
   1–6 without any network, plus UI tests for open, browse, edit/save, restore and provider-missing.
8. **Guides.** Extend [content-providers.md](../../assets/guides/boards/content-providers.md) (tree flag, service API,
   `openTree`) and the agent board guides.

**Exit:** the test board opens a tree page, browses, edits and saves a file, survives a restart, and degrades to
Provider missing when untrusted.

## Phase 2 — Cross-tree transfer (persephone)

Copy and move files and folders between **any two trees**: local ↔ board tree (upload/download) and board ↔ board
(SSH host to SSH host, SSH to FTP). Platform work, done once; every later board gets it by implementing the provider
operations below.

**Today.** Transfers exist only where both sides are the local disk or the same tree:

- `src/renderer/api/copy-files.ts` `copyPathsInto(sources, targetDir, { move, onProgress })`: recursive local copy and
  move, per-item errors collected, sources removed only after a successful copy. Used by Explorer clipboard paste, OS
  file drops and Explorer drag-and-drop.
- `components/tree-provider/drop-dispatch.ts` `getTraitDropAction` treats a drop as a move only when the dragged
  items come from the **same** provider (`getSourceId === provider.sourceUrl`); items from another tree fall through to
  `importLinks` / `importFiles`, which only local and link providers implement.
- `components/tree-provider/tree-drop-actions.ts` owns the move/copy dialog, the overwrite confirm and the progress
  text; `os-clipboard.ts` owns cut/copy/paste.

**Plan.**

1. **Transfer engine.** A new collaborator `TreeTransfer` (one job: copy or move a set of items from tree A into a folder
   of tree B) in `src/renderer/content/tree-providers/`. It walks sources with `list`/`stat`, creates folders with the
   target's `mkdir`, and copies each file by reading through the source item's content provider (pipe from
   `resolveLink`) and writing through the target's. Move = copy everything, then delete sources that copied fully
   (needs the source's delete). Same-tree drops keep their existing fast paths (`rename`, local `copyPathsInto`);
   local ↔ local keeps `copyPathsInto`. An optional provider `copy` for server-side copy inside one board tree may come
   later.
2. **Large files: chunked writes.** Reading already streams through bounded `readRange` chunks; writing is one
   `writeBinary` buffer (256 MB cap). Add an optional chunked write to content providers: begin → write chunk → commit
   / abort (boards write to a temp name and rename on commit, so an aborted upload leaves no half file). New operations
   on the existing provider channel, like Phase 1's. Providers without it use `writeBinary` up to the cap; larger files
   fail with a clear message.
3. **Drop and paste across trees.** `getTraitDropAction` gains a "transfer" action when the dragged items come from a
   different tree whose provider the engine can read; `tree-drop-actions.ts` and `os-clipboard.ts` route it to
   `TreeTransfer`. OS files dropped on a board tree use the same engine with the local disk as source.
4. **Conflicts, progress, cancel.** Existing-name prompt with overwrite / skip / keep both, "apply to all". Progress in
   files and bytes; cancel aborts the in-flight read and write (the `AbortSignal` already passed to board reads) and
   aborts the chunked write. A summary lists per-item failures; nothing already copied is rolled back.
5. **Edge rules.** Symbolic links: copy a file link's content, skip folder links (no cycles). Timestamps and permissions
   are not preserved. Moving a folder into its own subtree stays refused.
6. **Tests.** Phase 1's in-memory test board ↔ a local temp folder (copy, move, conflict, cancel, a file above the
   chunk size); board ↔ board with two instances of the test tree.

**Out of scope:** dragging remote items out to the OS (Windows Explorer, Files), which would need the file
downloaded before the drag starts; a **Download to…** context-menu action covers that need and can join this phase
if cheap.

**Exit:** drag and paste work in both directions between a local Explorer and the test board's tree, and between two
board trees, with progress, cancel and conflict handling; files larger than one chunk transfer intact.

## Phase 3 — SSH board (persephone-boards)

- Connections page: `~/.ssh/config` aliases or host/user/port; auth via SSH agent (Windows OpenSSH pipe), key file
  (+ passphrase in env vars) or password (env vars); start folder; read-only/writable switch.
- Service on `ssh2`: one session per connection, idle disconnect, reconnect on demand; host-key check with
  first-use confirmation stored by the board.
- SFTP when the server offers it; otherwise a fallback over an exec channel (`ls`-style listing, `cat`, base64 writes)
  for servers without SFTP (App Service containers may be such).
- `watch` by polling `stat` while a file is open.
- Phase 2's chunked writes (SFTP write to a temp name, rename on commit), so uploads of any size work.
- Tests: `persephone-vm` itself (SFTP) and a container on the VM with the SFTP subsystem disabled (fallback).

## Phase 4 — FTP board (persephone-boards)

FTP/FTPS on the same pattern (e.g. `basic-ftp`), tested against `vsftpd` in a container on the VM. Likely a small epic.

## Phase 5 — Kudu board (persephone-boards)

`kudu://<conn>/<path>` over the App Service Kudu VFS API (`GET` folder → JSON listing, `GET` file, `PUT` with `If-Match`).
Token from `az account get-access-token` (needs the board's execute permission) or a device-code login. Covers
`/home` only (`site/wwwroot`, `LogFiles`). Developed against a mock VFS server on the VM; pointing it at a real App
Service is the user's own step.

## Later / optional

- **Live log tail:** stream `tail -f` into a page (a streaming content feature, not a tree feature).
- **Remote search** via an optional `search` on board trees.
- **App Service SSH:** the SSH board starts `az webapp create-remote-connection` and connects through the local port.

## Settled questions

Settled in [EPIC-217](../epics/EPIC-217.md) "Epic-level decisions": `openTree` reuses a page already showing the same
tree; no extra "remote" marker in the Explorer header; local ↔ remote drag-and-drop is Phase 2 (requested by the user
2026-11-27).
