# US-2005: Page history object model and guides

## Goal

Expose the existing page history to scripts and ai-vision, and document the navigation controls and API for [EPIC-178](../../epics/EPIC-178.md). This is the final task of the epic; implementation follows [US-2003](../US-2003-page-history-model/README.md) and [US-2004](../US-2004-page-history-ui/README.md).

## Background

- `src/renderer/api/pages/PageHistory.ts` owns each page's stacks, capture, replay, persistence snapshots, missing-source handling, and in-flight guard. `entries` is the Back stack only; `snapshot()` returns both `back` and `forward`, oldest first, with the next destination at the end. Each entry has `title`, logical `filePath`, `target` (editor type ID), and optional `sourceLink`. Snapshots are frozen copies. Each stack is capped at 50.
- `PageHistory.back()` and `forward()` currently return `Promise<void>`. `PageNavigator.commitHistory()` sets `historyMove.committed = true` only when `commitNavigation` commits the move; a lifecycle result of `true` alone is insufficient because an interceptor can take the request. Empty, busy, inert, absent-navigator, cancelled and taken paths can leave the page unchanged. Missing local entries are removed with a toast; reconstruction failure is toasted and rethrown. Other navigation errors can reject. `src/renderer/api/internal/PageHistoryControls.ts` discards the result and catches UI-triggered rejections.
- `PageWrapper` in `src/renderer/scripting/api-wrapper/PageWrapper.ts` is used by `ScriptContext` for `page` and by `PageCollectionWrapper.wrap()` and `.all` for indexed pages. Its `page` can be an `IPageHost`, whose optional history interface currently contains only `back(): Promise<void>`, or a `PageModel`. `pages.query.findPage(id)` resolves the actual page without adding history members to that editor host contract. An editorless open page still has a `PageModel` and history. A missing page has no history to operate on.
- `src/renderer/scripting/ai-vision/page-editor-switches.ts` demonstrates the child-node pattern: a dedicated `IAiVisible` class, provider callback, member declarations, help and summary; `PageWrapper` supplies the getter and declares a `node: true` member. Follow it for history. Roadmap section 2.3 does not list `PageWrapper.ts`; it does list `PageModel.ts`. Keep history presentation in its own node and do not add rules to `PageModel`.
- Browser webview navigation has its own history. The header and shell gestures explicitly exclude Browser pages in `PageHistoryButtonsView` and `PageHistoryControls`. The new node reports the actual page-model stacks, normally empty for a Browser page; it never reports or controls webview history. If a Browser page has model entries, expose them truthfully and delegate calls to that model, without inventing a Browser gate. The Browser editor's own navigation remains separate.
- `src/renderer/scripting/api-wrapper/MarkdownEditorFacade.ts` already delegates `navigateBack()` to its editor's optional page history, including rejection propagation. Keep it as a documented compatibility alias: existing scripts continue to work and the general `page.history.back()` is the preferred discoverable page-wide API. Its current ai-vision description incorrectly suggests the destination must be Markdown.
- `src/renderer/ui/app/AppHeaderView.ts` composes `page-history-back` and `page-history-forward` before the tab strip. `MainPageView.ts` instead uses `BoardWindowHeaderView.ts` for board windows, which has no history controls. `KeyboardService.ts` handles Alt+Left/Right and DOM mouse buttons 3/4 for eligible pages; an already handled event or an event inside another document may not reach the shell. `assets/guides/shortcuts.md` currently lists Alt+Left/Right under Monaco Navigation as well as Browser navigation; reconcile the Monaco rows with shell ownership rather than implying an independent Monaco history.

## Implementation Plan

