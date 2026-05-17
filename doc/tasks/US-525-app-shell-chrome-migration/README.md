# US-525: App shell + PageNavigator — chrome migration

## Status

**Implemented — awaiting user testing + epic-close review** — Phase 4 per-screen migration under [EPIC-025](../../epics/EPIC-025.md). All four in-scope files migrated; `tsc` + `lint` baselines unchanged.

## Goal

Migrate the last legacy holdouts in the application shell to UIKit primitives:

- `src/renderer/ui/app/MainPage.tsx`
- `src/renderer/ui/app/Pages.tsx`
- `src/renderer/ui/app/AsyncEditor.tsx`
- `src/renderer/ui/navigation/PageNavigator.tsx`

After this task, no file under `src/renderer/ui/app/` or
`src/renderer/ui/navigation/` imports from
`components/basic|form|layout|overlay/`. This closes the last gap in
the application chrome (sidebar, tabs, dialogs, and overlays are
already on UIKit per US-479…US-497, US-432, US-481).

## Background

### Files in scope (verified via grep for legacy imports)

| File | Legacy imports to remove |
|------|--------------------------|
| `src/renderer/ui/app/MainPage.tsx` | `FlexSpace` (`components/layout/Elements`), `Button` (`components/basic/Button`) |
| `src/renderer/ui/app/Pages.tsx` | `Splitter` (`components/layout/Splitter`) |
| `src/renderer/ui/app/AsyncEditor.tsx` | `CircularProgress` (`components/basic/CircularProgress`), `EditorErrorBoundary` (`components/basic/EditorErrorBoundary`) |
| `src/renderer/ui/navigation/PageNavigator.tsx` | `CollapsiblePanelStack`, `CollapsiblePanel` (`components/layout/CollapsiblePanelStack`) |

### Files NOT in scope (verified)

- `src/renderer/ui/navigation/LazySecondaryEditor.tsx` — already uses only theme color, no legacy primitives imported.
- `src/renderer/ui/navigation/secondary-editor-registry.ts` — registry, no JSX.
- `src/renderer/ui/app/RenderEditor.tsx` — confirmed no legacy primitive imports.
- `src/renderer/ui/navigation/PageNavigatorModel.ts` — pure model, no JSX.

### Reference migrations

- **US-517 CollapsiblePanelStack** — landed UIKit primitive; this task fulfils the "opportunistic PageNavigator retrofit" called out in US-517.
- **US-509 Grid editor chrome** — reference for "small chrome, multiple primitives" migration pattern.
- **US-477 Spinner** — landed UIKit `Spinner` primitive (drop-in for `CircularProgress`).
- **US-486 UIKit Splitter** — controlled-value primitive with `value`/`onChange` API.

### UIKit primitive availability — verification

All needed primitives are landed; no new primitive needs to be authored. Specific surface used:

| Primitive | Surface used by this task |
|-----------|---------------------------|
| `Spinner` | `name`, `size`, `color` — drop-in for `CircularProgress` |
| `Splitter` | `value`, `onChange`, `side="before"`, `min`, `border="after"`, `background="default"`, `hoverBackground="light"`, `orientation="vertical"` |
| `CollapsiblePanelStack` | `activePanel`, `setActivePanel`, `height`, `name`; preserves `headerRef` callback on each `CollapsiblePanel` |
| `CollapsiblePanel` | `id`, `headerRef`, `alwaysRenderContent`, `name` |
| `IconButton` | `name`, `icon`, `size="sm"`, `title`, `onClick`, `active` |
| `Panel` | `direction`, `flex`, `shrink={false}`, `width`, `height`, `minWidth`, `overflow`, `align`, `justify`, `name` |

### Risk surface

- **`MainPage.tsx` and `Pages.tsx`** are the outermost layout host — regressions here affect every page. The system-buttons (minimize/maximize/close) live in a `WebkitAppRegion: "drag"` chrome container with strict positioning. The page-tab strip and MCP indicator span the title bar.
- **`Pages.tsx`** Splitter controls grouped-pages side-by-side layout. The sidebar Splitter persists width via `PageNavigatorModel.setWidth` which clamps to min 120 px.
- **`PageNavigator.tsx`** hosts the secondary-editor sidebar. Every secondary editor (Explorer, Search, Archive, LinkCategory, LinkHostnames, LinkTags) uses `createPortal(headerContent, headerRef)` — the `headerRef` ref-callback contract must remain byte-identical.

