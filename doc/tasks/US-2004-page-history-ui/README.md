# US-2004: Back / Forward UI

## Goal

Add page-history controls and input gestures for [EPIC-178](../../epics/EPIC-178.md), using the implemented [US-2003 model](../US-2003-page-history-model/README.md). Remove the Markdown-only toolbar control while preserving its existing script method.

## Background

- `src/renderer/api/pages/PageHistory.ts` owns replay, missing-source preflight and in-flight exclusion. `entries` contains only Back entries; `snapshot().back` and `.forward` contain immutable oldest-first stacks, so `.at(-1)` is the next destination. Entries have a required `title`. `PageModel` mirrors availability into `state.canGoBack` and `state.canGoForward` in its history callback.
- `src/renderer/api/pages/PagesQueryModel.ts` defines `activePage` as the last `ordered` page; `focusedPage` instead prefers the right-pinned popover. Use `pages.query.activePage` for all new controls and gestures, including when the popover is open. `pages.state` changes when ordering changes. Subscribe to the active page's whole `state`, not a selector of only the two booleans: a history top can change while both booleans stay true. `TOneState.set` dispatches even when Immer returns the same object. Rebind and dispose subscriptions as in `src/renderer/ui/app/PageContentView.ts`.
- `src/renderer/ui/app/AppHeaderView.ts` appends the menu immediately before `pageTabs`. `IconButtonView` supports `name`, `disabled`, `title`, updates, and a tooltip. `src/renderer/theme/icon-registry.ts` registers `arrow-left` and `arrow-right`. `doc/architecture/ui-element-contract.md` specifies `data-name`; `IconButtonView.name` emits it.
- `src/renderer/api/internal/KeyboardService.ts` registers one document `keydown` listener in `init()` and broadcasts `globalKeyDown` before its switch. `src/renderer/editors/browser/BrowserShortcutTable.ts` already handles Alt+Left/Right. Detect a Browser with `page.mainEditor?.editorId === EditorId.browserView` (`src/shared/editor-ids.ts`); do not import the Browser editor. Return without preventing or stopping Browser events.
- Installed Monaco `node_modules/monaco-editor/esm/vs/editor/contrib/wordOperations/browser/wordOperations.js` binds Alt+Left/Right for word movement on macOS, but uses Ctrl+Left/Right on Windows. Other installed Monaco matches include modified combinations, such as Shift+Alt. On this Windows application, plain Alt+Left/Right normally reaches the document listener from a focused Monaco editor and invokes page history; respect an already prevented event or stopped propagation from an editor. Verify this live. Do not override Monaco bindings.
- Browser webviews and other embedded frames may receive input in their own document; an outer document listener cannot promise gestures originating inside a guest frame. Do not add IPC or alter Browser handling.
- `PageNavigator.buildEditor` can toast and then throw for a history move, including a source disappearing after preflight. `guard()` always reports a toast, so it would double-report this case. `PageHistory.replay` can also reject during pipe reconstruction without a toast. Report reconstruction failures at that owner before rethrowing; the UI-boundary catch logs without a second toast. Preflight's missing-file toast remains unchanged.
- `MarkdownEditorView.ts` owns `MarkdownBackButtonView`; `MarkdownEditor.navigateBack` delegates to page history. `src/renderer/scripting/api-wrapper/MarkdownEditorFacade.ts` calls that method and `src/renderer/api/types/markdown-editor.d.ts` exposes it. Preserve the facade method by delegating directly to its editor's page history; its promise still rejects to script callers. This minimal compatibility change is separate from the US-2005 `page.history` node.
- `assets/guides/editors/markdown.md` lines 34, 69 and 75 describe the Back button or `markdown-back`; guide updates remain US-2005. `src/renderer/scripting/api-wrapper/MarkdownEditorFacade.ts` lists `markdown-back` in `MARKDOWN_ELEMENTS` and `MARKDOWN_EDITOR_HELP`; remove those element references in this task. The facade's `navigateBack` method and its description remain.
- Roadmap section 2.3 lists neither `AppHeaderView.ts` nor `KeyboardService.ts` as a god file. `PageModel.ts` is listed: do not add rules there. No new protocol, board bridge, import-zone exception, dynamic import to bypass a zone, or hardcoded color is needed.

## Implementation Plan