- [x] **Replay result owner:** in `src/renderer/api/pages/PageHistory.ts`, change `back()`, `forward()` and `replay()` to `Promise<boolean>`. Return `false` for busy, inert, no navigator, empty stack and missing-entry removal. After awaiting the navigator and preserving its existing pipe-disposal/transfer logic, return `move.committed === true`; this existing `PageNavigator.commitHistory()` marker, not the lifecycle's boolean, identifies a committed move. Preserve `finally`, the busy reset, toasts, pipe ownership and thrown errors. A save-prompt cancellation, interceptor take, or any other noncommitting normal return yields `false`. In `src/renderer/api/pages/IPageHost.ts`, change the existing optional `history.back()` return type to `Promise<boolean>` so `PageModel implements IPageHost` remains valid; add no other members. `PageHistoryControls` already discards the result. `MarkdownEditorFacade.navigateBack()` continues to await and discard it, preserving `Promise<void>` and rejection propagation.
- [x] **History node owner:** add `src/renderer/scripting/ai-vision/page-history.ts`, following `PageEditorSwitchesNode`. Supply a callback returning the real `PageModel | undefined`, resolved by `pages.query.findPage` from the wrapper's page ID at access time. Expose live `canGoBack`, `canGoForward`, and `entries: { readonly back: readonly IPageHistoryEntry[]; readonly forward: readonly IPageHistoryEntry[] }`; take one `PageHistory.snapshot()` per `entries` read and map each entry to a fresh `{ title, filePath, target }`. Both arrays are oldest first; the last entry is next. The returned copies must not mutate model state. Exclude the whole `sourceLink`, including its pipe descriptor: it is replay metadata, potentially contains configuration, and is not needed to identify a destination. Do not replace `filePath` with an asserted href; it can be a local path or virtual URL. Delegate methods directly to the model's `back()` and `forward()` with no UI catch. When no page is found, return false availability, empty arrays and methods resolving `false`, matching the nullable page-child pattern. Keep all replay, capture, missing-file and concurrency rules in `PageHistory`; reuse `snapshot()` and the existing methods.
- [x] **Discovery:** in `PageWrapper.ts`, add the thin getter using that provider, `PAGE_MEMBERS` entry with `node: true`, and update `PAGE_HELP` and the `aiVision` summary to mention page history. Follow the existing node discovery convention; ensure `pages[i].history` and `page.history` support inspect, member reads, method invocation and `$help`, and that the node's `IAiVisionDescriptor` declares both boolean properties, `entries`, and both `Promise<boolean>` methods with navigation cautions, explanatory help and a live summary. Help explains `true` for a committed move, `false` for a normal no-op, and rejection for actual errors. Preserve existing page privacy restrictions. No separate protocol or member-registration system is needed.
- [x] **Types:** add `src/renderer/api/types/page-history.d.ts` for `IPageHistoryEntry` and `IPageHistory` with readonly properties and arrays, `target: string`, and both methods returning `Promise<boolean>`. Document order, copies, committed-move result, failure/no-op behavior and the separate Browser history. Import it in `src/renderer/api/types/page.d.ts` and add `readonly history: IPageHistory` to `IPage`; `pages.d.ts` already imports `IPage`. In `src/renderer/api/types/markdown-editor.d.ts`, document `navigateBack()` as a compatibility alias for this page's history Back that discards the result, recommending `page.history.back()`. Update `MARKDOWN_EDITOR_MEMBERS` and `MARKDOWN_EDITOR_HELP` in `MarkdownEditorFacade.ts` to match; retain its existing implementation and `Promise<void>` signature.
- [x] **Screens contract:** add both selectors and their purpose to the header section of `doc/architecture/ui-element-contract.md`. In `assets/guides/screens/header.md`, update the regular header layout, control-name list, selector table and position descriptions: buttons lie between menu and tabs, act on the active work page, show destination/shortcut tooltips, and disable on empty direction or Browser. State that the separate board-window header has no history buttons and retain its layout. Update the regular window diagram in `assets/guides/screens/index.md` where it depicts the header. Keep element ownership and visibility descriptions accurate.
- [x] **Navigation guides:** in `assets/guides/tabs-and-navigation/index.md`, add a concise page-history section: in-place navigation, Back/Forward controls, Alt+Left/Right and physical mouse buttons 4/5, independent per-page stacks, Forward clearing after a new navigation, session restoration, save-prompt cancellation, no entry for unaddressable untitled content, and the Browser's separate history. Explain the active work page, including a right-pinned popover. Link the header and scripting guides. In `assets/guides/shortcuts.md`, add the shell shortcuts under Application (Global), qualify Browser behavior and input-document limitations, and correct the Monaco navigation rows so the same keys are not presented as a second independent history. Retain the Browser shortcut rows.
- [x] **Markdown and scripting guides:** in `assets/guides/editors/markdown.md`, remove `[Back]` from the toolbar drawing and all `markdown-back` references, and replace the old toolbar explanation with page-wide navigation and a link to the header or tabs guide. In `assets/guides/scripting/api/page.md`, add the property and a `page.history` section with a small awaited example using the boolean result, both stacks and entry fields/order, rejection/no-op and Browser semantics, plus the Markdown alias that discards the result. In `assets/guides/whats-new.md`, add a concise entry under Version 5.0.19 (Upcoming) Improvements for page-wide navigation and its scripting API. Keep historical release entries intact.
- [ ] **For /document at epic close:** `doc/architecture/pages-architecture.md` and `doc/architecture/key-files.md` are the developer-doc candidates for page history. The epic completion workflow runs `/document`; do not edit those pages as part of this task plan.
- [x] **Verification for implementer:** ran `npm run typecheck`, `npm run lint`, and `npm run build-prod` successfully. `npm run guides:check` could not start because the sandbox returned `spawn EPERM`; recorded for Claude outside the sandbox. No unit tests were added. `guides.search` in the live app returns the new Page API, Page history, shortcuts, and header-guide passages.

### Before and after sketches

```ts
// Before: the page wrapper has sibling nodes but no history node.
get tab(): PageTabNode { return new PageTabNode(() => this.page); }
// After: add a sibling node backed by the actual page, resolved when used.
get history(): PageHistoryNode {
    return new PageHistoryNode(() => pages.query.findPage(this.id));
}
```