### Chrome exception (Rule 7) — what stays as `styled.div` / `<button>`

These files live under `src/renderer/ui/` and qualify for the Rule-7 chrome exception. The exception allows `@emotion/styled` and plain HTML elements with `className`/`style` **on their own local elements** (not on UIKit components). Specifically:

- `MainPage.tsx` — the styled `AppRoot` shell, the `.app-header` drag region, the `.app-content` wrapper, the `.mcp-indicator` span, and the Windows-style **system buttons** (minimize/maximize/close — 28×40 px, border-radius 0, close-button red hover) stay as plain chrome. These are one-off Windows-title-bar quirks that would distort UIKit `IconButton` if added as variants.
- `Pages.tsx` — `PageEditorContainer`, `EmptyPageRoot`, `OrnamentWrapper` styled divs stay (chrome-specific positioning around the editor stage).
- `AsyncEditor.tsx` — no chrome divs needed after migration; the loading wrapper becomes a `Panel`.
- `PageNavigator.tsx` — the `PageNavigatorRoot` styled div is replaced by a `Panel`.

### What `EditorErrorBoundary` does — and where it should live

`components/basic/EditorErrorBoundary.tsx` is the in-editor crash boundary used **only** by `AsyncEditor`. It is genuine app-shell chrome (Windows-style "Editor crashed" panel) — not a reusable primitive. Verified single consumer:

```
grep EditorErrorBoundary src/  → only AsyncEditor.tsx and the file itself
```

**Decision (concern resolved below):** move it to `src/renderer/ui/app/EditorErrorBoundary.tsx` and delete the `components/basic/` copy. Its `styled.div` body stays as-is under the chrome exception.

### What `FlexSpace style={{ minWidth: 40 }}` does

Current code:

```tsx
<FlexSpace style={{ minWidth: 40 }} />
```

`FlexSpace` is `flex: 1 1 auto`. The `minWidth: 40` injects a minimum width so the page-tab strip can't shrink past 40 px of right-margin (preserves room for system buttons + indicators). UIKit `Spacer` is the closest equivalent but **does not accept a minimum**. Two options were considered:

1. Extend UIKit `Spacer` with `minSize?: number | string`.
2. Use `Panel` with `flex={1} minWidth={40}` — Panel already exposes both.

**Decision (concern resolved below):** option 2. Panel already provides the surface; extending Spacer for a one-off chrome need bloats the primitive. Spacer stays a pure flex-filler.

## Implementation plan

### Step 1 — Move `EditorErrorBoundary` to app shell

Move and rename, then delete the legacy file.

**Create** `src/renderer/ui/app/EditorErrorBoundary.tsx` by copying the existing `src/renderer/components/basic/EditorErrorBoundary.tsx` verbatim. Body stays the same (`styled.div` chrome). No API changes.

**Delete** `src/renderer/components/basic/EditorErrorBoundary.tsx`.

**Update** the import in `src/renderer/ui/app/AsyncEditor.tsx`:

```tsx
// Before
import { EditorErrorBoundary } from "../../components/basic/EditorErrorBoundary";

// After
import { EditorErrorBoundary } from "./EditorErrorBoundary";
```

### Step 2 — Migrate `AsyncEditor.tsx`

Replace `CircularProgress` with UIKit `Spinner`, and wrap with UIKit `Panel` instead of the chrome `ProgressRoot` styled div.

**Before:**

```tsx
import styled from "@emotion/styled";
import { CircularProgress } from "../../components/basic/CircularProgress";
import { EditorErrorBoundary } from "../../components/basic/EditorErrorBoundary";

const ProgressRoot = styled.div({
    flex: "1 1 auto",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
});
…
return (
    <ProgressRoot>
        <CircularProgress size={16}/>
    </ProgressRoot>
);
```

**After:**

```tsx
import { Spinner, Panel } from "../../uikit";
import { EditorErrorBoundary } from "./EditorErrorBoundary";

…
return (
    <Panel name="async-editor-loading" flex={1} align="center" justify="center">
        <Spinner name="async-editor" size={16} />
    </Panel>
);
```

