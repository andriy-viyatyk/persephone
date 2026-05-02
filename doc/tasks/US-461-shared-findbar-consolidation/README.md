# US-461: Shared FindBar — consolidate MarkdownSearchBar + BrowserFindBar

**Status:** Planned
**Epic:** [EPIC-025 — Unified Component Library and Storybook Editor](../../epics/EPIC-025.md)
**Phase:** 4 — Per-Screen Migration

## Goal

Replace `MarkdownSearchBar` (already on UIKit, ships in US-460) and `BrowserFindBar` (still raw `styled.div` + `<input>` + `<button>`) with a single shared `FindBar` component in [src/renderer/editors/shared/](../../../src/renderer/editors/shared/). Both consumers render the same floating Ctrl+F bar; consolidating now is cheaper than migrating Browser separately and watching the two drift.

## Background

### Why now

EPIC-025 Phase 4 picks one screen at a time. The Browser editor's `BrowserFindBar` was queued as US-461 because it still uses Emotion + raw HTML. Reading its source confirms it is a near-clone of the freshly-migrated `MarkdownSearchBar` — same position, same dimensions, same tokens, same keyboard handler. The only differences are cosmetic prop names (`findText` vs `searchText`, `activeMatch` vs `currentMatch`) and the placeholder string (`"Find in page..."` vs `"Find..."`).

This matches the precedent set by [US-459 (BaseImageView)](../US-459-base-image-view-adoption/README.md): when a leaf component has multiple consumers, it lives in `editors/shared/`.

### Current state

[src/renderer/editors/markdown/MarkdownSearchBar.tsx](../../../src/renderer/editors/markdown/MarkdownSearchBar.tsx) (101 lines, post-US-460):

```tsx
export interface MarkdownSearchBarProps {
    searchText: string;
    currentMatch: number;
    totalMatches: number;
    onSearchTextChange: (text: string) => void;
    onNext: () => void;
    onPrev: () => void;
    onClose: () => void;
}
// ... uses Panel + Input + IconButton + Text from UIKit
// ... placeholder="Find..."
```

[src/renderer/editors/browser/BrowserFindBar.tsx](../../../src/renderer/editors/browser/BrowserFindBar.tsx) (127 lines, pre-migration):

```tsx
const FindBarRoot = styled.div({ /* position absolute top:4 right:20, light bg, default border, md radius, shadow */ });

export interface BrowserFindBarProps {
    findText: string;
    activeMatch: number;
    totalMatches: number;
    onFindTextChange: (text: string) => void;
    onNext: () => void;
    onPrev: () => void;
    onClose: () => void;
}
// ... raw <input>, <span>, <button>
// ... placeholder="Find in page..."
```

The visual recipes are identical (same color tokens, same dimensions, same shadow, same radius). The keyboard handlers are byte-for-byte the same: Esc closes, Enter / Shift+Enter / F3 / Shift+F3 navigate (with `stopPropagation` on Esc and F3 paths). Auto-focus + select on mount in both.

### Consumers

| File | Line | Usage |
|---|---|---|
| [src/renderer/editors/markdown/MarkdownView.tsx](../../../src/renderer/editors/markdown/MarkdownView.tsx) | 144 | `<MarkdownSearchBar searchText={...} currentMatch={...} totalMatches={...} onSearchTextChange={vm.setSearchText} onNext={vm.nextMatch} onPrev={vm.prevMatch} onClose={vm.closeSearch} />` |
| [src/renderer/editors/browser/BrowserEditorView.tsx](../../../src/renderer/editors/browser/BrowserEditorView.tsx) | 764 | `<BrowserFindBar findText={...} activeMatch={...} totalMatches={...} onFindTextChange={webview.setFindText} onNext={webview.findNext} onPrev={webview.findPrev} onClose={webview.closeFind} />` |

Both consumers already pass `(text: string) => void` for the change callback (no event-to-string wrapping needed) and plain `() => void` for nav/close. The view-model state shapes (`pageState.searchText`, `findText`, etc.) stay as they are — only the prop names at the consumption site change.

### Visual drift accepted (browser only — markdown already on UIKit)

| Aspect | BrowserFindBar (current) | Shared FindBar (UIKit) | Drift |
|---|---|---|---|
| Input height | 22px | 24px (Input `size="sm"`) | +2px |
| Vertical padding | 3px | 2px (`paddingY="xs"`) | −1px each side |
| Net bar height | 28px | 28px | 0 |
| Input bg | `color.background.default` | `color.background.default` (Input default) | none |
| Input border / radius | 1px default / 3 | 1px default / 3 (Input sm) | none |
| Buttons | 22×22 raw `<button>`, no hover bg | 24×24 IconButton `size="sm"`, hover color-only | +2px each, hover style shift |
| Close icon | 14×14 explicit | 16×16 (IconButton sm) | +2px |
| Shadow blur | 6 | 8 | +2 |
| Match-counter font / color | 12 / `text.light` | Text `size="sm"` (12) / `color="light"` | none |
| Background / border-color / radius | light / default / 4 | light / default / md (4) | none |

Identical to the drift accepted in US-460. Bar total height stays 28px.