```ts
// Before: model entries exposes Back only and may include sourceLink.
pageModel.history.entries;
// After: script-facing projection uses both stacks, excluding sourceLink.
const { back, forward } = pageModel.history.snapshot();
return { back: back.map(projectEntry), forward: forward.map(projectEntry) };
```

```ts
// Before: Markdown-specific entry point remains available.
await page.editor.navigateBack(); // after narrowing to md-view
// After: prefer the page-wide entry point; the former remains an alias.
const moved = await page.history.back(); // true only for a committed move
```

The sketches omit types, nullable handling and ai-vision declarations; the checklist specifies them.

## Concerns

- A resolved `true` means the history move committed; `false` covers normal no-op paths, including cancellation, removal of a missing entry and interceptor take. Actual thrown errors reject, even if a failure occurs after a commit; the model may also show a toast. The Markdown compatibility alias discards the boolean.
- Browser model history is distinct from webview history even if its stacks are nonempty. The Browser's own controls and shortcuts remain authoritative for web pages. A direct model call is not the header's Browser-excluded UI action.
- A snapshot's path and title can still contain user data. Removing `sourceLink` prevents exposing replay configuration through this new surface; it does not make the destination itself private. Preserve existing ai-vision page restrictions.
- No new protocol, board bridge, Browser code, import-zone exception, dynamic import to bypass a cycle, or wrapper whose sole purpose is bypassing a zone. Use direct imports permitted by the existing zones. Boards continue to navigate through `openRawLink`.

## Acceptance Criteria

- `page.history` and `pages[i].history` are typed and discoverable through ai-vision, including help, summary, booleans, both oldest-first projected stacks and callable Back/Forward. Copies expose only `title`, `filePath` and `target`; mutation cannot change the model.
- Calls target the represented page and resolve `true` only for a committed move; empty, busy, inert, absent navigator, missing entry removed, cancelled, intercepted and missing-host paths resolve `false`. Real errors reject and calls do not route through the swallowing UI control. Browser reporting clearly distinguishes page-model history from webview history.
- Markdown `navigateBack()` remains a documented compatibility alias, with page-wide semantics in types, facade help and guides.
- The two header selectors are in the UI contract and screens guide; navigation, shortcuts, Markdown, scripting and upcoming release guides reflect the implemented controls and limitations. Obsolete `markdown-back` guide references are removed.
- All four specified npm checks pass or an `EPERM` sandbox limitation is recorded for Claude. No unit tests are added. Epic-close developer documentation is deferred to `/document`.

### Claude live checks

1. Navigate A to B to C; inspect both stacks via `page.history` and `pages[id].history`, move Back and Forward and verify `true`, then branch; verify order, fields, copies and Forward clearing.
2. Inspect the node and `$help` through ai-vision; invoke both methods on a non-active page and inspect an editorless page.
3. Exercise empty and busy history, a cancelled save prompt, a missing file and an interceptor take; verify `false` and appropriate stacks. Force a reconstruction failure and confirm rejection is observable.
4. Check a Browser page reports page-model history, not webview history; confirm its own controls and shortcuts still navigate the webview and shell buttons are disabled.
5. Follow a Markdown link, use the header and the retained narrowed facade alias; verify the removed toolbar control and updated guide selectors.
6. Check header selectors and tooltips, keyboard and mouse gestures, right-pinned popover behavior, persistence after restart, and `guides.search` results.

## Files Changed

| File | Planned change |
| --- | --- |
| `src/renderer/api/pages/PageHistory.ts`, `src/renderer/api/pages/IPageHost.ts` | Return the committed-move boolean and align the narrow host type. |
| `src/renderer/scripting/ai-vision/page-history.ts` | New history projection, methods and ai-vision descriptor. |
| `src/renderer/scripting/api-wrapper/PageWrapper.ts` | Expose and describe the child node. |
| `src/renderer/api/types/page-history.d.ts`, `src/renderer/api/types/page.d.ts` | Define the script contract and attach it to `IPage`. |
| `src/renderer/api/types/markdown-editor.d.ts`, `src/renderer/scripting/api-wrapper/MarkdownEditorFacade.ts` | Document the retained alias in types and ai-vision. |
| `doc/architecture/ui-element-contract.md` | Document both header selectors. |
| `assets/guides/screens/header.md`, `assets/guides/screens/index.md` | Header controls, placement and screen diagrams. |
| `assets/guides/tabs-and-navigation/index.md`, `assets/guides/shortcuts.md` | Page navigation behavior and gestures. |
| `assets/guides/editors/markdown.md`, `assets/guides/scripting/api/page.md`, `assets/guides/whats-new.md` | Remove stale Markdown control and document API and feature. |

No changes: `src/renderer/api/pages/PageModel.ts`, `src/renderer/api/types/pages.d.ts`, Browser code, `src/renderer/api/internal/PageHistoryControls.ts`, `src/renderer/api/internal/KeyboardService.ts`, header implementation, board bridge, `doc/active-work.md`, and `doc/epics/EPIC-178.md`. `doc/architecture/pages-architecture.md` and `doc/architecture/key-files.md` are for `/document` at epic close.