- [x] **Reconstruction failure owner:** in `src/renderer/api/pages/PageHistory.ts`, wrap only the `pipeFromPersistedSource(...)` call in a `try` / `catch`, before calling `navigate`. In the catch, call `ui.notify(t("api.failedToOpenNamedFileWithError", { name: fpBasename(entry.filePath), error: errMessage(error) }), "error")`, then rethrow the same error. Import `errMessage` from `src/shared/utils.ts`; reuse the existing `ui`, `t`, and `fpBasename` imports and existing catalog message. Keep the outer `finally`, pipe disposal and busy reset intact. Do not wrap navigator errors in this catch: `buildEditor` already reports its build failures.
- [x] **Shared action owner:** add `src/renderer/api/internal/PageHistoryControls.ts` to own active-page eligibility, Browser exclusion and safe UI invocation. Resolve the active page at invocation time; require the corresponding `canGoBack` / `canGoForward` and call `page.history.back()` / `forward()`. Catch rejection and `console.error` it once, without another toast; do not use `guard` here. Reuse `pages.query.activePage`, `EditorId.browserView`, and `PageHistory`. Keep script calls outside this swallowing boundary.
- [x] **Header owner:** add `src/renderer/ui/app/PageHistoryButtonsView.ts`, a `VanillaView` that owns two `IconButtonView` children named `page-history-back` and `page-history-forward`, with `arrow-left` and `arrow-right`. Subscribe to `pages.state`, rebind to the current active page's whole state, synchronize immediately on mount and after each notification, and release old subscriptions and children on disposal. Read both destination titles from `page.history.snapshot()` each sync, even when availability did not change. Disable both if no page or Browser, otherwise disable the appropriate empty direction. Use stable click callbacks through the shared action owner. Supply accessible labels as well as tooltips. Reuse `IconButtonView` and its `attachTooltip`; no custom colors or new styling rules are required.
- [x] **Header composition:** in `src/renderer/ui/app/AppHeaderView.ts`, create and mount the new child, append its root immediately after `menuButton` and before `pageTabs`, and let the view lifecycle dispose it. Ensure its wrapper does not disrupt header layout (use the existing `createContentsElement` pattern from `MarkdownEditorView.ts`).
- [x] **Input owner:** in `src/renderer/api/internal/KeyboardService.ts`, register mouse handling alongside the existing process-lifetime document listener, and route key and mouse events to the shared owner. Keep `globalKeyDown.send(e)` in its existing order. After that broadcast, accept only unmodified-except-Alt `ArrowLeft` / `ArrowRight`, excluding composing or already-prevented events. For a non-Browser active page, prevent the default even when the selected stack is empty, then invoke the corresponding action; do not stop propagation. For mouse, handle document `mousedown` buttons 3 and 4 (DOM numbering for physical buttons 4 and 5), prevent default for eligible non-Browser pages, and invoke once on down; suppress the corresponding non-Browser `auxclick` default without invoking again. Honor `defaultPrevented` and leave other buttons alone. If no active page or a Browser is active, do nothing and do not prevent default. Keep the registration in `KeyboardService`, with no Browser changes.
- [x] **Markdown cleanup:** remove `MarkdownBackButtonView`, its child creation, mount, update, toolbar slot, and unused `ButtonView` / `t` imports from `src/renderer/editors/markdown/MarkdownEditorView.ts`; retain the compact toolbar and body. Remove `MarkdownEditor.navigateBack` from `src/renderer/editors/markdown/MarkdownEditor.ts`. In `src/renderer/scripting/api-wrapper/MarkdownEditorFacade.ts`, remove the `markdown-back` entry from `MARKDOWN_ELEMENTS` and the reference in `MARKDOWN_EDITOR_HELP`. Retain the public `navigateBack` method and its member description; change its implementation to `async navigateBack(): Promise<void> { await this.editor.page?.history?.back(); }`. Leave `src/renderer/api/types/markdown-editor.d.ts` and guide text for US-2005.
- [x] **English catalog:** add to `src/shared/i18n/en/shell.ts` `pageHistoryBack: "Back to {title} (Alt+Left)"`, `pageHistoryForward: "Forward to {title} (Alt+Right)"`, `pageHistoryBackEmpty: "Back (Alt+Left)"`, and `pageHistoryForwardEmpty: "Forward (Alt+Right)"`, in catalog entry shape. Use the destination variants when a stack top exists and the empty variants otherwise. Preserve shortcut text in translator notes. Translate packs at epic close, not in this task.
- [x] **Verification:** `npm run typecheck`, `npm run lint`, and `npm run build-prod` pass. There are no project unit tests; add and plan none. Live checks below are assigned to Claude.

### Before and after sketches

```ts
// Before: Markdown toolbar owns the Back action.
onClick: () => { void this.model.navigateBack(); }

// After: the header's shared UI action resolves the active page at click time.
onClick: () => { void pageHistoryControls.go("back"); }
```