Remove the `@emotion/styled` import and the `ProgressRoot` styled component.

### Step 3 — Migrate `PageNavigator.tsx`

Replace `CollapsiblePanelStack`/`CollapsiblePanel` from `components/layout/` with the UIKit equivalents. Replace the `PageNavigatorRoot` styled div with a UIKit `Panel`. The `headerRef` callback contract is byte-identical between legacy and UIKit, so portal-using secondary editors keep working without changes.

**Before:**

```tsx
import styled from "@emotion/styled";
import { CollapsiblePanelStack, CollapsiblePanel } from "../../components/layout/CollapsiblePanelStack";
import color from "../../theme/color";
…
const PageNavigatorRoot = styled.div({
    display: "flex",
    flexDirection: "column",
    height: "100%",
    overflow: "hidden",
    backgroundColor: color.background.default,
});
…
return (
    <PageNavigatorRoot>
        <CollapsiblePanelStack
            activePanel={activePanel}
            setActivePanel={handleSetActivePanel}
            style={{ flex: "1 1 auto" }}
        >
            {secondaryEditors.flatMap((model) => {
                …
                return (
                    <CollapsiblePanel
                        key={refKey}
                        id={panelId}
                        headerRef={(el) => setHeaderRef(refKey, el)}
                        alwaysRenderContent
                    >
                        <LazySecondaryEditor … />
                    </CollapsiblePanel>
                );
            })}
        </CollapsiblePanelStack>
    </PageNavigatorRoot>
);
```

**After:**

```tsx
import { Panel, CollapsiblePanelStack, CollapsiblePanel } from "../../uikit";
…
return (
    <Panel
        name="page-navigator-root"
        direction="column"
        height="100%"
        overflow="hidden"
        background="default"
    >
        <CollapsiblePanelStack
            name="page-navigator-stack"
            activePanel={activePanel}
            setActivePanel={handleSetActivePanel}
            height="100%"
        >
            {secondaryEditors.flatMap((model) => {
                …
                return (
                    <CollapsiblePanel
                        key={refKey}
                        id={panelId}
                        name={panelId}
                        headerRef={(el) => setHeaderRef(refKey, el)}
                        alwaysRenderContent
                    >
                        <LazySecondaryEditor … />
                    </CollapsiblePanel>
                );
            })}
        </CollapsiblePanelStack>
    </Panel>
);
```

Remove the `@emotion/styled` and `color` imports. Drop `PageNavigatorRoot`.

`height="100%"` on the stack replaces the legacy `style={{ flex: "1 1 auto" }}` — the stack root is a flex child of a column-flex `Panel`, so `height: 100%` fills the column space (verified via Pages.tsx parent setup: `style={{ height: "100%" }}` on the nav-panel-container).

### Step 4 — Migrate `Pages.tsx`

Replace legacy `Splitter` with UIKit `Splitter`. Replace the `nav-panel-container` chrome `<div>` with a UIKit `Panel`. Other styled divs (`PageEditorContainer`, `EmptyPageRoot`, `OrnamentWrapper`) stay as chrome.

**Before:**

```tsx
import { Splitter } from "../../components/layout/Splitter";
…
return (
    <>
        <div className="nav-panel-container" style={{ width, flexShrink: 0, overflow: "hidden", height: "100%" }}>
            <PageNavigator page={page} />
        </div>
        <Splitter
            type="vertical"
            initialWidth={width}
            onChangeWidth={navModel.setWidth}
        />
    </>
);
```

**After:**

```tsx
import { Splitter, Panel } from "../../uikit";
…
return (
    <>
        <Panel
            name="page-navigator-container"
            width={width}
            shrink={false}
            overflow="hidden"
            height="100%"
        >
            <PageNavigator page={page} />
        </Panel>
        <Splitter
            name="page-navigator-splitter"
            orientation="vertical"
            value={width}
            onChange={navModel.setWidth}
            side="before"
            min={120}
            border="after"
            background="default"
            hoverBackground="light"
        />
    </>
);
```