### Files involved

- [src/renderer/editors/markdown/MarkdownSearchBar.tsx](../../../src/renderer/editors/markdown/MarkdownSearchBar.tsx) — delete after move
- [src/renderer/editors/browser/BrowserFindBar.tsx](../../../src/renderer/editors/browser/BrowserFindBar.tsx) — delete after move
- [src/renderer/editors/markdown/MarkdownView.tsx](../../../src/renderer/editors/markdown/MarkdownView.tsx) — update import + prop names
- [src/renderer/editors/browser/BrowserEditorView.tsx](../../../src/renderer/editors/browser/BrowserEditorView.tsx) — update import + prop names + pass `placeholder`
- [src/renderer/editors/shared/](../../../src/renderer/editors/shared/) — new home for `FindBar.tsx`

## Implementation plan

### Step 1 — Create `src/renderer/editors/shared/FindBar.tsx`

Copy the post-US-460 `MarkdownSearchBar` body verbatim with two changes: neutral prop names and an optional `placeholder` prop.

```tsx
import { useEffect, useRef } from "react";
import { Panel, Input, IconButton, Text } from "../../uikit";
import { CloseIcon, ChevronUpIcon, ChevronDownIcon } from "../../theme/icons";

export interface FindBarProps {
    text: string;
    currentMatch: number;
    totalMatches: number;
    onTextChange: (text: string) => void;
    onNext: () => void;
    onPrev: () => void;
    onClose: () => void;
    placeholder?: string;
}

export function FindBar(props: FindBarProps) {
    const {
        text,
        currentMatch,
        totalMatches,
        onTextChange,
        onNext,
        onPrev,
        onClose,
        placeholder = "Find...",
    } = props;
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

    const matchLabel = text
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
                    value={text}
                    onChange={onTextChange}
                    onKeyDown={onKeyDown}
                    placeholder={placeholder}
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

### Step 2 — Update [MarkdownView.tsx](../../../src/renderer/editors/markdown/MarkdownView.tsx)

Change line 9 import:
```tsx
// before
import { MarkdownSearchBar } from "./MarkdownSearchBar";
// after
import { FindBar } from "../shared/FindBar";
```

Change the JSX at line 144:
```tsx
// before
<MarkdownSearchBar
    searchText={pageState.searchText}
    currentMatch={pageState.currentMatchIndex}
    totalMatches={pageState.totalMatches}
    onSearchTextChange={vm.setSearchText}
    onNext={vm.nextMatch}
    onPrev={vm.prevMatch}
    onClose={vm.closeSearch}
/>
// after
<FindBar
    text={pageState.searchText}
    currentMatch={pageState.currentMatchIndex}
    totalMatches={pageState.totalMatches}
    onTextChange={vm.setSearchText}
    onNext={vm.nextMatch}
    onPrev={vm.prevMatch}
    onClose={vm.closeSearch}
/>
```

(Default placeholder `"Find..."` matches what MarkdownSearchBar shipped with — no `placeholder` prop needed.)

### Step 3 — Update [BrowserEditorView.tsx](../../../src/renderer/editors/browser/BrowserEditorView.tsx)

Change line 46 import:
```tsx
// before
import { BrowserFindBar } from "./BrowserFindBar";
// after
import { FindBar } from "../shared/FindBar";
```

Change the JSX at line 764:
```tsx
// before
<BrowserFindBar
    findText={findText}
    activeMatch={findActiveMatch}
    totalMatches={findTotalMatches}
    onFindTextChange={webview.setFindText}
    onNext={webview.findNext}
    onPrev={webview.findPrev}
    onClose={webview.closeFind}
/>
// after
<FindBar
    text={findText}
    currentMatch={findActiveMatch}
    totalMatches={findTotalMatches}
    onTextChange={webview.setFindText}
    onNext={webview.findNext}
    onPrev={webview.findPrev}
    onClose={webview.closeFind}
    placeholder="Find in page..."
