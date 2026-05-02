# US-460: MarkdownSearchBar — UIKit migration

## Goal

Migrate the floating in-preview Find bar ([src/renderer/editors/markdown/MarkdownSearchBar.tsx](../../../src/renderer/editors/markdown/MarkdownSearchBar.tsx)) from a `styled.div` root with raw `<input>` / `<button>` / `<span>` children to a pure UIKit composition (`Panel`, `Input`, `IconButton`, `Text`) — the next per-screen migration of [EPIC-025](../../epics/EPIC-025.md) Phase 4.

This task introduces **one small UIKit extension** (per-side positioning props on `Panel`: `top` / `right` / `bottom` / `left`) needed to anchor the floating bar at the top-right corner of the markdown preview without using `inline style=` (Rule 7). After the migration, `MarkdownSearchBar.tsx` contains zero `styled.*` calls, zero `style={...}`, zero `className={...}`, and imports only UIKit components for rendering.

## Background

### EPIC-025 Phase 4 context

Per-screen migration loop (from [EPIC-025](../../epics/EPIC-025.md) Phase 4):

1. Pick a screen
2. Audit which UIKit components are needed and which are missing
3. Build missing components / prop extensions in Storybook first
4. Rewrite the screen with UIKit
5. Smoke-test the screen

Recent precedents:
- [US-455 MermaidView](../US-455-mermaid-view-migration/README.md) — added `position` / `inset` / `zIndex` to `Panel`, then rewrote MermaidView. This task follows the same shape (extend Panel → rewrite screen).
- [US-458 ImageViewer](../US-458-image-viewer-migration/README.md) and [US-452 About](../US-452-about-screen-migration/README.md) — same per-screen migration pattern.

### Why MarkdownSearchBar