Mapping rationale:
- `type="vertical"` → `orientation="vertical"` (same meaning: vertical bar, resizes width).
- `initialWidth={width}` → `value={width}` (controlled: rebound on every render; legacy captured `initialWidth` on pointerdown each time, UIKit reads `value` on pointerdown — same behaviour).
- `onChangeWidth={navModel.setWidth}` → `onChange={navModel.setWidth}` — same callback signature `(width: number) => void`. `setWidth` already clamps to `max(120, width)`; passing `min={120}` to the Splitter doubles the floor at the cursor level (snappier UX).
- Legacy default `borderSized="right"` → `side="before"` (panel sits before the splitter; drag right grows the panel).
- Legacy draws `borderRight` on vertical splitter → UIKit `border="after"` = right edge for vertical.
- Legacy `:hover { backgroundColor: color.background.light }` → UIKit `hoverBackground="light"` (matches defaults).

Other Pages.tsx changes: no other UIKit migrations required. Leave `PageEditorContainer`, `EmptyPageRoot`, `OrnamentWrapper` styled divs as chrome (Rule 7 exception).

### Step 5 — Migrate `MainPage.tsx`

The most surgical migration. The chrome shell (AppRoot, `.app-header`, `.app-content`, `.mcp-indicator`, system buttons, zoom-indicator) stays as-is. Only the legacy `Button` and `FlexSpace` imports are removed.

**Imports — before:**

```tsx
import styled from "@emotion/styled";
import { FlexSpace } from "../../components/layout/Elements";
import { Button } from "../../components/basic/Button";
```

**Imports — after:**

```tsx
import styled from "@emotion/styled";
import { IconButton, Panel } from "../../uikit";
```

**Persephone menubar toggle button — before:**

```tsx
<Button
    onClick={() => app.window.toggleMenuBar()}
    type="icon"
    className="app-button"
>
    <PersephoneIcon />
</Button>
```

**After:** wrap an `IconButton` in a chrome span carrying the `app-button` positioning class. (Rule 7 chrome exception: chrome positioning lives on plain elements, UIKit components render the primitive.)

```tsx
<span className="app-button">
    <IconButton
        name="persephone-menu"
        icon={<PersephoneIcon />}
        size="sm"
        title="Menu"
        onClick={() => app.window.toggleMenuBar()}
    />
</span>
```

**FlexSpace — before:**

```tsx
<FlexSpace style={{ minWidth: 40 }} />
```

**After:** use `Panel` with `flex={1} minWidth={40}` (decision in Concerns §1):

```tsx
<Panel name="app-header-spacer" flex={1} minWidth={40} />
```

**Zoom indicator — before:**

```tsx
<Button
    size="small"
    type="icon"
    className={clsx("zoom-indicator", { visible: state.zoomLevel })}
    onClick={() => app.window.resetZoom()}
    title="Reset Zoom"
>
    {Math.round(Math.pow(1.2, state.zoomLevel) * 100)}%
</Button>
```

**After:** chrome plain `<button>` — visual is wholly defined by the existing `.zoom-indicator` CSS, no UIKit primitive matches the chip+text look and it's one-of-a-kind chrome.

```tsx
<button
    type="button"
    data-name="zoom-indicator"
    className={clsx("zoom-indicator", { visible: state.zoomLevel })}
    onClick={() => app.window.resetZoom()}
    title="Reset Zoom"
>
    {Math.round(Math.pow(1.2, state.zoomLevel) * 100)}%
</button>
```

**System buttons (minimize / maximize-restore / close) — before:**

```tsx
<Button onClick={() => app.window.minimize()} className="system-button" background="dark">
    <WindowMinimizeIcon />
</Button>
<Button onClick={() => app.window.toggleWindow()} className="system-button" background="dark">
    {state.isMaximized ? <WindowRestoreIcon /> : <WindowMaximizeIcon />}
</Button>
<Button onClick={() => app.window.close()} className="system-button close-button" background="dark">
    <CloseIcon />
</Button>
```

**After:** chrome plain `<button>` elements — the `.system-button` chrome class encodes 28×40 px sizing, border-radius 0, dark hover background, and the close-button red hover. None of these match UIKit IconButton variants; they are one-off Windows-title-bar quirks.

```tsx
<button
    type="button"
    data-name="window-minimize"
    className="system-button darkBackground"
    onClick={() => app.window.minimize()}
>
    <WindowMinimizeIcon />
</button>
<button
    type="button"
    data-name="window-toggle"
    className="system-button darkBackground"
    onClick={() => app.window.toggleWindow()}
>
    {state.isMaximized ? <WindowRestoreIcon /> : <WindowMaximizeIcon />}
</button>
<button
    type="button"
    data-name="window-close"
    className="system-button darkBackground close-button"
    onClick={() => app.window.close()}
>
    <CloseIcon />
</button>
```