```ts
// Before: the shell places tabs directly after the menu.
this.root.append(this.menuButton, this.props.pageTabs, spacer);
// After: insert the lifecycle-owned history view between them.
this.root.append(this.menuButton, this.historyButtons.root, this.props.pageTabs, spacer);
```

The second sketch omits the existing later header children. Names are suggested implementation names; the checklist defines the required behavior.

## Concerns

- Reconstruction errors are reported once in `PageHistory` and rethrown; build failures already reported by `PageNavigator.buildEditor` are only logged by the UI boundary. Script callers retain rejection semantics. Other navigator stages can also throw outside `buildEditor` (for example `page.restore.ready` or `page.setMainEditor`), so the reconstruction-only catch does not establish that every possible rejection has already produced a toast. Account for those paths without double-reporting when implementing the no-silent-failure requirement.
- Guide references to `markdown-back` remain until US-2005. The obsolete AI element description is removed now. The public `navigateBack()` method continues to work for the owning page, including when that page is not the active page.
- Mouse event propagation and Monaco keyboard behavior must be checked in the running Electron application. Events consumed or confined to another document cannot reach the shell listener; Browser behavior stays under its existing owner.

## Acceptance Criteria

- Header controls follow the active non-popover page, show the next Back/Forward title and shortcut, expose the specified names, and update on page, editor, or history changes including a changed top with unchanged booleans. Empty directions and both controls on a Browser page are disabled.
- Alt+Left/Right and physical mouse buttons 4/5 navigate the active non-Browser page once per gesture. Browser inputs are neither intercepted nor prevented; focused Monaco on Windows supports the shortcuts when it does not consume the event.
- The Markdown toolbar Back control, model method, and `markdown-back` AI element descriptions are gone; existing Markdown facade `navigateBack()` and its description remain usable. Markdown links still use the existing page navigation path.
- Reconstruction failures and other failed Back/Forward operations are reported to the user once; UI-triggered rejections are handled without duplicate toast or unhandled rejection. Four English shell messages are added; language packs, guides, Browser code, the page-history scripting node and board bridge are unchanged.
- The three specified npm commands pass; no unit tests are added.

### Claude live checks

1. Navigate A to B to C, inspect both tooltips, use header Back and Forward, then navigate a new branch; check titles and disabled states even when a stack remains nonempty.
2. Switch active tabs, grouped pages, and a right-pinned popover; verify the controls and gestures target the normal active page and subscriptions follow changes.
3. With Monaco focused, use Alt+Left/Right and mouse buttons 4/5; check one move per gesture and no interference with other modifiers.
4. On a Browser page check disabled header controls and the Browser's own keyboard and mouse navigation; repeat after returning to a non-Browser page.
5. Follow a Markdown link, confirm the old button is absent, and call the existing Markdown facade `navigateBack()`; check normal page history.
6. Exercise pipe reconstruction failure, missing-source preflight, and a source disappearing after preflight; inspect toast count, current page and console for handled errors.

## Files Changed

| File | Planned change |
| --- | --- |
| `src/renderer/api/pages/PageHistory.ts` | Report pipe reconstruction failure once before rethrowing. |
| `src/renderer/api/internal/PageHistoryControls.ts` | New shared active-page eligibility and safe UI action owner. |
| `src/renderer/api/internal/KeyboardService.ts` | Register and route keyboard and mouse gestures. |
| `src/renderer/ui/app/PageHistoryButtonsView.ts` | New reactive header controls and subscriptions. |
| `src/renderer/ui/app/PageHistoryButtons.css` | Added after user review: the buttons sit in a real container boxed like a tab and bottom-aligned with the tab strip (not centred on the header), the two buttons touch, and a 4px left margin separates them from the menu button. |
| `src/renderer/ui/app/AppHeaderView.ts` | Compose history controls immediately after menu. |
| `src/renderer/editors/markdown/MarkdownEditorView.ts`, `src/renderer/editors/markdown/MarkdownEditor.ts` | Remove old toolbar control and model method. |
| `src/renderer/scripting/api-wrapper/MarkdownEditorFacade.ts` | Preserve existing script method by direct history delegation; remove obsolete element descriptions. |
| `src/shared/i18n/en/shell.ts` | Four English tooltip messages. |

No changes: `src/renderer/api/pages/PageModel.ts`, `src/renderer/api/pages/PageNavigator.ts`, `src/renderer/api/types/markdown-editor.d.ts`, `src/renderer/editors/browser/`, `assets/guides/`, `assets/languages/`, the scripting `page.history` node, the board bridge, `doc/active-work.md`, and `doc/epics/EPIC-178.md`.
