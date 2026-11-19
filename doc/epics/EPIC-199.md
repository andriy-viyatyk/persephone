# EPIC-199: Agent surface fixes from the ai-vision feedback log

## Status

**Status:** Active
**Created:** 2026-11-18

## Overview

EPIC-187 to EPIC-198 drove the whole app through `call` and logged every place an agent got stuck, about 225 entries
in [ai-vision-feedback.md](../reviews/ai-vision-feedback.md). Claude reviewed the log on 2026-11-18. This epic fixes
the problems that recur and that any agent hits over MCP, not only the test suite.

How the review sorted the entries:

- **Already fixed during the roadmap:** about 30 product bugs (highlight overlay CSP, browser `reload`, held
  modifier keys, `getValue` missing from the browser describe table, the `pending` envelope trap, board
  `events.wait` cursor, and more). Runner cleanup now answers stray dialogs and closes stray menus
  (`src/test-host/browser-helpers.ts:157-203`). These are not repeated here.
- **Persephone surface problems that recur:** these are the tasks below.
- **Published-board docs and models (about 35):** they live in `persephone-boards`, which this epic does not change.
  See "Out of scope".
- **One-off judgement slips** (an assumed value without following its transforms, a guess about display text):
  no product change helps those.

## Goals

- An interactive snapshot names every toolbar button and tree row the way a user sees it.
- `$help` tells an agent what a method returns, and lists every member and option the code accepts.
- An agent can do over `call` what a user does with the keyboard or one click: main-process shortcuts, opening a
  folder in its editor, saving a board content page.
- Error codes survive `call` in every namespace.
- The test host keeps values exactly as the app returned them, and `web-app-tests.md` has one section with the
  boundary rules that six epics each rediscovered.

## Non-goals

- **Quoting strings in the agent-facing `call` text.** Agents read raw text better; a JSON-quoted guide body with
  `\n` escapes would be worse for them. Only the test host needs the type, so T5 fixes it there.
- **`undefined` versus `null`, and dropped `undefined` properties.** This is inherent to JSON; it gets documented
  instead (T5).
- **Removing the dialog and menu attention on ordinary calls.** That is the safety contract that keeps an agent from
  acting behind a modal. Its only test cost, one leftover dialog failing a module, is already handled by cleanup.
- **Making `editor.app` wait for a board model.** A board without a model would pay the full wait on every read. The
  readiness pattern gets documented instead (T6).
- **Rare call gaps:** `prompt()` in guest pages, native file pickers in test mode, writing board settings from
  `call`, an F1 fallback page, never-activated board pages. They go to the backlog if they come up again.

## Decisions

- **Return types are written by hand into the describe tables, not generated from the `.d.ts` files (Claude,
  2026-11-18).** The call tree is not the script `app`: `capabilities.invoke` exists only in the script API, and
  `proc` handles cannot cross `call`. Several entries came from exactly that confusion (EPIC-187 / US-2066,
  EPIC-192 / US-2098). Generating `$help` from the script types would reintroduce it. Signatures stay in
  `signature:` strings such as `helpSearch(query: string, limit = 20)` (`scripting/ai-vision/root.ts:62`) and gain
  `→ <return type>`.
- **The test host learns the value type out of band.** `client.ts:103` does `JSON.parse(body)` on every text result,
  because `toCallResult` sends a string result raw (`src/main/mcp/tools/call-tools.ts:440`). The fix adds the type to
  the MCP result (for example `structuredContent` or `_meta`), not to the text.
- **`persephone-boards` stays read-only** until the user says otherwise.

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| [US-2121](../tasks/US-2121-snapshot-names/README.md) | Snapshot names: icon buttons, tree rows, menu ids, missing `data-name`s | Implemented |
| [US-2122](../tasks/US-2122-help-return-types/README.md) | `$help` return types and member drift | Implemented |
| [US-2123](../tasks/US-2123-presskey-main-shortcuts/README.md) | `pressKey` reaches main-process shortcuts | Implemented |
| [US-2124](../tasks/US-2124-call-gaps/README.md) | Call gaps: open a folder in its editor, save any page, error codes everywhere | Implemented; error codes done (`ai-vision` 1.4.0) |
| [US-2125](../tasks/US-2125-test-host-fidelity/README.md) | Test host value fidelity and call options | Implemented |
| [US-2126](../tasks/US-2126-guide-help-sweep/README.md) | Guide and `$help` sweep for the open doc entries | Implemented |

Task documents were written by Codex (Luna) and reviewed by Claude on 2026-11-18. "Implemented" means implemented and verified but not yet reviewed (`/review`, `/document`, `/userdoc` run at epic close). The scope of each task is below.

### US-2121: Snapshot names

The feedback has about 20 reach-gap entries. The ones that hurt every agent:

- `IconButtonView` sets only a tooltip from `title` (`uikit/IconButton/IconButtonView.ts:64`) and no `aria-label`, so
  every toolbar icon button shows up as an unnamed `button` in snapshots (EPIC-189 / US-2078). Set `aria-label` from
  `title` unless the caller gives one.
- Tree rows are named with the chevron's "Expand" and the icon glyph (`treeitem "Expand 📁 project"`), and a root row
  is named by its full path (EPIC-188 / US-2074). Name each row by its item label and keep the chevron out of it
  (`uikit/Tree/TreeItemView.ts`).
- Stable ids and `data-name`s that tests had to work around: the menu-bar "Open Terminal here" item has no id
  (`menu-bar-folder-ui.ts:81`); downloads row buttons; the browser translation popover; MCP Inspector argument
  fields (`mcp-arg-<name>`); the Folder View mode button. Add the missing names to the curated element lists:
  `BROWSER_ELEMENTS` (`url-site-permissions`, `browser-permission-prompt` and its buttons, `site-extension-trust`),
  the header's `audio-capture-indicator`, and `GRID_EDITOR_HELP` versus `GRID_ELEMENTS`.
- Owner: UIKit for the first two; each view for its own names. Check against
  [ui-element-contract.md](../architecture/ui-element-contract.md).

### US-2122: `$help` return types and member drift

This is the largest theme, about 45 entries: a return shape or a member existed only in the source or a `.d.ts` file.

- Add `→ <type>` to method signatures in the describe tables, starting with the members the log names:
  `pages.openFile` / `addEditorPage` / `openUrlInBrowserTab` (it returns an id string) / `closePage` (the
  unsaved-changes prompt), `editorSwitches.options` (`{ id, label, title }[]`), `boards.*` (`createBoard`,
  `openBoard`, `createShortcut` returns `{ linkPath }`), `searchPublished` (`version` is the latest version),
  `settings.highlight`, Folder View `rootPath` / `items` (the `..` row), grid `rows` (ignores filters).
- Fix the signatures that are stale: `window.screen.recording.start` is missing `hideStatusChrome`, and
  `proc.$help` should name the handle members and say the handle is script-only.
- **Drift check:** a browser facade method the guides named was missing from `BROWSER_EDITOR_MEMBERS` (EPIC-190), and
  the `boards` services were missing from the `boards` namespace (EPIC-191). Codex investigates whether a mechanical
  check (each facade's public methods versus its describe table, with an allowlist for deliberate omissions) fits
  `npm run lint` or a `scripts/` check like `guides:check`. Add it only if the mapping is mechanical, and report back
  if it is not.

### US-2123: `pressKey` reaches main-process shortcuts

Five entries. App-window `window.screen.pressKey` and browser `pressKey` go through CDP `Input.dispatchKeyEvent`
(`renderer/automation/input.ts`), which never reaches the main process's `before-input-event`. So zoom (`Ctrl+=`,
`Ctrl+-`, `Ctrl+0`), voice typing (`Alt+V`), `F5`, `F12` and `Ctrl+R` cannot be pressed. A probe in EPIC-196 showed
that `webContents.sendInputEvent` does reach it, and `BrowserGuest.ts:100` already uses it for mouse input.

- Route key presses through `sendInputEvent` on the right `webContents` (the app window, or the browser guest), or
  add that as a path for shortcuts only. Codex decides which after reading `input.ts`.
- When it is done, remove the "these shortcuts do not run from `pressKey`" caveats from `agents/browser.md` and the
  screens guide, and cover keyboard zoom and the voice-typing shortcut in the integration suite (the fake microphone
  exists, EPIC-196).

### US-2124: Call gaps

- **Open a folder in its editor.** This was hit four times: Folder View, Git Tree (`.git`), a board's folder claim
  (EPIC-188, EPIC-191). `pages.openFile(folder)` always makes a workspace page (`api/types/pages.d.ts:56-60`). The
  only route is to open the parent folder as a workspace and double-click the child row. Add an option, or a
  sibling method, that opens a folder the way an Explorer row does (`FileTreeProvider.getNavigationUrl`).
- **Save any page.** This was hit three times (EPIC-192, EPIC-194). A board content page (`.excalidraw`,
  `.rest.json`, Todo, Notebook) has no save member, so tests switch to Monaco and call `saveFile()`. Add a page-level
  `save()` that does what Ctrl+S does on that page.
- **Error codes in every namespace.** US-2120 appends `[code: …]` for `capabilities[...]` only. The code is lost in the
  `ai-vision` package's resolver (`errMessage`). The fix there needs an `ai-vision` release (the user's package).
  Codex checks whether a Persephone-side fix in `toCallResult` covers it first; if not, the task stops for the user
  to approve the package change.

### US-2125: Test host value fidelity

