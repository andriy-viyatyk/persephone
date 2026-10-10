# US-1668 — Shim-owned text: board context menu from Persephone's catalog

Epic: [EPIC-126 — Boards localization](../../epics/EPIC-126.md#us-1668--shim-owned-text)

## Goal

Move all user-facing text emitted by Persephone's built-in board context menu into the app's English catalog and pass the active translations to each board frame at registration. Keep menu actions addressable by stable IDs, including under `en-XA`, without bundling the app catalog into the board webview.

## Background

`src/board-context-menu.ts` installs a custom DOM menu inside the board iframe. It listens for `contextmenu`, creates a fixed-position `<div data-persephone-menu>` with `<button>` children, and assigns each visible label to `button.textContent` (`:282-315`). The menu appears for external links, images, editable fields and selected text (`:361-407`). Its menu item records currently contain only `label` and `action`; neither the records nor the rendered buttons have stable IDs. Add stable IDs and expose them on each button as a data attribute so locale changes affect presentation only.

The host already passes `BoardI18nContext` through `BoardWebview.registerBoard()` → `api.registerBoard()` → `Endpoint.registerBoard` → `main/board-protocol-service.ts`, and `BoardBootContext.i18n` is consumed synchronously in `src/board-shim.ts`. Reuse this registration and boot path for a small `hostText` record. Resolve every value with renderer-side `t()` before registration. The shim must read only the serialized text record and must not import `t()` or any catalog module.

### User-visible string inventory

The following are authored by the shim and shown to users. Menu labels are rendered in the board iframe; the action feedback is sent to Persephone's notification UI and is therefore also display copy.

| Text | Current source | Stable ID / catalog resolution |
|---|---|---|
| Open Link | `src/board-context-menu.ts:374` | `openLink` → `board.openLink` |
| Copy Link | `src/board-context-menu.ts:375` | `copyLink` → reuse `editors.copyLink` |
| Open Image in New Tab | `src/board-context-menu.ts:385` | `openImageInNewTab` → `board.openImageInNewTab` |
| Copy Image | `src/board-context-menu.ts:386` | `copyImage` → `board.copyImage` |
| Save Image As… | `src/board-context-menu.ts:387` | `saveImageAs` → `board.saveImageAs` |
| Image (save-dialog file filter) | `src/board-context-menu.ts:165` | `imageFileFilter` → `board.imageFileFilter` |
| All Files (save-dialog file filter) | `src/board-context-menu.ts:166` | `allFilesFileFilter` → `board.allFilesFileFilter` |
| Cut | `src/board-context-menu.ts:397` | `cut` → reuse `menus.cut` |
| Copy (editable selection) | `src/board-context-menu.ts:398` | `copy` → reuse `menus.copy` |
| Paste | `src/board-context-menu.ts:399` | `paste` → reuse `menus.paste` |
| Copy (plain text selection) | `src/board-context-menu.ts:403` | `copy` → reuse `menus.copy` |
| Save Image (native save-dialog title) | `src/board-context-menu.ts:162` | `saveImageDialogTitle` → `board.saveImageDialogTitle` |
| Failed to open image: {error} | `src/board-context-menu.ts:61` | `failedToOpenImage` → `board.failedToOpenImage` |
| Failed to copy image: {error} | `src/board-context-menu.ts:99` | `failedToCopyImage` → `board.failedToCopyImage` |
| Image saved. | `src/board-context-menu.ts:172` | `imageSaved` → `board.imageSaved` |
| Failed to save image: {error} | `src/board-context-menu.ts:174` | `failedToSaveImage` → `board.failedToSaveImage` |
| Paste failed: {error} | `src/board-context-menu.ts:252` | `pasteFailed` → `board.pasteFailed` |

`common` has no `copy`, `cut`, or `paste` entries; `menus.copy`, `menus.cut`, and `menus.paste` already exist and should be reused. `editors.copyLink` already has the exact `Copy Link` wording. Add the remaining board-specific messages to `src/shared/i18n/en/board.ts`, with translator notes where context helps. Preserve `{error}` as a placeholder; the shim substitutes the runtime error text after reading the translated template.

`src/board-shim.ts` and `src/board-console-mirror.ts` contain no additional shim-authored DOM labels or dialogs. `board-shim.ts` has API/runtime error strings and console messages; `board-console-mirror.ts` forwards page errors and `console.warn`/`console.error` text to diagnostics. These remain English under D3. The caught-action feedback in the table is different: it is a user-facing notification rather than a thrown error or console entry, so it is included in this UI extraction.

### Menu consumers and identity

These menu items are not the renderer's `ai-vision` popup menus. `src/renderer/scripting/ai-vision/menus/index.ts` and `attention.ts` inspect renderer-owned popup models; they do not inspect the injected board DOM menu. The AI-vision adapter prefers a menu item's `id` and only falls back to labels, but it has no bridge to this board-frame menu. No MCP handler reads these labels. Still add stable IDs to the shim menu records and rendered buttons to meet localization/automation identity requirements: `openLink`, `copyLink`, `openImageInNewTab`, `copyImage`, `saveImageAs`, `cut`, `copy`, and `paste`. `copy` is deliberately shared by the two mutually exclusive Copy entries because they represent the same action identity. There are no existing IDs to preserve; once added, IDs must not vary by locale.

### Lint-clean fallback approach

`eslint.config.mjs` currently excludes both `src/board-context-menu.ts` and `src/board-shim.ts` from `vanilla-view/no-hardcoded-ui-strings` (`:285`). Remove only the `board-context-menu.ts` exclusion. Keep the rule-covered menu component free of literal user-facing labels: each `CtxItem` carries a stable text ID and asks the injected resolver for its label; the component renders the returned value with `textContent`. Put the English fallback map and resolver in the already-exempt `src/board-shim.ts`, which combines `boot.hostText[id]` with a literal fallback when the host record is missing. This avoids an `untranslated()` import from `src/shared/i18n/t.ts` (which would pull catalog code into the shim bundle) and keeps fallback strings out of the lint-covered component. Leave the `board-shim.ts` exemption in place as required by F4; update its rationale to cover boot fallback strings as well as English runtime errors.

## Implementation Plan

1. [x] **Add catalog messages and host text types.** Add the new board-specific entries to `src/shared/i18n/en/board.ts`; reuse the existing `editors.copyLink`, `menus.cut`, `menus.copy`, and `menus.paste` entries for exact duplicate wording. In `src/ipc/board-bridge-channels.ts`, declare a narrow `BoardHostTextId` union and `BoardHostText` record for the IDs above, then add `hostText: BoardHostText` to `BoardBootContext` beside the already-present `i18n` field. Keep the values as strings (including `{error}` templates) so the shim only needs small placeholder substitution.

2. [x] **Resolve text at board registration and transport it.** In `src/renderer/editors/board/BoardWebview.ts`, create the `hostText` record with `t()` while `registerBoard()` prepares the payload. Use the existing registration route in `src/ipc/api-types.ts`, `src/ipc/renderer/api.ts`, `src/ipc/main/board-handlers.ts`, and `src/main/board-protocol-service.ts`: add `hostText` beside `i18n` to the endpoint signature, renderer forwarding call, main handler, registration design record, and serialized boot script. Ensure main and secondary board document registrations both use the same path. Do not add a live locale event; locale and text are fixed for that document just like `i18n` (F3).

   **Before → after, registration payload:**

   ```ts
   // Before
   api.registerBoard(boardRoot, computeBoardThemePalette(), BOARD_TOKEN_VARS, boardI18n.context)
   // BoardBootContext carries: { theme, tokens, i18n, hostOrigin }

   // After
   api.registerBoard(boardRoot, computeBoardThemePalette(), BOARD_TOKEN_VARS, boardI18n.context, hostText)
   // BoardBootContext carries: { theme, tokens, i18n, hostText, hostOrigin }
   ```

3. [x] **Read host text and preserve a fallback in the shim.** In `src/board-shim.ts`, extend the boot-context fallback for direct/plain board loads with an empty `hostText` record. Add a dependency-free `hostText(id)` resolver that returns the translated boot value when present and otherwise the English fallback. Pass the resolver into `installBoardContextMenu()`; implement the fallback table in this exempt file so `src/board-context-menu.ts` contains no hardcoded UI strings and imports no i18n/catalog module. Add a tiny formatter for the `{error}` templates without changing error details.

4. [x] **Give every visible menu item a stable ID and resolve its label by ID.** In `src/board-context-menu.ts`, extend `CtxItem` with a host text ID and stable menu ID. Populate those IDs for link, image, editable-field, and selected-text items; assign the menu ID to a stable `data-persephone-menu-item-id` attribute on each button. Use the injected resolver to get the label; keep the action callbacks and group/separator ordering unchanged. Resolve the save-dialog title and both file-filter names from `hostText`. Resolve the five notification templates through `hostText` and interpolate the caught error string. Keep thrown `Error` messages and console diagnostics untouched.

   **Before → after, menu item:**

   ```ts
   // Before
   { label: "Open Link", action: () => fire("openRawLink", [href]) }

   // After
   { id: "openLink", textId: "openLink", action: () => fire("openRawLink", [href]) }
   // showCtxMenu resolves textId through hostText and renders `id` as
   // data-persephone-menu-item-id; English fallback remains in board-shim.ts.
   ```

5. [x] **Remove only the context-menu lint exemption.** In `eslint.config.mjs`, delete the `filename.endsWith("/src/board-context-menu.ts")` exclusion and keep the `board-shim.ts` exclusion. The menu file's rendered value comes from the injected `hostText` resolver, not an English literal; the fallback table resides in the exempt shim file. Preserve the exemption comment rationale so it describes this fallback plus English runtime errors. Verified by `npm run lint` and `npx eslint src/board-context-menu.ts` (zero reports).

6. [ ] **User live check pending.** In `C:\projects\test-boards\us-1667-i18n\index.html`, add an external link, a loaded image (data URL or known local board asset), and a text input. Start Persephone, set the app language to `en-XA` with `app.settings.set("language", "en-XA")` if needed, reload the window, and open the scratch board with `boards.openBoard("C:\\projects\\test-boards\\us-1667-i18n")`. Right-click the link, image, and input to open each menu group. Read the visible labels directly, or inspect the board frame after opening a menu with `pages[i].editor.evaluate("Array.from(document.querySelectorAll('[data-persephone-menu] button')).map(button => ({ id: button.dataset.persephoneMenuItemId, label: button.textContent }))")`. Confirm pseudo-text is shown while IDs stay identical, the save dialog title is pseudo-localized, and a missing `hostText` key falls back to English. Repeat in English to verify the fallback wording. Keep the scratch fixture outside this repository. The user will run this check; Persephone cannot be started in this sandbox.

## Concerns

- The task's phrase “every user-visible string the shim itself draws” includes five action-result notifications in `src/board-context-menu.ts`; they are displayed by the host but originated in the shim. They should be translated alongside the menu and save-dialog title. Thrown errors, board API errors, and mirrored console text remain English under D3.
- F4 says existing menu IDs are unchanged, but source inspection finds no IDs on `CtxItem` or rendered buttons. The implementation should add the stable IDs listed above and ensure they are locale-independent; there is no prior ID value to preserve.
- English fallbacks must remain available if a boot key is absent, but must not make the lint-covered menu file report hardcoded UI strings. Keep fallback literals in the explicitly exempt `src/board-shim.ts`; do not import `untranslated()` from the catalog-bearing `t.ts` module into the webview bundle.
- The AI-vision menu API can fall back to labels for renderer-owned popup menus. It does not currently read this board DOM menu, so this task adds stable DOM IDs without changing the renderer menu model or MCP API.
- `hostText` is registration-time data and should be refreshed by the existing board document reload on language change. No separate live update channel is required.

## Acceptance Criteria

- Every menu label, the native save-dialog title and filter names, and user-facing menu-action notification in the inventory comes from the Persephone catalog; generic copy/cut/paste and Copy Link reuse existing entries where applicable.
- The renderer resolves host text with `t()` during registration and sends a compact `hostText` record in `BoardBootContext` beside `i18n`; the shim uses that record and has English fallbacks for missing entries.
- No catalog or `t()` import is added to `src/board-shim.ts` or `src/board-context-menu.ts`; the board webview bundle remains independent of the app catalog.
- Every translated menu button has a stable ID exposed in the DOM. IDs are unchanged between `en` and `en-XA`; visible labels are pseudo-text under `en-XA`.
- `eslint.config.mjs` no longer exempts `src/board-context-menu.ts` from `vanilla-view/no-hardcoded-ui-strings`; the menu file passes by rendering resolved host text. `src/board-shim.ts` retains its exemption.
- Thrown errors, board API error strings, and console/diagnostic text remain English under D3.
- The scratch-board check opens link, image, and editable-field menus under `en-XA`, reads their labels and IDs, verifies save-dialog title localization, and confirms English fallback for a missing host-text key.

## Files Changed

Files that should need no changes: `src/renderer/scripting/ai-vision/menus/index.ts`, `src/renderer/scripting/ai-vision/attention.ts`, and `src/main/mcp/` (they do not inspect this injected board DOM menu); `src/board-console-mirror.ts` (diagnostic and console forwarding only); `src/shared/i18n/en/common.ts` (no generic keys exist there); `src/shared/i18n/en/menus.ts` and `src/shared/i18n/en/editors.ts` (reuse existing entries, do not duplicate them); board author guides and the US-1667 board pack loader (out of scope); `doc/epics/EPIC-126.md` and `doc/active-work.md` (explicitly excluded by this task request).

| File | Planned change |
|---|---|
| `doc/tasks/US-1668-board-shim-text/README.md` | This task plan. |
| `src/shared/i18n/en/board.ts` | Add catalog entries for board-specific menu labels, dialog title/filter names, and notification messages. |
| `src/ipc/board-bridge-channels.ts` | Add host-text IDs/record and include it in `BoardBootContext`. |
| `src/renderer/editors/board/BoardWebview.ts` | Resolve host text with `t()` during registration. |
| `src/ipc/api-types.ts` | Extend the board registration endpoint signature. |
| `src/ipc/renderer/api.ts` | Forward host text through the renderer IPC wrapper. |
| `src/ipc/main/board-handlers.ts` | Pass host text through the main registration handler. |
| `src/main/board-protocol-service.ts` | Serialize host text into the board boot context. |
| `src/board-shim.ts` | Resolve translated boot text with English fallback and pass it to the menu installer. |
| `src/board-context-menu.ts` | Use text IDs, stable DOM IDs, host text, and translated feedback. |
| `eslint.config.mjs` | Remove the context-menu lint exemption; retain the shim exemption. |