/>
```

(Note: `findActiveMatch` is the existing local variable — the prop is renamed to `currentMatch`, not the source state.)

### Step 4 — Delete the old files

- [src/renderer/editors/markdown/MarkdownSearchBar.tsx](../../../src/renderer/editors/markdown/MarkdownSearchBar.tsx)
- [src/renderer/editors/browser/BrowserFindBar.tsx](../../../src/renderer/editors/browser/BrowserFindBar.tsx)

### Step 5 — Smoke test

Both Ctrl+F surfaces (markdown preview, browser editor) behave exactly as before. See acceptance criteria below.

## Concerns / open questions

### 1. Component name (`FindBar` vs `SearchBar`) — RESOLVED

Going with **`FindBar`**. Reasons: matches Chrome / Electron's "Find in page" terminology, matches the legacy `BrowserFindBar` name, distinguishes from "search" verbs that imply remote queries (file search, code search). MarkdownSearchBar's "Search" was the outlier; consolidating to "Find" aligns with platform convention.

### 2. Prop naming (`text` vs `searchText` / `findText` / `query`) — RESOLVED

Going with **`text`** + **`onTextChange`**. Shortest neutral name. `query` was rejected (suggests URL/database query). Keeping `currentMatch` (markdown's name) over `activeMatch` (browser's) — slightly more descriptive for "current position in match list".

### 3. Default placeholder — RESOLVED

Default to **`"Find..."`** (shorter, generic). Browser passes **`placeholder="Find in page..."`** to preserve its current Chrome-aligned wording. Markdown takes the default.

### 4. Folder placement — RESOLVED

`src/renderer/editors/shared/FindBar.tsx`. Matches the precedent set by [US-459 (BaseImageView)](../US-459-base-image-view-adoption/README.md) — multi-consumer leaf components live in `editors/shared/`. The folder already contains `BaseImageView.tsx`, `ColorizedCode.tsx`, `link-open-menu.tsx`.

### 5. Visual drift on browser side — RESOLVED

Same drift table as US-460, identical net result (28px bar height preserved). Already accepted as part of EPIC-025 Phase 4 UIKit alignment.

### 6. Should the `onTextChange` signature match Input's `onChange` — RESOLVED

Yes. UIKit `Input.onChange` is already `(value: string) => void` (not the raw event). Both current consumers already pass `(text: string) => void` callbacks. No translation or wrapping needed.

### 7. Keyboard handler differences — RESOLVED (none)

Confirmed byte-for-byte identical between MarkdownSearchBar and BrowserFindBar:
- Esc → preventDefault + stopPropagation + onClose
- Shift+Enter → preventDefault + onPrev (no stopPropagation)
- Enter → preventDefault + onNext (no stopPropagation)
- Shift+F3 → preventDefault + stopPropagation + onPrev
- F3 → preventDefault + stopPropagation + onNext

The asymmetry (stopPropagation on Esc/F3 but not on Enter) is intentional: Enter shouldn't be swallowed if upstream handlers also listen, but Esc/F3 should be — both consumers already enforce this.

### 8. Auto-focus on mount — RESOLVED

Both current implementations call `focus()` + `select()` in a mount effect. Shared FindBar preserves it. No prop to opt out (no consumer needs that).

### 9. No new UIKit components needed — RESOLVED

Panel, Input, IconButton, Text already cover everything. `Panel.top/right/zIndex/position` props (added in US-460) handle the floating anchor.

## Acceptance criteria

1. [src/renderer/editors/shared/FindBar.tsx](../../../src/renderer/editors/shared/FindBar.tsx) exists with the API in Step 1.
2. [src/renderer/editors/markdown/MarkdownSearchBar.tsx](../../../src/renderer/editors/markdown/MarkdownSearchBar.tsx) deleted.
3. [src/renderer/editors/browser/BrowserFindBar.tsx](../../../src/renderer/editors/browser/BrowserFindBar.tsx) deleted.
4. [MarkdownView.tsx](../../../src/renderer/editors/markdown/MarkdownView.tsx) imports `FindBar` from `../shared/FindBar` with renamed props (no `placeholder` passed → default `"Find..."`).
5. [BrowserEditorView.tsx](../../../src/renderer/editors/browser/BrowserEditorView.tsx) imports `FindBar` from `../shared/FindBar` with renamed props and `placeholder="Find in page..."`.
6. Markdown preview Ctrl+F: bar appears top:4 right:20 with auto-focus + select; Esc closes; Enter/Shift+Enter navigate; F3/Shift+F3 navigate; counter shows `"1 of N"` / `"No results"` / empty per query.
7. Browser editor Ctrl+F: identical behavior. Placeholder reads `"Find in page..."`.
8. DevTools spot-check on both surfaces: `data-type="panel"` with `data-bg="light"`, `data-border-color="default"`, `data-shadow`. Each IconButton: `data-type="icon-button"` `data-size="sm"`. Input: `data-type="input"` `data-size="sm"`.
9. Theme switching (default-dark / light-modern / monokai) — bar remains readable in both consumers.
10. No new TypeScript errors. (Pre-existing errors in unrelated files OK.)
11. No regressions in `BrowserViewModel` / `MarkdownViewModel` state shapes — only the prop names at the consumption site change.
12. No `@emotion/styled`, `style=`, `className=` props on the FindBar root or any UIKit child (Rule 7).

## Files Changed (summary)

| File | Status |
|---|---|
| `src/renderer/editors/shared/FindBar.tsx` | **NEW** (~85 lines) |
| `src/renderer/editors/markdown/MarkdownSearchBar.tsx` | **DELETED** |
| `src/renderer/editors/browser/BrowserFindBar.tsx` | **DELETED** |
| `src/renderer/editors/markdown/MarkdownView.tsx` | import path + 7 prop names |
| `src/renderer/editors/browser/BrowserEditorView.tsx` | import path + 7 prop names + add `placeholder` |

## Files NOT Changed

- UIKit (`Panel`, `Input`, `IconButton`, `Text`) — already capable
- Theme tokens / icons — same imports
- `BrowserViewModel`, `MarkdownViewModel`, page state shapes — untouched
- `editors/shared/` siblings (`BaseImageView`, `ColorizedCode`, `link-open-menu`) — untouched
