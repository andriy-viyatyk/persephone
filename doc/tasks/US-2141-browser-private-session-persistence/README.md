# US-2141: Browser — incognito/Tor data written to disk and restored

**Status:** Completed (2026-11-21) — planned, implemented, verified and completed in one authorized run.
**Severity:** Medium (privacy; Tor/incognito users most affected).
**Evidence branch:** `upcoming-v5.0.21` @ `4656a6cb`.

## Goal

Keep private browsing (incognito and Tor) off disk: no URLs, titles, per-tab history, search
queries or download records from a private session are persisted, and private pages are not
restored after a restart (Chrome parity).

## What is confirmed (code review)

1. **Window-state file keeps private tabs.** `BrowserEditor.getRestoreData()`
   (`src/renderer/editors/browser/BrowserEditor.ts:256-282`) serializes every tab (`url`,
   `pageTitle`, `favicon`, `navHistory` up to 100 URLs), including `isIncognito`/`isTor`, with no
   private-session guard. `PagesPersistenceModel.saveState`
   (`src/renderer/api/pages/PagesPersistenceModel.ts:40-56`) writes it (debounced 500 ms).
   `applyRestoreData` (`BrowserEditor.ts:284-340`) restores **incognito** tabs with their URLs; only
   Tor tabs are blanked on restore — after already being written to disk.
2. **Tor search queries go to the persistent profile history.** `resolveAddressInput`
   (`BrowserEditor.ts:454`) calls `searchHistoryManager.get(profileName, isIncognito)?.add(url)`;
   `browser-search-history.ts:125-126` returns no storage only when `isIncognito` is true, and a Tor
   tab has `isTor=true`, `isIncognito=false`. `addNavHistory` correctly uses
   `isPrivateBrowserSession`. Suggestions read the same store (`BrowserUrlBarModel.ts:70-73`), so
   Tor queries reappear in normal browsing and vice versa.
3. **Private downloads persisted and broadcast.** `src/main/download-service.ts:230-236` records
   `url` + `filename` for every session; `persist()` (`:359-362`) saves with no session check;
   `openWindows.send("eDownloadStarted", …)` goes to all windows, and every browser page's downloads
   popup lists every entry. Only Mark-of-the-Web data is suppressed for Tor.

## Runtime reproduction (5.0.20, 2026-11-21)

Owned test instance (`persephone-test.exe … --profile sec-2141`), fixtures on 127.0.0.1, marker
strings `zzqq-*`. Tor tabs ran through the local `tnet.exe` (Tor drop-in) and did load the fixture.
Paths below are relative to the profile's `data` folder.

| Claim | Result | Evidence |
|---|---|---|
| #1 window state | **Reproduces** | `openFiles0.json` held the incognito page's `url`, `pageTitle`, `homeUrl` and `navHistory` (`[incog-2, incog-1]`) with `isIncognito:true`. The Tor page's `url`, `pageTitle` and `homeUrl` were written too (`isTor:true`); only its `navHistory` was empty. No other file held the markers. |
| #1 restore | **Reproduces (incognito)** | After `ctx.restartApp`, the incognito page came back with its URL, title and both history entries. The Tor page came back as one blank `about:blank` tab, and the Tor URL left the file only when it was rewritten **after** the restart — so a crash or kill while a Tor page is open leaves its URL/title on disk. |
| #2 search history | **Reproduces, both directions** | A Tor query landed in `browserSearchHistory-default.txt`, and a normal tab's real URL bar suggested it on typing `zzqq`. A normal-tab query also landed in the same file, and the Tor tab's `urlBar.searchStorage.getAll()` returned it — Tor suggestions expose normal-profile history. |
| #3 downloads | **Reproduces (incognito)** | `recentDownloads.json` recorded the incognito download's filename, source `url` and `savePath`; a normal page's downloads popup listed it with **Show in Folder**. Tor download not run (Tor tab loads the fixture, so it is testable the same way). |

Method notes: the Tor query for #2 was submitted by calling `resolveAddressInput(...)` on the Tor
page's editor model (the function the URL bar's submit calls), because automation of the window is
blocked while a Tor page is visible; this also kept the query off google.com. Pages were opened
through the automation API ("Browser (agent)"); a hand-opened tab goes through the same
`getRestoreData`/`saveState` path but was not separately run.

Reproduction scripts (reference): scratchpad `browser-research/repro/us2141/` (`c1`/`c2`/`c3.test.mjs`).

## Background