- **Self-contained** — one file, one consumer ([MarkdownView.tsx:144-152](../../../src/renderer/editors/markdown/MarkdownView.tsx#L144-L152)). No cross-screen coupling.
- **Small surface** — ~120 LOC, 4 distinct UI elements (input, count, prev, next, close). Tight rewrite.
- **Exercises floating positioning** — bar is `position: absolute; top: 4; right: 20; zIndex: 10`. Adding `top`/`right`/`bottom`/`left` to Panel here unblocks future floating-overlay migrations (toasts, popovers, sticky controls in other previews).
- **No `Dialog` dependency** — not a modal; `Dialog` (US-432) blockage does not apply.

### Current implementation (file body)

[src/renderer/editors/markdown/MarkdownSearchBar.tsx](../../../src/renderer/editors/markdown/MarkdownSearchBar.tsx) — 128 lines:

```tsx
import styled from "@emotion/styled";
import { useEffect, useRef } from "react";
import color from "../../theme/color";
import { CloseIcon, ChevronUpIcon, ChevronDownIcon } from "../../theme/icons";

const SearchBarRoot = styled.div({
    position: "absolute",
    top: 4,
    right: 20,
    zIndex: 10,
    display: "flex",
    alignItems: "center",
    gap: 2,
    padding: "3px 4px",
    backgroundColor: color.background.light,
    border: `1px solid ${color.border.default}`,
    borderRadius: 4,
    boxShadow: `0 2px 6px ${color.shadow.default}`,
    "& input": {
        width: 180, height: 22, padding: "0 6px",
        border: `1px solid ${color.border.default}`, borderRadius: 3,
        backgroundColor: color.background.default, color: color.text.default,
        fontSize: 13, outline: "none",
        "&:focus": { borderColor: color.border.active },
    },
    "& .match-count": {
        fontSize: 12, color: color.text.light,
        whiteSpace: "nowrap", minWidth: 50, textAlign: "center",
    },
    "& .search-btn": {
        display: "flex", alignItems: "center", justifyContent: "center",
        width: 22, height: 22, padding: 0, border: "none", borderRadius: 3,
        backgroundColor: "transparent", color: color.icon.light,
        cursor: "pointer",
        "&:hover": {
            backgroundColor: color.background.default,
            color: color.icon.default,
        },
    },
});

// ...component renders <SearchBarRoot> with <input>, <span.match-count>, three <button.search-btn>
```

The component:
- Auto-focuses + selects the input on mount (`useEffect` + `inputRef`).
- Handles keyboard shortcuts on the input: `Esc` (close), `Enter`/`Shift+Enter` (next/prev), `F3`/`Shift+F3` (next/prev).
- Renders three `<button.search-btn>`: ChevronUp (prev), ChevronDown (next), Close.
- Renders match label `"<n> of <total>"`, `"No results"`, or empty.

### Audit results — element by element

| Old element | UIKit replacement | Gap |
|---|---|---|
| `SearchBarRoot` — `position: absolute; top: 4; right: 20; zIndex: 10; display: flex; align: center; gap: 2; padding: 3px 4px; bg.light; border.default 1px; radius 4; shadow` | `<Panel position="absolute" top={4} right={20} zIndex={10} align="center" gap="xs" paddingY="xs" paddingX="sm" background="light" border borderColor="default" rounded="md" shadow>` | **`top` / `right` / `bottom` / `left` missing on `Panel`** |
| `<input>` — width 180, height 22, padding 0 6px, border, radius 3, bg.default, fontSize 13, focus: border.active | `<Panel width={180}><Input ref={inputRef} size="sm" placeholder="Find..." value={searchText} onChange={onSearchTextChange} onKeyDown={onKeyDown} /></Panel>` | none — `Input size="sm"` already produces a 24px-tall control with focus border-color change. The fixed 180px width is set by the wrapper `Panel` (Input has `width: 100%`) |
| `<span.match-count>` — fontSize 12, color.text.light, whiteSpace nowrap, minWidth 50, textAlign center | `<Panel minWidth={50} align="center" justify="center"><Text size="sm" color="light" nowrap>{label}</Text></Panel>` | none — wrapper `Panel` provides the fixed minWidth + centering; `Text` provides `nowrap` and the typography |
| `<button.search-btn>` × 3 (ChevronUp / ChevronDown / Close) — 22×22, transparent bg, icon.light, hover: bg.default + icon.default | `<IconButton size="sm" title="…" onClick={…} icon={…} />` × 3 | none — `IconButton size="sm"` produces a 24×24 button with 16×16 icon; same pattern as US-455 / US-458 |

### Visual drift accepted in the migration

These are intentional consequences of joining UIKit's tighter convention. None affect functionality.

| Drift | Old | New | Reason |
|---|---|---|---|
| Bar height | 22 (input) + 6 (3+3 padding) = 28 | 24 (Input sm) + 4 (2+2 padding) = 28 | Net same. Padding token shift (`3px → 2px` vertical) cancels the input growth (`22 → 24`). |
| Input bg | `color.background.default` | `color.background.dark` (UIKit Input default) | All UIKit inputs use the darker fill. Other migrated screens already accept this. |
| Input border color | `color.border.default` | `color.border.light` (UIKit Input default) | UIKit standard. |
| Input radius | 3 (radius.sm) | 4 (radius.md, UIKit Input default) | 1px difference. UIKit standard. |
| Input font size | 13 (fontSize.md) | 12 (fontSize.sm via `size="sm"`) | 1px difference. Matches `controlSm` typography pairing. |
| IconButton hover | bg + color change | color change only | UIKit IconButton has no hover background. Same drift accepted in US-455 and US-458. |
| Close icon size | 14×14 (explicit) | 16×16 (UIKit IconButton sm default) | 2px increase. Consistent with prev/next icons. |
| Box shadow | `0 2px 6px` | `0 2px 8px` (Panel `shadow` default) | 2px more blur. Imperceptible at default zoom. |
| Padding | `3px 4px` | `paddingY="xs"` (2px) + `paddingX="sm"` (4px) = `2px 4px` | 1px less vertical. The closest token combination. |

### Files involved

| File | Role | Change |
|------|------|--------|
| [src/renderer/uikit/Panel/Panel.tsx](../../../src/renderer/uikit/Panel/Panel.tsx) | Layout primitive | Add `top` / `right` / `bottom` / `left` props (number→px, string passthrough); forward to `inlineStyle` |
| [src/renderer/uikit/Panel/Panel.story.tsx](../../../src/renderer/uikit/Panel/Panel.story.tsx) | Panel story | Add four new prop entries |
| [src/renderer/editors/markdown/MarkdownSearchBar.tsx](../../../src/renderer/editors/markdown/MarkdownSearchBar.tsx) | Markdown find bar | Rewrite — drop `@emotion/styled`, `color`; use `Panel` / `Input` / `IconButton` / `Text` |

### Theme tokens used

All colors come from existing `color.ts` tokens (no theme changes). All sizing uses existing UIKit tokens (`spacing`, `gap`, `radius`, `height`, `fontSize`).

## Implementation Plan

The work splits into two phases. Phase 1 lands the Panel API addition in isolation (with Storybook coverage); Phase 2 rewrites the screen against it.

| Phase | Scope | Risk |
|-------|-------|------|
| **Phase 1** — Panel side-position props (Steps 1–2) | Add `top` / `right` / `bottom` / `left` to `Panel`; story entries | Low — additive UIKit work, no consumers affected |
| **Phase 2** — MarkdownSearchBar rewrite (Steps 3–4) | Rewrite the file using Phase 1 primitives + existing UIKit | Medium — visible behavior; smoke test required |

Phase 1 is shippable on its own — the new Panel props become available across the codebase before any screen consumes them.

---

## Phase 1 — Panel side-position props

### Step 1 — Extend `Panel` with `top` / `right` / `bottom` / `left`

In [src/renderer/uikit/Panel/Panel.tsx](../../../src/renderer/uikit/Panel/Panel.tsx):

**1a.** Add four props to `PanelProps`, immediately after the existing `inset` / `zIndex` group (around line 67):

```ts
/** CSS top — number → px, string passes through (e.g. "auto", "50%"). Use with `position` to anchor an edge. */
top?: number | string;
/** CSS right — number → px, string passes through. */
right?: number | string;
/** CSS bottom — number → px, string passes through. */
bottom?: number | string;
/** CSS left — number → px, string passes through. */
left?: number | string;
```

**1b.** Destructure them in the component (around line 211, immediately after `inset, zIndex`):

```ts
inset,
zIndex,
top,
right,
bottom,
left,
```

**1c.** Add them to `inlineStyle` (around line 259, after `inset, zIndex`):

```ts
position,
inset,
zIndex,
top,
right,
bottom,
left,
```

`React.CSSProperties` accepts `top` / `right` / `bottom` / `left` natively — no token mapping needed.

### Step 2 — Update Panel story

In [src/renderer/uikit/Panel/Panel.story.tsx](../../../src/renderer/uikit/Panel/Panel.story.tsx) — append four entries after the existing `inset` / `zIndex` entries (around line 39):

```ts
{ name: "top",         type: "string", default: "" },
{ name: "right",       type: "string", default: "" },
{ name: "bottom",      type: "string", default: "" },
{ name: "left",        type: "string", default: "" },
```

(`type: "string"` rather than `"number"` so users can also enter `"auto"` or `"50%"`.)

---

## Phase 2 — MarkdownSearchBar rewrite

### Step 3 — Rewrite `MarkdownSearchBar.tsx`

Full new content of [src/renderer/editors/markdown/MarkdownSearchBar.tsx](../../../src/renderer/editors/markdown/MarkdownSearchBar.tsx):

```tsx
import { useEffect, useRef } from "react";
import { Panel, Input, IconButton, Text } from "../../uikit";
import { CloseIcon, ChevronUpIcon, ChevronDownIcon } from "../../theme/icons";

export interface MarkdownSearchBarProps {
    searchText: string;
    currentMatch: number;
    totalMatches: number;
    onSearchTextChange: (text: string) => void;
    onNext: () => void;
    onPrev: () => void;
    onClose: () => void;
}

export function MarkdownSearchBar(props: MarkdownSearchBarProps) {
    const { searchText, currentMatch, totalMatches, onSearchTextChange, onNext, onPrev, onClose } = props;
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
    }, []);

    const onKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onClose();
        } else if (e.key === "Enter" && e.shiftKey) {
            e.preventDefault();
            onPrev();
        } else if (e.key === "Enter") {
            e.preventDefault();
            onNext();
        } else if (e.key === "F3" && e.shiftKey) {
            e.preventDefault();
            e.stopPropagation();
            onPrev();
        } else if (e.key === "F3") {
            e.preventDefault();
            e.stopPropagation();
            onNext();
        }
    };

    const matchLabel = searchText
        ? totalMatches > 0
            ? `${currentMatch + 1} of ${totalMatches}`
            : "No results"
        : "";

    return (
        <Panel
            position="absolute"
            top={4}
            right={20}
            zIndex={10}
            align="center"
            gap="xs"
            paddingY="xs"
            paddingX="sm"
            background="light"
            border
            borderColor="default"
            rounded="md"
            shadow
        >
            <Panel width={180}>
                <Input
                    ref={inputRef}
                    size="sm"
                    value={searchText}
                    onChange={onSearchTextChange}
                    onKeyDown={onKeyDown}
                    placeholder="Find..."
                />
            </Panel>
            <Panel minWidth={50} align="center" justify="center">
                <Text size="sm" color="light" nowrap>{matchLabel}</Text>
            </Panel>
            <IconButton
                size="sm"
                title="Previous Match (Shift+F3)"
                onClick={onPrev}
                icon={<ChevronUpIcon />}
            />
            <IconButton
                size="sm"
                title="Next Match (F3)"
                onClick={onNext}
                icon={<ChevronDownIcon />}
            />
            <IconButton
                size="sm"
                title="Close (Esc)"
                onClick={onClose}
                icon={<CloseIcon />}
            />
        </Panel>
    );
}
```

Key changes vs. original:
- Removed: `import styled from "@emotion/styled"`, `import color from "../../theme/color"`, the `SearchBarRoot` block.
- Added: `import { Panel, Input, IconButton, Text } from "../../uikit"`.
- The `inputRef` `useEffect` focus/select pattern is preserved — UIKit `Input` is `forwardRef<HTMLInputElement>`, so `inputRef.current` is the underlying `<input>` element.
- Three `<button>`s become three `<IconButton>`s. The Close icon's explicit `width={14} height={14}` is dropped — `IconButton size="sm"` renders icons at 16×16 (matching the prev/next chevrons).
- The match-count `<span>` becomes a `<Panel minWidth={50}>` wrapper around `<Text>`, providing the fixed-width centering without growing `Text`'s API.
- The 180px input width is provided by a wrapper `<Panel width={180}>` — Input has `width: 100%` and fills the panel.

### Step 4 — TypeScript verification + smoke test

**TypeScript:** Run `npx tsc --noEmit`. The markdown editor and any code that imports `Panel` must produce no new errors. Pre-existing repo-wide errors are unrelated.

**Smoke test:** Open a `.md` file in markdown preview mode and verify:

1. **Open search bar** — `Ctrl+F` (handled by parent `MarkdownView` via [MarkdownView.tsx:94-99](../../../src/renderer/editors/markdown/MarkdownView.tsx#L94-L99)). Bar appears at top-right corner of the preview with the input auto-focused and (if reopening) selected.
2. **Bar position** — pinned 4px from top, 20px from right of the markdown scroll container; floats above content (`zIndex: 10`); dim shadow; subtle border with elevated background.
3. **Type a query** — input receives keystrokes; matches highlight in `MarkdownBlock`; match counter shows `"1 of N"` and centers in its slot (no width jump as `1 of 9` → `10 of 99`).
4. **No results** — typing a non-matching query shows `"No results"` in light-color text.
5. **Empty query** — clearing the input hides the count label entirely (empty `Text`, `Panel` keeps minWidth so layout stays stable).
6. **Next / Prev navigation** — `Enter` and `F3` advance to next match; `Shift+Enter` and `Shift+F3` go to previous; the chevron `IconButton`s do the same on click. Matches scroll into view (handled by parent).
7. **Close** — `Esc` and the close `IconButton` both close the bar (handled by parent `vm.closeSearch`).
8. **DevTools spot-check:** root has `data-type="panel"` with `data-direction="row"`, `data-bg="light"`, `data-border`, `data-border-color="default"`, `data-shadow`, and `style="position:absolute; top:4px; right:20px; z-index:10; ..."`. The input has `data-type="input"`, `data-size="sm"`. Each button has `data-type="icon-button"`, `data-size="sm"`.
9. **Theme switching** — switch to light-modern / monokai / default-dark. Bar background, border, and text remain readable.

## Concerns / Open Questions

### Resolved

1. **Why discrete `top` / `right` / `bottom` / `left` props on `Panel` instead of `inset="4px 20px auto auto"`?** `inset` already supports the 4-value CSS shorthand and would technically work. Discrete props are still preferred because:
   - Readability — `top={4} right={20}` is unambiguous; `inset="4px 20px auto auto"` requires the reader to remember CSS shorthand order and the `auto` semantics.
   - Future migrations — toasts, popovers, sticky bars, and other floating UI all need single-edge anchoring. Adding the props now means future tasks don't need this same UIKit extension.
   - Symmetry with existing `position` / `inset` / `zIndex` group, which was added in [US-455](../US-455-mermaid-view-migration/README.md) for similar reasoning.

2. **Why wrap `Input` in a `Panel width={180}` instead of adding a `width` prop to `Input`?** Composition over API growth. `Input` has `width: 100%` by design (intended to fill its container). Wrapping in a `Panel` with a fixed width is the idiomatic way to give it a fixed size in UIKit, and avoids one-off prop additions on a leaf primitive. Same logic applies to wrapping `Text` in `Panel minWidth={50}` for the match counter.

3. **Visual drifts (input bg, border, radius, font-size, hover, padding).** All small, intentional, and consistent with what other Phase 4 migrations have already accepted. Listed in the Audit table above so future readers know they were considered.

4. **Should `MarkdownSearchBar` move to `src/renderer/uikit/` or `src/renderer/editors/shared/`?** No. Unlike `BaseImageView` (US-459), which is composed by three editors, `MarkdownSearchBar` is consumed only by [MarkdownView.tsx](../../../src/renderer/editors/markdown/MarkdownView.tsx). It also embeds markdown-search-specific UX (Ctrl+F shortcut wiring, F3 / Shift+F3 navigation, "No results" copy). It stays in `editors/markdown/`.

5. **Should this task also migrate `MarkdownView.tsx` itself?** No. `MarkdownView.tsx` still uses `MdViewRoot` (`styled.div`), `<Button>` from app components, and `<Minimap>` (custom). That's a larger migration that needs a separate task — its scrolling container, minimap, and compact-mode logic are non-trivial and would expand this task's scope beyond what the title promises.

6. **Should the match-count empty-state hide the wrapper `Panel`?** No. Keeping the `Panel minWidth={50}` rendered with empty `Text` content preserves the bar's width when search begins (otherwise the bar would jump from compact → wide as soon as the user types one matching character). The `Panel` itself has zero padding/border, so an empty content cell is invisible but reserves width.

7. **Auto-focus + select on mount.** The `inputRef` `useEffect` pattern works because UIKit `Input` is a `forwardRef<HTMLInputElement>` (verified in [Input.tsx:67](../../../src/renderer/uikit/Input/Input.tsx#L67)). No behavior change.

8. **`onKeyDown` event flow.** Input forwards unknown props via `...rest`, so `onKeyDown` reaches the underlying `<input>` (verified in [Input.tsx:81](../../../src/renderer/uikit/Input/Input.tsx#L81)). All five branches (Esc / Enter / Shift+Enter / F3 / Shift+F3) keep working unchanged.

### None open.

## Acceptance Criteria

- [ ] `Panel` accepts `top` / `right` / `bottom` / `left` props (`number | string` each) — all forwarded to `inlineStyle`
- [ ] [Panel.story.tsx](../../../src/renderer/uikit/Panel/Panel.story.tsx) exposes the four new props in the property editor
- [ ] [MarkdownSearchBar.tsx](../../../src/renderer/editors/markdown/MarkdownSearchBar.tsx) contains zero `styled.*` calls, zero `style={...}`, zero `className={...}`
- [ ] `MarkdownSearchBar.tsx` imports zero app-side styled components — no `color`, no `@emotion/styled`
- [ ] `MarkdownSearchBar.tsx` imports only from `../../uikit`, `../../theme/icons`, and React
- [ ] Component external API (props, behavior) is unchanged: same `MarkdownSearchBarProps` shape, same auto-focus on mount, same keyboard handlers (Esc / Enter / Shift+Enter / F3 / Shift+F3), same `MatchLabel` rendering (`"<n> of <total>"` / `"No results"` / `""`)
- [ ] [MarkdownView.tsx](../../../src/renderer/editors/markdown/MarkdownView.tsx) is **not** modified — the `import { MarkdownSearchBar } from "./MarkdownSearchBar"` path and the JSX usage stay identical
- [ ] Bar renders pinned at top:4 right:20 of the markdown preview when `Ctrl+F` is pressed
- [ ] Input is auto-focused and (if pre-filled) text-selected on mount; typing updates matches; counter centers in a 50px slot without layout jumps
- [ ] All keyboard shortcuts work: Esc closes, Enter / F3 next, Shift+Enter / Shift+F3 prev
- [ ] All three icon buttons (prev, next, close) work on click
- [ ] Bar remains readable across all themes (default-dark, light-modern, monokai)
- [ ] Storybook → Layout → Panel exposes the four new positioning props with live previews
- [ ] No new TypeScript errors

## Files Changed

| File | Change |
|------|--------|
| [src/renderer/uikit/Panel/Panel.tsx](../../../src/renderer/uikit/Panel/Panel.tsx) | Add `top` / `right` / `bottom` / `left` props (`number \| string`); forward to `inlineStyle` |
| [src/renderer/uikit/Panel/Panel.story.tsx](../../../src/renderer/uikit/Panel/Panel.story.tsx) | Add four new prop entries |
| [src/renderer/editors/markdown/MarkdownSearchBar.tsx](../../../src/renderer/editors/markdown/MarkdownSearchBar.tsx) | Replace `styled.div` root + raw input/buttons/span with `Panel` / `Input` / `IconButton` / `Text` composition |

## Files NOT Changed

- [src/renderer/editors/markdown/MarkdownView.tsx](../../../src/renderer/editors/markdown/MarkdownView.tsx) — consumer; import path and JSX usage unchanged. (MarkdownView's own UIKit migration is a separate, larger task.)
- [src/renderer/editors/markdown/MarkdownViewModel.ts](../../../src/renderer/editors/markdown/MarkdownViewModel.ts) — search state and navigation logic unchanged.
- [src/renderer/editors/markdown/MarkdownBlock.tsx](../../../src/renderer/editors/markdown/MarkdownBlock.tsx) — match highlighting / scrollToMatch logic unchanged.
- [src/renderer/uikit/Input/Input.tsx](../../../src/renderer/uikit/Input/Input.tsx) — already supports `size="sm"`, `forwardRef`, prop passthrough; no API change needed.
- [src/renderer/uikit/IconButton/IconButton.tsx](../../../src/renderer/uikit/IconButton/IconButton.tsx) — already supports `size="sm"`; no change.
- [src/renderer/uikit/Text/Text.tsx](../../../src/renderer/uikit/Text/Text.tsx) — already supports `size="sm"`, `color="light"`, `nowrap`; no change.
- [src/renderer/uikit/index.ts](../../../src/renderer/uikit/index.ts) — `Panel` already exported; new props ride along on the existing export.
- All theme files — no token changes.
