# US-1773: Remove the editor overlay portal

## Goal

Remove the unused full-editor portal and its host API. Epic: [EPIC-137](../../epics/EPIC-137.md); research: [US-1770](../US-1770-editor-architecture-simplification/README.md).

## Background

`TextChromeView` mounts an empty `.editor-overlay` and registers it with `TextFileModel`; no code reads the reference. The former Notebook was its consumer. The setter also serves as the current `isTextFileHost` discriminator, so replacing that guard is necessary before the subsequent host narrowing.

## Implementation Plan

- [ ] In `src/renderer/editors/base/TextChromeView.ts`, remove the `overlay` field, creation, class assignment, append, setter calls on mount and teardown, and field resets. Change the `TextFileModel` import from type-only to value and replace the guard:

```ts
// Before
return typeof (host as unknown as { setEditorOverlayRef?: unknown }).setEditorOverlayRef === "function";
// After
return host instanceof TextFileModel;
```

  Update its comment. Check the runtime import cycle and exercise startup and editor switching; `TextHostEditorModel.ts` already imports this class as a value.
- [x] Remove `editorOverlayRef` and `setEditorOverlayRef` from `src/renderer/editors/text/TextEditorModel.ts` and both `.editor-overlay` rules and their comment from `src/renderer/theme/global-styles.ts`.
- [ ] Search for the removed symbols; typecheck/build and lint. Open, switch, close and restore text editors and verify chrome, script panel and footer.

## Concerns

Do this before [US-1775](../US-1775-narrow-content-host/README.md), which removes the temporary guard and host split. US-1772, US-1774 and US-1776 are independent. No matching references were found in scripting, MCP, board bridge, editor typings, `doc/architecture/` or `doc/standards/`; these need no changes. In particular retain unrelated overlay dismissal and popover code in `src/renderer/uikit/shared/overlayLayer.ts` and `src/renderer/ui/app/PagesView.ts`.

## Acceptance Criteria

- [ ] Text pages create no `.editor-overlay` node and no removed API or CSS reference remains.
- [ ] Text chrome and switching work with the replacement guard; checks pass.

## Files Changed

| File | Change |
|---|---|
| `src/renderer/editors/base/TextChromeView.ts` | Remove portal and replace guard |
| `src/renderer/editors/text/TextEditorModel.ts` | Remove reference and setter |
| `src/renderer/theme/global-styles.ts` | Remove portal CSS |

## Implementation notes

No deviations. Typecheck, lint, production build and removed-symbol search passed. Startup, editor switching, close and restore, chrome, script panel and footer checks require a running app; acceptance checks remain pending.
