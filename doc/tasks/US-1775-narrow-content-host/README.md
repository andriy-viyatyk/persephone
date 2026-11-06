# US-1775: Narrow the content-host contract

## Goal

Type the live editor host-transfer contract as `TextFileModel` and remove obsolete host discrimination and casts. Epic: [EPIC-137](../../epics/EPIC-137.md); research: [US-1770](../US-1770-editor-architecture-simplification/README.md).

## Background

`TextFileModel` is the only `IContentHost` implementation. The former Notebook duck-typed another host. Host transfer, restore, editor settings, board content and Browser bookmarks still depend on the real host. `BoardWebview` reads the host and sends content over the bridge; the bridge itself is not an implementation of this TypeScript interface.

## Implementation Plan

- [x] Complete [US-1773](../US-1773-remove-editor-overlay/README.md) first. Choose research option A: retain `IContentHost` and `IContentHostState` as documented surfaces implemented by `TextFileModel`, but type consumers and transfer as the concrete model. This removes the costs of the unused alternative without the extra state/interface deletion churn of option B; it does not preserve an embedding path.
- [x] In `src/renderer/editors/base/editor-traits.ts` and `src/renderer/editors/base/EditorModel.ts`, use type-only `TextFileModel` imports and return `TextFileModel` from `extractContentHost()` and `TextFileModel | null` from `contentHost`. In `src/renderer/editors/base/IContentHost.ts`, make `handleKeyDown` and `onGetMenuItems` required and update their comments; preserve the settings methods.
- [x] In `src/renderer/editors/base/TextHostEditorModel.ts`, return the concrete host from trait and getter, remove round-trip casts, remove `isLegacyTextFileHost` and its error branch, and pass the host directly to registry. Keep ownership, subscriptions, restore guard and `adoptHost` behavior.

```ts
// Before
const host = trait.extractContentHost() as unknown as TextFileModel;
if (!isLegacyTextFileHost(host)) { /* throw */ }
// After
const host = trait.extractContentHost();
```

- [x] In `src/renderer/editors/base/TextChromeView.ts`, replace `host`/`textHost` with one nullable `TextFileModel` host; remove the US-1773 guard, use the single host for chrome, and preserve null handling during detach and lifecycle cleanup.
- [x] In `src/renderer/editors/base/editorRegistry.ts`, narrow `AcceptanceInput.host`, `findEditorsAccepting`, and `detectContentEditor` to `TextFileModel`. Check `src/renderer/editors/base/editor-matchers.ts` for inferred type changes. Remove redundant `IContentHost` unions/imports from `src/renderer/editors/types.ts` and `src/renderer/ui/app/AsyncEditorView.ts` (`EditorOrHost` already includes the concrete host).
- [x] Update the trait/getter and transfer casts in `src/renderer/editors/board/BoardContentEditorModel.ts` and `src/renderer/editors/board-info/BoardInfoEditorModel.ts`, the cast in `src/renderer/editors/board/BoardEditorView.ts`, and detection in `src/renderer/editors/text/TextEditorModel.ts`. Review and simplify affected casts in `src/renderer/editors/board/BoardEditorModel.ts`, `src/renderer/editors/base/editor-switch.ts`, `src/renderer/editors/base/editor-switch-options.ts`, `src/renderer/api/pages/PagesLifecycleModel.ts`, `src/renderer/api/pages/PageNavigator.ts`, and `src/renderer/api/pages/PagesQueryModel.ts`; preserve unrelated validation of arbitrary models.
- [x] Update `src/shared/persistence.ts` host-descriptor comment to describe the current model, without changing persisted shape. Update `doc/architecture/editors.md`, `doc/architecture/state-management.md`, `doc/architecture/overview.md`, `doc/architecture/folder-structure.md`, `doc/architecture/key-files.md`, `doc/architecture/diagrams/4-class-hierarchy.mmd`, `doc/architecture/diagrams/3-editor-resolution.mmd`, and `doc/standards/editor-guide.md` where they imply arbitrary host implementations or show the old trait return type.
- [ ] Typecheck/build and lint; exercise file opening, switch between Monaco/Grid/Markdown, save and restart, navigation highlighting, Browser bookmarks, content-host board, Board Info, and host errors/ownership on close and failed restore.

## Concerns

US-1773 must precede this task; US-1772 and US-1774 have overlapping files but no semantic dependency, so apply sequentially. US-1776 is independent. Type-only imports avoid adding base-to-text runtime cycles. Do not remove `CONTENT_HOST_TRAIT`, host settings, `restored`, or public `adoptHost`.

Files needing no change: `src/renderer/editors/board/BoardWebview.ts` (live host/bridge use remains), `src/renderer/scripting/api-wrapper/BoardEditorFacade.ts` and `assets/editor-types/board-editor.d.ts` (`contentHostError` is unrelated), `src/renderer/scripting/api-wrapper/PageWrapper.ts` (its runtime host lookup remains), `src/renderer/editors/browser/BrowserBookmarks.ts`, and MCP handlers. Review their behavior during verification; no interface type is exposed there.

## Acceptance Criteria

- [x] Trait, editor getter, registry and view contracts use `TextFileModel`; obsolete casts and both host guards are gone.
- [ ] Transfer, restore, settings persistence, board bridge and Browser bookmarks still work, with no persistence format change.
- [x] Documentation and checks reflect the concrete host and retained interface.

## Files Changed

| File | Change |
|---|---|
| `src/renderer/editors/base/IContentHost.ts`, `src/renderer/editors/base/editor-traits.ts`, `src/renderer/editors/base/EditorModel.ts`, `src/renderer/editors/base/TextHostEditorModel.ts`, `src/renderer/editors/base/TextChromeView.ts`, `src/renderer/editors/base/editorRegistry.ts`, `src/renderer/editors/base/editor-matchers.ts`, `src/renderer/editors/base/editor-switch.ts`, `src/renderer/editors/base/editor-switch-options.ts` | Narrow contract and simplify affected guards/casts |
| `src/renderer/editors/types.ts`, `src/renderer/ui/app/AsyncEditorView.ts` | Remove redundant union |
| `src/renderer/editors/board/BoardContentEditorModel.ts`, `src/renderer/editors/board/BoardEditorModel.ts`, `src/renderer/editors/board/BoardEditorView.ts`, `src/renderer/editors/board-info/BoardInfoEditorModel.ts`, `src/renderer/editors/text/TextEditorModel.ts` | Use typed host |
| `src/renderer/api/pages/PagesLifecycleModel.ts`, `src/renderer/api/pages/PageNavigator.ts`, `src/renderer/api/pages/PagesQueryModel.ts` | Simplify affected casts |
| `src/shared/persistence.ts` | Correct host comment |
| `doc/architecture/editors.md`, `doc/architecture/state-management.md`, `doc/architecture/overview.md`, `doc/architecture/folder-structure.md`, `doc/architecture/key-files.md`, `doc/architecture/diagrams/4-class-hierarchy.mmd`, `doc/architecture/diagrams/3-editor-resolution.mmd`, `doc/standards/editor-guide.md` | Align host descriptions |

## Implementation notes

No implementation deviations. Typecheck, lint and production build passed (the build reported chunking warnings); manual checks for opening, switching, saving and restart, navigation highlighting, Browser bookmarks, content-host boards, Board Info, host errors, ownership and failed restore require a running app and remain pending.