- **Private-session rule.** `isPrivateBrowserSession(state)` in
  `src/renderer/editors/browser/agent-access.ts` (dependency-free; already used by bookmarks,
  site extensions, tabs, `addNavHistory`, search-engine memory) is the single "is this page
  incognito or Tor" rule. Every renderer fix below reuses it.
- **Window state.** `PagesPersistenceModel.saveState()` serializes `page.getDescriptor()` for every
  page to `openFiles<N>.json`; `restoreState()`/`applyState()` reads it back at startup.
  `PageModel.getDescriptor()` / `EditorModel.getRestoreData()` are **also** used in memory for
  dragging a page to another window (`PageTabView.getDragData`) and for "Duplicate tab"
  (`PagesLifecycleModel.duplicatePage`); those must keep working, so the filter belongs at the
  disk boundary, not in `getRestoreData()`.
- **Editor registry.** `EditorDefinition` (`src/renderer/editors/base/editorRegistry.ts`) is the
  per-editor extension point (matchers, capabilities, guide path), filled from the table in
  `src/renderer/editors/register-editors.ts`. Definitions are registered synchronously at startup,
  so a per-descriptor predicate there is usable by persistence without loading the browser chunk.
- **Search history.** `SearchHistoryManager.get(profileName, isIncognito)` in
  `src/renderer/editors/browser/browser-search-history.ts` has three callers: `resolveAddressInput`
  and `addNavHistory` (`BrowserEditor.ts`) and `BrowserUrlBarModel.searchStorage`.
- **Downloads.** `src/main/download-service.ts` owns all download records; events go to every
  window through `openWindows.send`; `recentStore` (`recentDownloads.json`) keeps the last 5
  completed entries. The renderer's global `downloads` model (`src/renderer/api/downloads.ts`)
  mirrors them; `BrowserDownloadsPopup.ts` and `DownloadButton.ts` (in every browser toolbar)
  render the whole list. `downloadService.getDownloads()` is also exposed to agents through the
  main AiVision services (`src/main/mcp/ai-vision/main-services.ts`) and the renderer `downloads`
  namespace. A guest's `BrowserGuest.tabId` is its BrowserEditor's id.

## Decisions

1. **Private pages do not survive a restart (Chrome parity).** Incognito and Tor pages are never
   written to the window-state file and are dropped if found in one written by an older build.
   This replaces the old Tor behavior (restore as a blank Tor page with a Reconnect overlay): that
   blank shell had no data the user could lose, and keeping it would require writing the page
   to disk. The blank-tab/overlay branch in `BrowserEditor.applyRestoreData` stays, because a Tor
   page dragged to another window or duplicated still goes through it (a new window gets a new
   Tor session).
2. **The rule is owned by the editor definition, enforced at the disk boundary.** New optional
   `EditorDefinition.sessionOnly(descriptor)`; the browser row answers with
   `isPrivateBrowserSession(descriptor.state)`. `PagesPersistenceModel` drops any page with a
   session-only editor both when saving and when restoring (one predicate for both directions),
   and drops groupings/active-page references to dropped pages. Drag-to-window and duplicate are
   untouched (in-memory only).
3. **Private sessions get no search storage at all** (both directions), decided inside
   `SearchHistoryManager` by `isPrivateBrowserSession`; callers pass the page state instead of a
   boolean, so a caller can no longer pass the wrong flag.
4. **Private downloads belong to their page** (Chrome: incognito downloads show only in the
   incognito window and are never in the profile's history). Main tags a download from a
   non-persistent browser guest session with `privateOwnerId` (the BrowserEditor id); such
   entries are never written to `recentDownloads.json`, their events go only to the hosting
   window, `getDownloads()` without a viewer (agents, persistence) excludes them, and the Save
   dialog's last-folder memory is not updated by them. In the renderer, a normal page's popup
   shows only non-private entries; a private page's popup shows only its own downloads. "Clear"
   clears only the entries of the popup's own scope. The public `app.downloads` list excludes
   private entries.
5. **Not changed:** per-tab `navHistory` of a private page stays in memory (URL-bar suggestions
   for that tab). The private session's in-memory download entries are dropped at app exit (no
   extra "page closed" protocol).

## Implementation plan

### A. Window state (finding 1)

- [x] `src/renderer/editors/base/editorRegistry.ts`: add to `EditorDefinition`
  `readonly sessionOnly?: (descriptor: EditorDescriptor) => boolean;` and
  `EditorRegistry.isSessionOnly(descriptor)` (resolves the definition with `resolveDefinition`).