Note: legacy `Button background="dark"` rendered the button with `color.background.dark` hover behaviour. The existing `.system-button.darkBackground:hover` CSS selector in `MainPage.tsx` AppRoot styles already covers this — kept verbatim.

**Autoload reload button — before:**

```tsx
function AutoloadReloadButton() {
    const autoloadState = autoloadService.state.use();
    if (!autoloadState.needsReload) return null;
    return (
        <Button
            size="small"
            type="icon"
            className="autoload-reload"
            title="Application scripts need to be reloaded. Click to reload."
            onClick={() => autoloadService.loadScripts()}
        >
            <RefreshIcon />
        </Button>
    );
}
```

**After:** wrap an `IconButton` in chrome `<span>` carrying the warning-colour CSS:

```tsx
function AutoloadReloadButton() {
    const autoloadState = autoloadService.state.use();
    if (!autoloadState.needsReload) return null;
    return (
        <span className="autoload-reload">
            <IconButton
                name="autoload-reload"
                size="sm"
                icon={<RefreshIcon />}
                title="Application scripts need to be reloaded. Click to reload."
                onClick={() => autoloadService.loadScripts()}
            />
        </span>
    );
}
```

The existing `& button.autoload-reload` selector in AppRoot styles targets a `<button>` descendant — adjust to `& .autoload-reload button` (one CSS tweak in the AppRoot styled definition) so the warning colour applies to the inner IconButton root.

**MCP indicator — before / after:** no change. Stays as `<span className="mcp-indicator">` chrome (Rule 7 exception, used as-is).

### Step 6 — Adopt `name` debug attributes per US-521

Every newly-introduced UIKit primitive carries a meaningful `name`. The plan above already specifies names:

- `Spinner` → `name="async-editor"`
- `Panel` (async loading) → `name="async-editor-loading"`
- `Panel` (page-navigator root) → `name="page-navigator-root"`
- `CollapsiblePanelStack` → `name="page-navigator-stack"`
- `CollapsiblePanel` → `name={panelId}` (one per secondary editor)
- `Panel` (nav container in Pages.tsx) → `name="page-navigator-container"`
- `Splitter` → `name="page-navigator-splitter"`
- `IconButton` (persephone-menu) → `name="persephone-menu"`
- `IconButton` (autoload-reload) → `name="autoload-reload"`
- `Panel` (header spacer) → `name="app-header-spacer"`

For the chrome plain `<button>` elements (system buttons, zoom-indicator), use `data-name` directly (already shown above).

### Step 7 — Baseline-relative tsc + lint pass

Capture the current baseline before any edits, then after each phase verify the count has not changed:

```pwsh
npx tsc --noEmit 2>&1 | Select-String "error TS" | Measure-Object -Line
npm run lint 2>&1 | Select-String "warning" | Measure-Object -Line
```

Filter additions to the migrated files only:

```pwsh
npx tsc --noEmit 2>&1 | Select-String "(MainPage|Pages|AsyncEditor|PageNavigator|EditorErrorBoundary)\.tsx"
```

Expect: zero new errors in the migrated files.

### Step 8 — Manual smoke test

After implementation, the user verifies:

- App boots; window minimise / maximise / restore / close work; close-button shows red hover.
- Page tab strip + zoom-indicator + MCP indicator render unchanged in the drag region.
- Persephone-menu icon click toggles the sidebar; autoload-reload (when triggered by editing an autoload script) appears with warning colour and reloads scripts.
- Grouped pages: splitter drag is smooth; width is clamped at 120 px min; reloading the app restores the persisted width.
- PageNavigator: every secondary editor (Explorer, Search, Archive, LinkCategory, LinkHostnames, LinkTags) renders, its header buttons portal correctly, expand/collapse animates, switching active panel still toggles correctly.
- Dynamic editor load: open a PDF / image to confirm `<Spinner>` shows briefly during async module import.
- Error boundary: temporarily throw inside an editor body and confirm the "Editor crashed" panel renders with the same styling.

## Concerns / Open questions

