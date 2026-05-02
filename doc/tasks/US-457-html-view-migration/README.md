# US-457: HtmlView — UIKit migration

## Goal

Migrate [HtmlView.tsx](../../../src/renderer/editors/html/HtmlView.tsx) from an app-side `styled.div` wrapper (`HtmlViewRoot`) to UIKit's `Panel`. After the migration the file imports zero `@emotion/styled`, no `color` import, and no `style={…}` on a UIKit component — only the `<iframe>` (a primitive HTML element, not a UIKit component) carries inline `style` for sizing/border, which Rule 7 explicitly permits.

This is the fourth per-screen migration of [EPIC-025](../../epics/EPIC-025.md) Phase 4. Like [US-456 (SvgView)](../US-456-svg-view-migration/README.md), it introduces **zero new UIKit components and zero new prop extensions** — every primitive needed already exists in the UIKit barrel.

## Background

### EPIC-025 Phase 4 context

Per-screen migration loop:

1. Pick a screen
2. Audit which UIKit components are needed and which are missing
3. Build missing components / prop extensions in Storybook first
4. Rewrite the screen with UIKit
5. Smoke-test the screen

Prior per-screen migrations: [US-452 (About)](../US-452-about-screen-migration/README.md), [US-455 (MermaidView)](../US-455-mermaid-view-migration/README.md), [US-456 (SvgView)](../US-456-svg-view-migration/README.md).

### Why HtmlView next

- **Smallest unfinished screen** — 69 lines, 1 styled component, 0 buttons, 0 toolbar portal.
- **No editor toolbar** — unlike MermaidView/SvgView, HtmlView does **not** portal anything into `model.editorToolbarRefLast`. The whole screen is `<wrapper><iframe/></wrapper>`. No `IconButton`, no `Spinner`, no `Text` is needed.
- **Zero UIKit additions** — `Panel flex overflow="hidden"` already replaces the legacy styled wrapper exactly.
- **Only nuance: an `<iframe>` primitive** — UIKit doesn't (and shouldn't) wrap raw browser primitives like `<iframe>`. Rule 7 forbids `style={…}` only when *passing it to a UIKit component*; an iframe is a native HTML element, so inline `style` for sizing is allowed.

### Audit results

| HtmlView element (current) | UIKit replacement | Gap |
|---|---|---|
| `HtmlViewRoot` — `styled.div` `width: 100%`, `height: 100%`, `overflow: hidden` | `<Panel flex overflow="hidden">` | none |
| `<iframe className="html-preview-iframe" srcDoc={…} sandbox="allow-scripts" title="HTML Preview" />` styled via `& .html-preview-iframe { width: 100%; height: 100%; border: none; backgroundColor: "#fff" }` | `<iframe srcDoc={…} sandbox="allow-scripts" title="HTML Preview" style={{ flex: 1, border: "none" }} />` | none — iframe is a primitive HTML element, inline `style` is permitted; **`backgroundColor: "#fff"` is dropped** (see Concerns §1) |
| `useMemo(() => content + navigationBlockerScript)` | unchanged | none |
| `useSyncExternalStore(…)` hook order discipline | unchanged | none |

The wrapper class name `html-preview-iframe` was only a CSS hook used by `HtmlViewRoot`'s `& .html-preview-iframe` selector. After migration there is no parent stylesheet selector, so the class name is removed entirely.

### Files involved

| File | Role | Change |
|------|------|--------|
| [src/renderer/editors/html/HtmlView.tsx](../../../src/renderer/editors/html/HtmlView.tsx) | HTML preview view | Replace `styled.div` wrapper with `<Panel>`; drop `@emotion/styled` import; add `Panel` import from `../../uikit`; rewrite iframe attributes |

That's the entire change set — one file, one import swap, one wrapper rewrite, iframe attribute cleanup.

## Implementation Plan

Single phase. No UIKit additions. The whole task is rewriting one file.

### Step 1 — Rewrite [HtmlView.tsx](../../../src/renderer/editors/html/HtmlView.tsx)

Full new content of the file:

```tsx
import { useMemo, useSyncExternalStore } from "react";
import { TextFileModel } from "../text/TextEditorModel";
import { useContentViewModel } from "../base/useContentViewModel";
import { Panel } from "../../uikit";
import { HtmlViewModel, defaultHtmlViewState } from "./HtmlViewModel";

const navigationBlockerScript = `<script>document.addEventListener("click",function(e){var a=e.target.closest("a");if(a&&a.href){e.preventDefault();}},true);</script>`;

// ============================================================================
// HtmlView Component - content-view for HTML files
// ============================================================================

interface HtmlViewProps {
    model: TextFileModel;
}

const noopUnsubscribe = () => () => {};
const getDefaultState = () => defaultHtmlViewState;

/**
 * HTML Preview component that renders HTML content in a sandboxed iframe.
 * Uses srcdoc to pass content directly — no size limits, reactive to state changes.
 * Sandbox ensures isolation: no same-origin access, no popups, no storage.
 */
function HtmlView({ model }: HtmlViewProps) {
    const vm = useContentViewModel<HtmlViewModel>(model, "html-view");
    const content = model.state.use((s) => s.content);

    useSyncExternalStore(
        vm ? (cb) => vm.state.subscribe(cb) : noopUnsubscribe,
        vm ? () => vm.state.get() : getDefaultState,
    );

    const safeSrcDoc = useMemo(
        () => content + navigationBlockerScript,
        [content],
    );

    if (!vm) return null;

    return (
        <Panel flex overflow="hidden">
            <iframe
                srcDoc={safeSrcDoc}
                sandbox="allow-scripts"
                title="HTML Preview"
                style={{ flex: 1, border: "none" }}
            />
        </Panel>
    );
}

export { HtmlView };
export type { HtmlViewProps };
```

Key changes vs. original:

- **Removed** — `import styled from "@emotion/styled"`
- **Removed** — `HtmlViewRoot` styled component definition (12 lines)
- **Added** — `import { Panel } from "../../uikit"`
- **Replaced** — `<HtmlViewRoot>` → `<Panel flex overflow="hidden">`
- **Replaced** — iframe `className="html-preview-iframe"` removed; sizing/border moved to inline `style={{ flex: 1, border: "none" }}` on the iframe primitive
- **Removed** — `backgroundColor: "#fff"` on the iframe (see Concerns §1)
- All other lines (model state subscription, `safeSrcDoc` memo, hook order, sandbox/title attrs) are unchanged.

### Step 2 — TypeScript verification

Run `npx tsc --noEmit`. The HTML editor must produce no new errors. Pre-existing errors elsewhere in the repo (automation, video, link-editor, worker, PageTab) are unrelated.

### Step 3 — Manual smoke test

Open an `.html` file and verify:

1. **Initial render** — HTML content renders inside the iframe; the iframe fills the editor pane.
2. **Edit-and-preview** — edit the source `.html` content in the linked text editor; the preview updates immediately (the `srcDoc` is rebuilt via `useMemo`).
3. **Sandbox isolation** — scripts inside the HTML cannot access `window.parent`, can't open popups, can't write storage (sandbox attribute unchanged).
4. **Navigation blocker** — clicking an `<a href="…">` link inside the iframe does **not** navigate (the injected `navigationBlockerScript` calls `preventDefault`).
5. **Empty content** — when the file is empty, the iframe renders blank (no JS error, no console warnings from React).
6. **Theme switching** — switch app theme (default-dark, light-modern, monokai); the iframe's content background remains white (browser default for `<body>` in a fresh document); the surrounding Panel inherits the editor pane's theme.
7. **Resize** — drag the editor pane / window; iframe resizes to fill (Panel `flex` + iframe `flex: 1`).

## Concerns / Open Questions

### Resolved

1. **Why drop `backgroundColor: "#fff"` on the iframe?** The original CSS rule set the iframe element's background to white as a flash-of-color guard before the `srcdoc` document loads. In practice, the iframe content document's `<body>` defaults to white via the browser's user-agent stylesheet, so the explicit fallback is invisible after the first paint. CLAUDE.md ("No hardcoded colors") forbids hex literals in inline styles and styled components alike. Dropping the fallback removes the rule violation with no observable behavior change. If a brief transparent flash ever becomes visible (e.g., for empty HTML files on slow machines), the right fix is to add a theme token like `color.background.htmlPreview` (always white across themes) — out of scope for this task.