- [x] `src/renderer/editors/register-editors.ts`: `EditorRow.sessionOnly`; browser row:
  `sessionOnly: (descriptor) => isPrivateBrowserSession(descriptor.state as IBrowserAccessFlags)`
  (imports the dependency-free `./browser/agent-access`); pass it through in the registration loop.
- [x] `src/renderer/api/pages/PagesPersistenceModel.ts`:
  - module helper `isPersistedPage(descriptor)` → `!descriptor.editors.some(editorRegistry.isSessionOnly)`;
  - `saveState`: filter descriptors; keep only groupings whose both ids were written; write
    `activePageId` only when that page was written;
  - `restoreState`/`applyState`: filter `data.pages` with the same helper before restoring.
- [x] `src/renderer/editors/browser/BrowserEditor.ts` `applyRestoreData`: reword the Tor-branch
  comment (now reached only by window transfer / duplicate).

### B. Search history (finding 2)

- [x] `src/renderer/editors/browser/browser-search-history.ts`: replace `get(profileName, isIncognito)`
  with `forSession(session: IBrowserAccessFlags & { profileName?: string })`, returning `undefined`
  when `isPrivateBrowserSession(session)`.
- [x] `BrowserEditor.resolveAddressInput` and `addNavHistory`: `searchHistoryManager.forSession(state)`.
- [x] `BrowserUrlBarModel.searchStorage`: `searchHistoryManager.forSession(this.model.state.get())`.

### C. Downloads (finding 3)

- [x] `src/ipc/api-param-types.ts` `DownloadEntry`: `privateOwnerId?: string` (doc comment).
- [x] `src/ipc/contracts/downloads.ts`: `clearCompletedDownloads(privateOwnerId?: string)`; remove
  `eDownloadCleared` (clearing now sends `eDownloadRemoved` per entry through the routed notifier).
- [x] `src/main/download-service.ts`:
  - `DownloadRecord.privateHost?: WebContents`;
  - `privateOwner(webContents)`: guest on a non-persistent session → `{ ownerId: guest.tabId, host }`;
  - `notify(record, endpoint, data)`: private → `sendRendererEvent(host, …)` only; else `openWindows.send`;
    used for started/progress/awaitingPath/completed/failed/removed;
  - `getDownloads(viewer?)`: non-private entries plus private entries whose host is `viewer`;
    `persist()` uses the viewer-less list, so private entries are never written;
  - `clearCompleted(privateOwnerId?)`: removes only finished entries of that scope;
  - `chooseDownloadPath`: no `rememberDirFromPick` for a private record.
- [x] `src/ipc/main/download-handlers.ts`: pass `event.sender` to `getDownloads`, scope to `clearCompleted`.
- [x] `src/renderer/api/downloads.ts`: drop `eDownloadCleared`; export
  `downloadsInScope(entries, privateOwnerId?)`; public `downloads`/`hasActiveDownloads`/
  `aggregateProgress` use the non-private scope; `clearCompleted(privateOwnerId?)`.
- [x] `src/renderer/editors/browser/BrowserDownloadsPopup.ts`: `showDownloadsPopup(anchor, privateOwnerId?)`;
  the content view filters by that scope and clears that scope.
- [x] `src/renderer/editors/browser/DownloadButton.ts`: props `{ privateOwnerId?: string }`; ring
  progress over the scoped list; opens the popup with the scope.
- [x] `src/renderer/editors/browser/BrowserToolbarView.ts`: construct the button with
  `privateOwnerId: isPrivateBrowserSession(props.state) ? model.id : undefined`.

### Files that need NO changes

`PageModel.ts` (`getDescriptor` stays complete for drag/duplicate), `PagesLifecycleModel.ts`,
`PageTabView.ts`, `browser-state.ts`, `agent-access.ts`, `open-windows.ts`, the AiVision downloads
namespaces (they read the already-filtered public lists), `BrowserGuestRegistry.ts`.

## Concerns

- Users upgrading with private pages in their window-state file lose those pages on the first
  start (intended; they are dropped, not restored).
- A Tor/incognito page dragged to another window keeps its private downloads in the original
  window's list (rare; entries are in memory only).

## Acceptance criteria

- [x] After visiting pages and downloading in incognito/Tor, the window-state and downloads files on
  disk contain none of those URLs, titles or paths.
- [x] Incognito (and Tor) pages do not reopen after restart.
- [x] A query typed in a Tor URL bar never appears as a suggestion in a normal profile, and vice versa.
- [x] Killing the app while a Tor or incognito page is open leaves none of its URLs/titles in
  `openFiles*.json` (they are never written).
- [x] A private-session download does not appear in `recentDownloads.json` or in a normal page's
  downloads popup.