- Strings stay strings: the host stops guessing with `JSON.parse` (`src/test-host/client.ts:103`) and uses the type
  the call tool sends (see Decisions). This is the most repeated test failure in the log: eight entries over six
  epics (`"true"` → `true`, file text → object).
- The `ctx.app` stand-in accepts call options (`maxLength`, `dialog`). Today any large read throws "truncated
  without maxLength" and has to fall back to `ctx.call` (EPIC-188, EPIC-194).
- `ctx.waitFor` takes call options, so it can poll while a dialog is open.
- `ctx.call` on a method path with no args array throws and names the fix, instead of returning the descriptor.
- `ctx.openBrowser()` returns the page id too.
- `ctx.expect` gets `toBeGreaterThan` / `toBeLessThanOrEqual` / `toMatch`. These were guessed twice.
- [web-app-tests.md](../../assets/guides/agents/web-app-tests.md) gets one "Crossing the call boundary" section:
  - `ctx.app` is the call-tree root, not the script `app`;
  - a stand-in names a path and is resolved again on each read, including after an editor switch;
  - method calls start at once, while property reads start on `await`;
  - awaiting a node returns its summary;
  - `undefined` comes back as `null`, and `undefined` properties are dropped;
  - arguments must be JSON;
  - `waitFor` resolves to the polled value;
  - attention covers menus as well as dialogs;
  - leave unsaved pages to cleanup;
  - never let `finally` throw.

### US-2126: Guide and `$help` sweep

These are single-feature doc gaps from the log that are still open. Many entries say "guide corrected", so Codex
first checks which ones are still true and lists them in the task document. The groups that matter most:

- **`window.screen`:**
  - `text=foo` is a substring match and `text="Foo"` is exact;
  - `interactive: true` can return an empty string;
  - every open page stays mounted, so scope queries to `[data-name="page-slot"][data-page-id=…]`, except popups,
    menus and dialogs, which render at the window root;
  - virtualized lists keep hidden pooled rows, so read `innerText` and never `textContent`;
  - UIKit inputs carry `data-name` on the wrapper, and Textarea is contenteditable.
- **Browser:**
  - `waitFor` takes exactly one condition;
  - `force` still clicks whatever is on top;
  - a pop-up becomes the active inner tab;
  - `openUrlInBrowserTab` reuses the active browser page;
  - which shortcuts need focus in Persephone's chrome;
  - what the `menus` node lists (not UIKit menus).
- **Boards (`boards/testing.md`, `bridge.md`, `permissions.md`):**
  - poll `editor.app` after `frameReady`;
  - `click` returns before the board's async handler finishes;
  - board processes end shortly after `closePage`;
  - roots are OS paths, so compare them normalized;
  - the minimal `aiVision.expose` descriptor;
  - a permission table (flag, what it gates, how a denial shows);
  - `network: false` does not restrict a service;
  - `folderMasks` is not a folder claim;
  - a missing `minBridgeVersion` drops capability declarations;
  - bundled boards are not in `boards.list()`.
- **Elsewhere:**
  - an event-kinds table in `agents/ai-vision.md`;
  - `$describe` `node: true`;
  - `app.fetch` in the app-object guide;
  - the capabilities call-tree form next to the script form;
  - the `guides` read returns the body after front matter;
  - drop the hard-coded Settings counts.

## Out of scope: published boards

About 35 entries are about `persephone-boards`: a `CLAUDE.md` or README that disagrees with the board, result
shapes found only in board source, and boards whose data root or network use escapes the test profile (Translate,
claude-agent, torrent-viewer). The Theme Editor `previewTimer` bug and the Audio Player issues are open items of
EPIC-194 and EPIC-197. Persephone cannot fix any of this. If the user wants it, a separate pass in that repo would:

- give each board's `guides/agent.md` one example result per model method;
- list which boards expose `editor.app` and in which open modes;
- take board data roots from the board storage location.

## Notes

### 2026-11-18
- The log has the EPIC-194 block (US-2104 to US-2106, about 14 entries) twice, at lines 1017-1114 and 1115-1211.
  The theme counts in its summary are a little high because of it.
- Theme counts after the review: docs/`$help` thin 45 · published boards 35 · reach gaps 20 · guessed members 13 ·
  attention 11 (mostly closed by cleanup) · value shapes 10 · `waitFor` 10 · selector scoping 6 · main-process keys 5
  · display text 4 · error codes 3.

### 2026-11-18 (autonomous run, Claude + Codex Luna)

All six tasks were planned by Codex, reviewed by Claude, implemented by Codex, verified and staged. Nothing is
committed. Decisions and open items:

- **Open item, needs the user's approval (US-2124):** error codes in every namespace need a change to the `ai-vision`
  package. Its resolver builds the error with `errMessage(error)` (`node_modules/ai-vision/dist/core/resolver.js`) and
  `ICallResult.error` is a string, so `toCallResult` never sees the code. The fix is to carry `code` from the thrown
  error into the resolver's error envelope and release the package. Nothing was changed in the package; the
  `capabilities[...]` workaround from US-2120 still stands.
- **Tree row names (US-2121):** a row is named by its label only (`aria-labelledby` on the label host). The secondary
  label (the Explorer root's full path) and the trailing content (counts, hover action buttons) are left out, because
  trailing slots often hold buttons. A category count such as Link Collection's `Stylesheets 1` is no longer in the
  name; the HTML "Show Resources" test now reads the row's trailing text for the count.
- **`pressKey` routing (US-2123):** a key goes through `webContents.sendInputEvent` when the key itself or its held modifiers
  include Control, Alt or Meta, or the key is F5 or F12. Plain keys, Shift-only combinations and text stay on CDP. The
  route chosen at key-down is kept for the key-up. Dispatch lives in the new `src/main/cdp-key-input.ts`;
  `cdp-service.ts` only exports its resolver (roadmap MAIN-7 does not grow).
- **Drift check (US-2122):** the mapping was mechanical, so `scripts/describe-tables-check.mjs` compares each editor
  facade's public methods and `IBoards` with their describe tables (allowlist at the top). It runs as part of
  `npm run lint` and as `npm run describe-tables:check`.
- **Page save (US-2124):** `pages[id].save()` calls the content host's `saveFile(false)`, which is what Ctrl+S does on
  text pages and in board content frames. The board close-time `onSaveRequest` path is a different thing and is not
  used. A page with no content host throws.
- **Result type (US-2125):** the call tool adds `_meta["persephone/resultType"]` (`"string"` or `"json"`); the text
  that agents read is unchanged. `structuredContent` was rejected because some clients show it to the model instead
  of the text.
- **Product bug fixed by Claude (US-2124):** `pages.openFolder` returned `null` for `.git` and board folder claims.
  The Layer 3 open handler (`src/renderer/content/open-handler.ts`) never reported the page it opened through
  `data.openedPageId`; only the folder-page action did. It now does for both its branches.
- **No new English UI text** was added, so there is nothing to translate at epic close.
- **Pre-existing failure, not this epic:** `editors/grid/data-operations` "Ctrl+Insert adds an unsorted row and is
  blocked while sorted or filtered" still fails (EPIC-187 open decision: av-grid always passes `canAddRows: true`).
- **Product bug fixed by Claude (US-2123):** browser `type()` on a contenteditable selected with a Ctrl+A key press.
  After the routing change that press goes through Electron input, which is not ordered with the CDP text insertion
  that follows, and one full-suite run kept the old text. `src/renderer/automation/forms.ts` now selects the editing
  host's content in the page. **Open concern:** an agent that presses a Ctrl/Alt shortcut and types straight after
  can hit the same ordering gap; if it shows up again, make the Electron key route wait for the renderer to handle
  the event before returning.
- **Integration results (2026-11-19):** full owned suite (`--with git,mneme`) after all six tasks: 529 passed,
  4 failed, 2 skipped. The contenteditable failure above is fixed (browser and editors areas rerun green apart from
  the grid test). The other three are pre-existing: grid Ctrl+Insert (EPIC-187), Audio Player `previous()` and Theme
  Editor `previewStatus` (EPIC-200). New tests: keyboard zoom, voice-typing shortcut, browser F5 (US-2123);
  `pages.openFolder` for Folder View, `.git` and a board claim, and `page.save()` on text and board pages (US-2124);
  value types, method-args guard and assertion helpers in `core/mcp` (US-2125); element declarations and snapshot
  names (US-2121).

### 2026-11-19 (error codes, Claude)

The US-2124 open item is closed. The user approved the `ai-vision` change and release on 2026-11-19.

- **ai-vision 1.4.0 (AV-002):** a thrown error's own string `code` is kept as `ICallResult.code`. The remote error
  response carries `code` too, so a model behind `expose()` keeps it. Errors without a code are unchanged.
- **Persephone side:** `toCallResult` (`src/main/mcp/tools/call-tools.ts`) renders a coded error as
  `Error [<code>]: <message> (resolved up to ...)` in every namespace; an uncoded error is unchanged. The capability
  tree's `[code: ...]` suffix (US-2120) is removed: it now throws plain `codedError`s, so there is one path. The test
  host reads the code from the `Error [<code>]:` line. `app.call()` in scripts throws a coded error when the envelope
  has one.
- **Open item:** a board's `persephone.call()` (`src/renderer/api/boards/board-host-rpc.ts`) still rewraps the error
  and loses the code. Fixing it changes board-visible behavior and needs a `BOARD_BRIDGE_VERSION` bump, so it was left
  for a separate task.
- No English UI text was added.