2. **Why `style={{ flex: 1, border: "none" }}` on the iframe and not a wrapping styled component?** UIKit Rule 7 forbids `import styled from "@emotion/styled"` in app code, and forbids passing `style={…}` *to a UIKit component*. The `<iframe>` is a raw HTML primitive — not a UIKit component — so inline `style` is the project-sanctioned escape for sizing primitives that UIKit doesn't (and shouldn't) wrap. The two style values are sizing/border only, no colors.

3. **Why no `Panel` for the iframe?** UIKit's Panel is a styled `<div>`; an iframe must remain an iframe (different element semantics, sandbox attribute, srcDoc). Wrapping the iframe in a Panel would be an extra DOM node with no behavior payoff.

4. **Why no `direction="column"` or `height={0}` on the Panel?** The Panel only contains a single iframe child. With `flex` (`flex: 1 1 auto`) the Panel fills its parent's remaining flex space, and the iframe with `flex: 1` fills the Panel's main axis (default direction `row`). `align-items: stretch` (flex default) makes the iframe full-height. This matches the original `width: 100%; height: 100%` outcome without needing `direction="column"` or `height={0}`. (`height={0}` was needed in MermaidView only because it nests scrollable children and an absolute-positioned overlay.)

5. **`HtmlViewModel` is intentionally minimal.** Its `defaultHtmlViewState` is `{}`, and `useSyncExternalStore` is called only to keep the hook order stable (`if (!vm) return null` after the call). The migration does not touch this — same hook-order discipline applies regardless of which wrapper component is used.

6. **No `disabled`, error, or loading state.** HtmlView has no async work — `srcDoc` is a pure derivation of `model.state.content`. Nothing to spinner, nothing to error-out.

7. **No editor toolbar contribution.** Unlike MermaidView and SvgView, HtmlView does not render anything via `createPortal(…, model.editorToolbarRefLast)`. There is nothing for the user to interact with via toolbar — preview is fully passive. No `IconButton` is needed.

### None open.

## Acceptance Criteria

- [ ] [HtmlView.tsx](../../../src/renderer/editors/html/HtmlView.tsx) imports `Panel` from `../../uikit`; the import for `@emotion/styled` is removed.
- [ ] The `HtmlViewRoot` `styled.div` definition is deleted from the file.
- [ ] The wrapper element is `<Panel flex overflow="hidden">` (not a `styled.div`).
- [ ] The iframe carries `style={{ flex: 1, border: "none" }}` — no `className`, no other inline styles, no `backgroundColor`.
- [ ] No `styled.*`, no `@emotion/styled` import, no `color` import anywhere in the file.
- [ ] `HtmlViewModel`, `defaultHtmlViewState`, `HtmlViewProps`, and the `HtmlView` external API are unchanged.
- [ ] HTML preview renders correctly across themes; iframe fills the editor pane; resize works; navigation blocker still prevents link clicks; sandbox attribute unchanged.
- [ ] No new TypeScript errors.

## Files Changed

| File | Change |
|------|--------|
| [src/renderer/editors/html/HtmlView.tsx](../../../src/renderer/editors/html/HtmlView.tsx) | Replace `styled.div` wrapper with `<Panel>` — drop `@emotion/styled` import, add `Panel` import, rewrite iframe attributes (remove className, drop `backgroundColor`, move sizing to inline `style`) |

## Files NOT Changed

- [src/renderer/editors/html/HtmlViewModel.ts](../../../src/renderer/editors/html/HtmlViewModel.ts) — ViewModel unchanged
- [src/renderer/editors/html/index.ts](../../../src/renderer/editors/html/index.ts) — re-exports unchanged
- [src/renderer/editors/register-editors.ts](../../../src/renderer/editors/register-editors.ts) — module registration unchanged
- All UIKit files — no additions, no changes
- All theme files — no token changes
