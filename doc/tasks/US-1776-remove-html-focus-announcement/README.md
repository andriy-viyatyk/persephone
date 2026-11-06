# US-1776: Remove HTML preview focus announcement

## Goal

Remove the Notebook-specific synthetic focus announcement while keeping preview interaction dismissal. Epic: [EPIC-137](../../epics/EPIC-137.md); research: [US-1770](../US-1770-editor-architecture-simplification/README.md).

## Background

`src/renderer/editors/html/HtmlBodyView.ts` receives a `html:interact` message from the sandboxed preview's injected `pointerdown` listener. It dismisses overlays, then focuses the iframe and synthesizes bubbling `focusin` for the removed Notebook's ancestor focus tracking. `src/renderer/ui/app/PagesView.ts` also watches window blur and checks the active iframe to close popovers. Grouped-page activation needs a manual check.

## Implementation Plan

- [x] In `src/renderer/editors/html/HtmlBodyView.ts`, remove the `alreadyFocused` check, iframe `focus()`, synthetic event and explanatory comment, keeping source validation and dismissal:

```ts
// Before
if (data?.__persephone === "html:interact") {
    dismissOverlays(this.iframe);
    const alreadyFocused = document.activeElement === this.iframe;
    this.iframe.focus();
    if (alreadyFocused) this.iframe.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
}
// After
if (data?.__persephone === "html:interact") dismissOverlays(this.iframe);
```

- [x] Retain the injected pointerdown ping, message listener lifecycle, `event.source` check, and `dismissOverlays` import. Typecheck/build and lint.
- [ ] Manually click an HTML preview with a popover page open, with a menu/dropdown open, and as the inactive side of a grouped page; verify dismissal and activation. Also check repeated clicks and ordinary preview focus.

## Concerns

No dependency on US-1772, US-1773 or US-1775. US-1774 edits the same file; apply sequentially in either order. Grouped activation was not proven by static tracing, so manual verification is required before declaring this behavior preserved.

Files needing no change: `src/renderer/uikit/shared/overlayLayer.ts`, `src/renderer/ui/app/PagesView.ts`, `src/renderer/editors/browser/BrowserView.ts`, and `src/renderer/editors/board/BoardWebview.ts`; their dismissal paths remain live. No corresponding removed API was found in scripting, MCP, `assets/editor-types/`, `doc/architecture/` or `doc/standards/`.

## Acceptance Criteria

- [ ] HTML interaction still dismisses overlays; no preview focus call or synthetic `focusin` remains in the handler.
- [ ] Popovers, menus, grouped-page activation and ordinary preview interaction pass manual checks; build checks pass.

## Files Changed

| File | Change |
|---|---|
| `src/renderer/editors/html/HtmlBodyView.ts` | Remove focus announcement; retain interaction dismissal |

## Implementation notes

No deviations. Typecheck, lint and production build passed; the removed handler focus code is absent. Popover and menu dismissal, grouped-page activation, repeated clicks and ordinary preview focus require a running app; acceptance checks remain pending.