## Verification

**Runtime (owned dev test instance, `--profile sec-fix-2141`, loopback fixture on 127.0.0.1:18141,
Tor through the local `tnet.exe`; same signals as the reproduction).** Before = the 5.0.20
reproduction above (the code paths were unchanged on this branch); after = with the change. Script:
scratchpad `us2141/verify/v.test.mjs`.

| # | Check | Before | After |
|---|---|---|---|
| 1 | Scan of the whole profile while an incognito page (2 visits) and a Tor page are open — the state a kill would leave | `openFiles0.json` held their URLs/titles/history | No marker in any file; `openFiles0.json` lists only the normal pages, no grouping/active reference to private pages |
| 1 | `ctx.restartApp` | Incognito page restored with URL and history; Tor page restored blank | Only the normal pages come back; no private page; no marker on disk |
| 2 | Tor and incognito queries via `resolveAddressInput` | Written to `browserSearchHistory-default.txt` | File unchanged; normal URL bar suggests no private query |
| 2 | Normal query, then the private pages' `urlBar.searchStorage` | Tor storage returned normal queries | `no-storage` for Tor and incognito; normal page still has its history |
| 3 | Incognito download (`#dl` click) and Tor download (navigate to the attachment URL) | Persisted to `recentDownloads.json`; listed in a normal page's popup | `recentDownloads.json` is `[]`; `app.downloads.downloads` and `main.downloads.getDownloads()` are `[]`; normal page popup "No downloads"; renderer entries tagged with the right page id (incognito / Tor); the incognito page's own popup lists its file |

**Code-only:** dropping private pages from a window-state file written by an older build (same
predicate as the save path); the `rememberDirFromPick` skip (test instances bypass the Save
dialog); Clear scoped to the popup's page; events of a private download reaching only the hosting
window (seen indirectly: the entries are in that window's model and absent from every public list).

**Hand check:** a Tor page's own Downloads popup (window automation is refused while a Tor page is
visible; the incognito popup proved the same code path); a real Save dialog for a private download
not changing the remembered folder.

## Completion notes

- **Review** (against `.agents/skills/review`): no concerns. No new protocol (an existing endpoint
  gained an optional argument and an unused event was removed), no god-file growth, the rule lives in
  the editor definition and `agent-access.ts`, no `!`, no colors, no `window.persephone` change.
- **Docs:** `browser-editor.md` (new "Private sessions stay off disk" section replacing the old Tor
  restore paragraph), `editors.md` (`sessionOnly`), `pages-architecture.md`, `key-files.md`.
- **User docs:** browser guide hub (private pages, Downloads), `scripting/api/downloads.md`,
  `downloads.d.ts` (both copies), What's New.
- **i18n:** no catalog messages changed.

## Files changed

| File | Change |
|---|---|
| `src/renderer/editors/base/editorRegistry.ts` | `EditorDefinition.sessionOnly`, `isSessionOnly()` |
| `src/renderer/editors/register-editors.ts` | browser row declares `sessionOnly` |
| `src/renderer/api/pages/PagesPersistenceModel.ts` | drop session-only pages on save and restore |
| `src/renderer/editors/browser/BrowserEditor.ts` | `forSession` callers; restore comment |
| `src/renderer/editors/browser/browser-search-history.ts` | `forSession()` with the private-session rule |
| `src/renderer/editors/browser/BrowserUrlBarModel.ts` | `forSession` |
| `src/ipc/api-param-types.ts` | `DownloadEntry.privateOwnerId` |
| `src/ipc/contracts/downloads.ts` | scoped `clearCompletedDownloads`; `eDownloadCleared` removed |
| `src/ipc/main/download-handlers.ts` | viewer / scope arguments |
| `src/main/download-service.ts` | private tagging, routed events, no persistence |
| `src/renderer/api/downloads.ts` | scoped lists |
| `src/renderer/editors/browser/BrowserDownloadsPopup.ts` | scoped popup |
| `src/renderer/editors/browser/DownloadButton.ts` | scoped button |
| `src/renderer/editors/browser/BrowserToolbarView.ts` | passes the page's scope |
| `src/renderer/api/types/downloads.d.ts`, `assets/editor-types/downloads.d.ts` | doc comment on `downloads` |
| `doc/architecture/browser-editor.md`, `editors.md`, `pages-architecture.md`, `key-files.md` | developer docs |
| `assets/guides/editors/browser/index.md`, `assets/guides/scripting/api/downloads.md`, `assets/guides/whats-new.md` | user docs |