### 1. `FlexSpace` with `minWidth` → Panel, not a Spacer extension

**Concern:** UIKit `Spacer` does not accept a `minSize`/`minWidth` prop. The legacy chrome uses `<FlexSpace style={{ minWidth: 40 }} />` to preserve right-margin in the title bar.

**Decision:** use `<Panel name="app-header-spacer" flex={1} minWidth={40} />`. Panel already exposes both surfaces. Extending Spacer for a one-off chrome need would bloat the primitive (Spacer's contract is "pure flex-filler"). If a future migration also wants `Spacer` with a minimum, that's the moment to extend the API — not now.

### 2. `CircularProgress` → `Spinner`

**Concern:** `AsyncEditor` uses `CircularProgress size={16}` during dynamic editor module import. UIKit has both `Spinner` (inline indeterminate) and `ProgressOverlay` (blocking full-screen spinner).

**Decision:** `Spinner` — it is the direct semantic replacement for `CircularProgress` per the renaming table in `uikit/CLAUDE.md`. `ProgressOverlay` is for blocking modal progress; the editor-load case is inline content, not blocking.

### 3. Splitter persistence contract

**Concern:** `Pages.tsx` calls `navModel.setWidth` on every drag tick. `PageNavigatorModel.setWidth` clamps to `Math.max(120, width)` (`src/renderer/ui/navigation/PageNavigatorModel.ts:48`).

**Decision:** UIKit `Splitter.onChange` is invoked continuously during drag (verified at `Splitter.tsx:136-143`) with the same `(value: number) => void` signature as legacy `onChangeWidth`. No callback adaptation needed. Pass `min={120}` to the Splitter as well so the cursor sticks at the floor without depending on the model clamp.

### 4. `PageNavigator` header-portal contract

**Concern:** every secondary editor uses `createPortal(headerContent, headerRef)` (see US-507 background). Any deviation in how `headerRef` is invoked would break six panels.

**Decision:** UIKit `CollapsiblePanel.headerRef` is a `(el: HTMLDivElement | null) => void` ref-callback invoked from `<div data-part="header" ref={panel.headerRef}>` (verified at `uikit/CollapsiblePanelStack/CollapsiblePanelStack.tsx:189-191`). Legacy invocation is `<div className="panel-header" ref={panel.headerRef}>` — identical contract. No call-site changes needed in any secondary editor.

### 5. CollapsiblePanelStack flex sizing

**Concern:** legacy stack used `style={{ flex: "1 1 auto" }}` to fill the navigator root. UIKit forbids `style=` on UIKit components. The UIKit `CollapsiblePanelStack` has explicit `width / minWidth / maxWidth / height / minHeight / maxHeight` props but no `flex` prop.

**Decision:** pass `height="100%"`. The stack is a flex child of a column-flex `Panel` (`Panel direction="column" height="100%"`), so `height: 100%` on the stack fills the column space. No new prop needed on `CollapsiblePanelStack`.

### 6. System buttons / zoom indicator stay as chrome `<button>`

**Concern:** Windows-title-bar minimise / maximise / close and the small zoom-indicator chip have one-off styling (28×40 px, border-radius 0, red close-hover, drag-region `WebkitAppRegion: no-drag`). None match UIKit `IconButton` variants.

**Decision:** keep them as plain chrome `<button>` elements under the Rule 7 chrome exception. The existing `.system-button` / `.close-button` / `.zoom-indicator` CSS rules in `AppRoot` already encode the look; only the JSX element type changes (`<Button>` → `<button>`). Adding a Windows-system-button variant to UIKit would be primitive bloat — these elements are not reusable.

### 7. `EditorErrorBoundary` ownership

**Concern:** lives under `components/basic/` but is genuine app-shell chrome (only consumer is `AsyncEditor.tsx`). Either migrate to `uikit/` (semantic recategorisation) or move into `ui/app/` (chrome).

**Decision:** move to `src/renderer/ui/app/EditorErrorBoundary.tsx`. Reasons:
- Single consumer that lives in the same folder; co-location is clearer than a separate primitive.
- The `styled.div` body is one-off chrome (specific 24 px padding, monospace, red/yellow palette) — not a reusable primitive.
- Moving it preserves the body verbatim under the Rule 7 chrome exception.

### 8. No new UIKit primitive needed

After full investigation, **zero new UIKit primitives** are required for this task. Verified primitives in place:

| Primitive | Status | Used for |
|-----------|--------|----------|
| `Spinner` (US-477) | Landed | `CircularProgress` replacement in `AsyncEditor` |
| `Splitter` (US-486) | Landed | `Pages.tsx` splitter |
| `CollapsiblePanelStack` / `CollapsiblePanel` (US-517) | Landed | `PageNavigator` stack |
| `IconButton` | Landed | Persephone-menu, autoload-reload |
| `Panel` | Landed | Loading wrapper, navigator root, nav-container |

**No UIKit enhancement is required either.** Spacer is intentionally not extended (see §1); CollapsiblePanelStack `height="100%"` already covers the flex-fill case (see §5).

## Acceptance criteria

- No imports from `components/basic|form|layout|overlay/` in any file under `src/renderer/ui/app/` or in `src/renderer/ui/navigation/PageNavigator.tsx`.
  - Verify: `grep -rE "components/(basic|form|layout|overlay)" src/renderer/ui/app src/renderer/ui/navigation/PageNavigator.tsx` returns no matches.
- `@emotion/styled` usage in those files is limited to chrome elements (the AppRoot shell in MainPage, the editor-stage styled divs in Pages, the EditorErrorBoundary chrome).
  - `PageNavigator.tsx`, `AsyncEditor.tsx` have **no** `@emotion/styled` after migration.
- `src/renderer/components/basic/EditorErrorBoundary.tsx` is deleted; the file lives at `src/renderer/ui/app/EditorErrorBoundary.tsx`.
- Splitter drag still persists width via `PageNavigatorModel.setWidth`; width is clamped at 120 px min.
- Every secondary editor (Explorer, Search, Archive, LinkCategory, LinkHostnames, LinkTags) renders identically in PageNavigator with its header buttons portaled correctly.
- All migrated UIKit primitives carry `name` debug attributes per US-521 (table in §6).
- `npm run lint` baseline unchanged (no new warnings or errors attributable to the migrated files).
- `npx tsc --noEmit` baseline unchanged (no new errors attributable to the migrated files).
- Manual smoke test (§8) passes.

This task does NOT run `/review`, `/document`, or `/userdoc` — those run at EPIC-025 close per the deferred-review model.

## Files Changed

| File | Action |
|------|--------|
| `src/renderer/ui/app/MainPage.tsx` | Modified — replace legacy `Button`/`FlexSpace` with UIKit `IconButton`/`Panel`; keep chrome shell + system buttons + zoom-indicator as plain chrome elements |
| `src/renderer/ui/app/Pages.tsx` | Modified — replace legacy `Splitter` + nav-panel-container div with UIKit `Splitter` + `Panel` |
| `src/renderer/ui/app/AsyncEditor.tsx` | Modified — replace `CircularProgress` + `ProgressRoot` with UIKit `Spinner` + `Panel`; update `EditorErrorBoundary` import |
| `src/renderer/ui/app/EditorErrorBoundary.tsx` | **New** — moved verbatim from `components/basic/` (chrome exception) |
| `src/renderer/ui/navigation/PageNavigator.tsx` | Modified — replace legacy `CollapsiblePanelStack`/`CollapsiblePanel` + `PageNavigatorRoot` with UIKit primitives + `Panel` |
| `src/renderer/components/basic/EditorErrorBoundary.tsx` | **Deleted** — moved to `ui/app/` |

No changes to: UIKit primitives, `RenderEditor.tsx`, `LazySecondaryEditor.tsx`, `secondary-editor-registry.ts`, `PageNavigatorModel.ts`, any secondary editor, the legacy `components/layout/Splitter.tsx` or `components/layout/CollapsiblePanelStack.tsx` (other consumers may still exist outside this task's scope — separate cleanup task if needed).

## Links

- Epic: [EPIC-025](../../epics/EPIC-025.md)
- Phase: 4 — per-screen migration
- Related primitives: US-517 CollapsiblePanelStack, US-486 Splitter, US-477 Spinner
- Predecessor: US-517 noted PageNavigator as an "opportunistic" retrofit — this task fulfils it.
- Related: US-507 Explorer + Search secondary editors (consumers of the headerRef portal contract)
