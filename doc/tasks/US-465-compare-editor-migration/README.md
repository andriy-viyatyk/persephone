# US-465: CompareEditor — UIKit migration

## Goal

Migrate the diff/compare editor view to a pure UIKit composition. After this task, [src/renderer/editors/compare/CompareEditor.tsx](../../../src/renderer/editors/compare/CompareEditor.tsx) imports zero `@emotion/styled`, sets no `style=`/`className=` on UIKit components, and expresses its layout entirely through `Panel` + `Toolbar` + `Text` + `IconButton`. The Monaco `<DiffEditor>` itself stays unchanged — it is a third-party component that is rendered as-is inside the UIKit-composed shell.

The component **keeps its current external interface** (`CompareEditor` JSX with `model`/`groupedModel` props). Its caller in [Pages.tsx](../../../src/renderer/ui/app/Pages.tsx) is untouched.

This task introduces **no new UIKit primitives or prop extensions** — all required props (`Panel.flex`, `Panel.overflow`, `Panel.justify`, `Toolbar.borderBottom`, `Text.dir` (via `...rest`), `Text.truncate`, `Text.color`, `IconButton.size`, `IconButton.title`) already exist in UIKit. See concern #1.

## Background

### EPIC-025 Phase 4 context

Per-screen migration loop (from [EPIC-025](../../epics/EPIC-025.md) Phase 4):

1. Pick a screen
2. Audit which UIKit components are needed and which are missing
3. Build missing components / prop extensions in Storybook first
4. Rewrite the screen with UIKit
5. Smoke-test the screen

Recent precedents migrating an editor's own `PageToolbar` instance (not portal-injected) to UIKit `Toolbar`:

- [US-455 MermaidView](../US-455-mermaid-view-migration/README.md) — kept the `createPortal` toolbar pattern (per-editor `PageToolbar` migration deferred per [US-450](../US-450-uikit-toolbar/README.md)) and only replaced the inner `Button` children with `IconButton`. **CompareEditor differs**: it renders its own `<PageToolbar>` directly (no portal), so the toolbar element itself is migrated to UIKit `<Toolbar>` here. See concern #2.

### Current implementation

[src/renderer/editors/compare/CompareEditor.tsx](../../../src/renderer/editors/compare/CompareEditor.tsx) — 131 lines. A column flex root with two children: a `<PageToolbar borderBottom>` showing the two file paths flanking a "→" arrow plus an "Exit Compare Mode" icon button, and a `<DiffEditor>` (Monaco diff view) filling the rest.

The toolbar's three text segments use a **`direction: rtl` truncation trick** so long file paths get the ellipsis on the *left* (preserving the filename on the right):

```ts
"& .file-path": {
    flex: "1 1 auto",
    overflow: "hidden",
    direction: "rtl",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    textAlign: "left",
    color: color.text.light,
    "&.file-path-left": {
        textAlign: "right",
    },
},
"& .arrow-icon": {
    margin: "0 8px",
    fontSize: 20,
},
```

Layout responsibilities:

- **Left path** — `flex: 1 1 auto`, RTL-truncated, `text-align: right` so short paths sit close to the arrow.
- **Arrow `→`** — fixed-content span, `font-size: 20`, `margin: 0 8px`.
- **Right path** — `flex: 1 1 auto`, RTL-truncated, `text-align: left` so short paths sit close to the arrow.
- **Exit button** — `<Button size="small" type="icon" title="Exit Compare Mode">` wrapping `<CompareIcon />`. Calls `model.setCompareMode(false)` + `groupedModel.setCompareMode(false)`.

The `CompareEditorModel` (a `TComponentModel`) wires the modified Monaco editor's `onDidChangeModelContent` to `groupedModel.changeContent(newValue, true)` so edits to the right side stream into the grouped model. This logic is unchanged by the migration.

### Audit results — element by element

| Old element | UIKit replacement | Gap |
|---|---|---|
| `CompareEditorRoot` — `styled.div`, `flex: 1 1 auto`, `display: flex`, `flexDirection: column`, `overflow: hidden`, `height: 100%` | `<Panel direction="column" flex overflow="hidden">` | none. `Panel.flex` maps to `flex: 1 1 auto`. The legacy `height: 100%` is redundant alongside `flex: 1 1 auto` in a column-flex parent (PageEditorContainer is itself column-flex with `overflow: hidden`); dropping it has no visual effect. |
| `<PageToolbar borderBottom>` | `<Toolbar borderBottom>` | none. UIKit Toolbar already provides `borderBottom`, `data-type="toolbar"`, `role="toolbar"`, roving tabindex, `gap.sm` between children, and `paddingX="sm"` / `paddingY="xs"` for the same `2px 4px` legacy padding. Per [US-450](../US-450-uikit-toolbar/README.md), the deferral applied to *portal-injected* toolbars (where the surrounding `PageToolbar` is rendered by the page shell). CompareEditor renders its own toolbar inline, so this is a direct in-place swap. |
| `<div className="file-path file-path-left" title={leftLabel}>{leftLabel}</div>` — flex 1, RTL, ellipsis, nowrap, `text-align: right`, `color.text.light` | `<Panel flex overflow="hidden" justify="end"><Text dir="rtl" truncate color="light" title={leftLabel}>{leftLabel}</Text></Panel>` | none. The wrapping `Panel flex overflow="hidden"` provides flex sizing; the inner `Text truncate` enables `display: block`, `overflow: hidden`, `text-overflow: ellipsis`, `white-space: nowrap`, `min-width: 0`. `dir="rtl"` flows through `...rest` (HTMLAttributes includes `dir?: string`) to the rendered `<span>`, flipping the truncation direction so the ellipsis lands on the *left* and the filename stays visible on the right. `Panel.justify="end"` positions short content at the right of the Panel (close to the arrow). See concern #3 for why no `Text.textAlign` prop is needed. |
| `<span className="arrow-icon">→</span>` — `margin: 0 8px`, `font-size: 20`, default text color | `<Text size="xl" color="light">→</Text>` | none. `fontSize.xl = 20` matches legacy. The `margin: 0 8px` is dropped — Toolbar's built-in `gap: gap.sm` (4px) provides spacing. Drift: ~16px less horizontal breathing room around the arrow. Acceptable. |
| `<div className="file-path" title={rightLabel}>{rightLabel}</div>` — flex 1, RTL, ellipsis, nowrap, `text-align: left`, `color.text.light` | `<Panel flex overflow="hidden"><Text dir="rtl" truncate color="light" title={rightLabel}>{rightLabel}</Text></Panel>` | none. Same approach as the left path but with default `Panel.justify="start"` so short paths sit at the left of the Panel (close to the arrow). |
| `<Button size="small" type="icon" title="Exit Compare Mode" onClick={...}><CompareIcon /></Button>` | `<IconButton size="sm" title="Exit Compare Mode" onClick={...} icon={<CompareIcon />} />` | none. `IconButton size="sm"` produces a `24×24` button + `16×16` icon — same as legacy `Button type="icon" size="small"`. Tooltip is rendered via UIKit `<Tooltip>` (auto-wrapped by `IconButton`) instead of the old portal-based component-side `<Tooltip>`. |
| `<DiffEditor>` (raw `@monaco-editor/react`) | unchanged — still `<DiffEditor>` | n/a. Monaco's `<DiffEditor>` is a third-party component, not a UIKit primitive. It renders inside a `<section style={{ width: '100%', height: '100%' }}>` wrapper. Kept as a direct child of the column-flex Panel — same shape as legacy. |

### Rule 7 boundary recap

[uikit/CLAUDE.md Rule 7](../../../src/renderer/uikit/CLAUDE.md) forbids in app code:

1. `import styled from "@emotion/styled"` (absolute)
2. `import { css } from "@emotion/css"` (absolute)
3. `style={…}` on a UIKit component
4. `className={…}` on a UIKit component

It does **not** forbid:

- `style={…}` on raw HTML elements (the migrated file has none — it uses Panel/Toolbar/Text/IconButton throughout)
- importing `color` from `theme/color.ts` (still required only if raw elements appear; this migration removes them)

After migration, `CompareEditor.tsx` contains zero Emotion imports, zero `style=`/`className=` on UIKit components, and zero `color` imports.

### Visual drift accepted in the migration

| Drift | Old | New | Reason |
|---|---|---|---|
| Arrow spacing | `margin: 0 8px` (8 + 4 columnGap = 12px each side) | `gap.sm` (4px each side) | UIKit Toolbar uses a single `gap` between children; per-child margin would require a UIKit extension or raw HTML escape hatch. Visual drift: paths sit ~8px closer to the arrow on each side. Acceptable — typical address-bar-density spacing. |
| Toolbar padding | `padding: 2px 4px` | `paddingY="xs"` (2px) + `paddingX="sm"` (4px) — identical | none. |
| Border color | `color.border.light` | `color.border.light` (default of Panel `borderBottom`) | none. |
| Background | `color.background.dark` | `color.background.dark` (Toolbar default `background="dark"`) | none. |
| File-path color | `color.text.light` via parent CSS rule | `color="light"` on each `<Text>` | none — same theme token, applied per-element instead of via descendant selector. |
| Font sizing | path: inherit (default Toolbar font); arrow: 20px | path: inherit (Text default `size="base"` = 14px); arrow: 20px (`size="xl"`) | none. Both legacy and new render at `fontSize.base = 14` for paths and `fontSize.xl = 20` for the arrow. |

### Files involved

| File | Role | Change |
|------|------|--------|
| [src/renderer/editors/compare/CompareEditor.tsx](../../../src/renderer/editors/compare/CompareEditor.tsx) | Compare editor view | **Rewrite** — same external prop interface and same `CompareEditorModel` lifecycle; internals use `Panel` + `Toolbar` + `Text` + `IconButton`. Drop `@emotion/styled`, `clsx`-style className composition (none used), `color` import, app-side `Button`. |
| [doc/active-work.md](../../active-work.md) | Dashboard | Update the existing US-465 entry to link to this README. |

### Files NOT changed

- [src/renderer/ui/app/Pages.tsx](../../../src/renderer/ui/app/Pages.tsx) — caller of `CompareEditor` at line 90. The external prop interface (`model`, `groupedModel`) is unchanged, so the JSX render is untouched.
- [src/renderer/editors/compare/index.ts](../../../src/renderer/editors/compare/index.ts) — re-exports `CompareEditor` and `CompareEditorProps`. Both names preserved.
- [src/renderer/editors/text/TextEditorModel.ts](../../../src/renderer/editors/text/TextEditorModel.ts) — owns `TextFileModel`, `setCompareMode`, and the `state.use((s) => ({ language, content, filePath, title }))` shape. No model change needed.
- [src/renderer/components/basic/Button.tsx](../../../src/renderer/components/basic/Button.tsx) — legacy app-side `Button` is consumed by 100+ other files. The migrated CompareEditor stops using it; no change to the legacy component itself.
- [src/renderer/editors/base/EditorToolbar.tsx](../../../src/renderer/editors/base/EditorToolbar.tsx) — legacy `PageToolbar` is consumed by 9+ other editors. The migrated CompareEditor stops using it; no change to the legacy component itself.
- [src/renderer/uikit/Panel/Panel.tsx](../../../src/renderer/uikit/Panel/Panel.tsx), [src/renderer/uikit/Toolbar/Toolbar.tsx](../../../src/renderer/uikit/Toolbar/Toolbar.tsx), [src/renderer/uikit/Text/Text.tsx](../../../src/renderer/uikit/Text/Text.tsx), [src/renderer/uikit/IconButton/IconButton.tsx](../../../src/renderer/uikit/IconButton/IconButton.tsx) — already provide every prop this migration needs. No extension required.
- All theme files, tokens, icons, Storybook entries — unchanged.

## Implementation plan

### Step 1 — Rewrite `CompareEditor.tsx`

Replace the entire file body. Same external prop interface and same `CompareEditorModel` class; UIKit internals — `Panel` + `Toolbar` + `Text` + `IconButton`.

Full new content:

```tsx
import * as monaco from "monaco-editor";
import { useEffect } from "react";
import { DiffEditor } from "@monaco-editor/react";
import { TextFileModel } from "../text";
import { Panel, Toolbar, Text, IconButton } from "../../uikit";
import { CompareIcon } from "../../theme/icons";
import { TComponentModel, useComponentModel } from "../../core/state/model";

interface CompareEditorProps {
    model: TextFileModel;
    groupedModel: TextFileModel;
}

class CompareEditorModel extends TComponentModel<null, CompareEditorProps> {
    didChangeSubscription: monaco.IDisposable | null = null;
    editor: monaco.editor.IStandaloneDiffEditor | null = null;

    editorDidMount = (editor: monaco.editor.IStandaloneDiffEditor) => {
        this.editor = editor;
        const modifiedEditor = editor.getModifiedEditor();
        this.didChangeSubscription = modifiedEditor.onDidChangeModelContent(
            () => {
                const newValue = modifiedEditor.getValue();
                this.props.groupedModel.changeContent(newValue, true);
            },
        );
    };

    dispose() {
        this.didChangeSubscription?.dispose();
        this.editor?.dispose();
        this.editor = null;
    }
}

export function CompareEditor(props: CompareEditorProps) {
    const { model, groupedModel } = props;
    const editorModel = useComponentModel(props, CompareEditorModel, null);

    const { language, content, filePath, title } = model.state.use((s) => ({
        language: s.language,
        content: s.content,
        filePath: s.filePath,
        title: s.title,
    }));
    const { groupedContent, groupedFilePath, groupedTitle } =
        groupedModel.state.use((s) => ({
            groupedContent: s.content,
            groupedFilePath: s.filePath,
            groupedTitle: s.title,
        }));

    useEffect(() => {
        return () => {
            editorModel.dispose();
        };
    }, []);

    const leftLabel = filePath || title;
    const rightLabel = groupedFilePath || groupedTitle;

    return (
        <Panel direction="column" flex overflow="hidden">
            <Toolbar borderBottom>
                <Panel flex overflow="hidden" justify="end">
                    <Text
                        dir="rtl"
                        truncate
                        color="light"
                        title={leftLabel}
                    >
                        {leftLabel}
                    </Text>
                </Panel>
                <Text size="xl" color="light">→</Text>
                <Panel flex overflow="hidden">
                    <Text
                        dir="rtl"
                        truncate
                        color="light"
                        title={rightLabel}
                    >
                        {rightLabel}
                    </Text>
                </Panel>
                <IconButton
                    size="sm"
                    title="Exit Compare Mode"
                    onClick={() => {
                        model.setCompareMode(false);
                        groupedModel.setCompareMode(false);
                    }}
                    icon={<CompareIcon />}
                />
            </Toolbar>
            <DiffEditor
                language={language}
                original={content}
                modified={groupedContent}
                onMount={editorModel.editorDidMount}
                options={{
                    readOnly: false,
                    renderSideBySide: true,
                    automaticLayout: true,
                }}
                theme="custom-dark"
            />
        </Panel>
    );
}

export type { CompareEditorProps };
```

Notes:

- The two file-path Panels each use `flex overflow="hidden"` to provide flex sizing for the inner `<Text truncate>`. The Text fills the Panel via flex layout (default `flex: 0 1 auto` + `min-width: 0` from `truncate`) and ellipsizes when content overflows.
- `dir="rtl"` on Text flows through HTMLAttributes `...rest` to the underlying `<span>`. Combined with `truncate` (`white-space: nowrap`, `text-overflow: ellipsis`), this places the ellipsis on the visual *left* — preserving the filename at the right edge of the truncated path.
- `Panel.justify="end"` on the LEFT-path wrapper positions short paths at the right of the Panel (close to the arrow). The default `justify="start"` on the right-path wrapper positions short paths at the left of the Panel (also close to the arrow). For paths longer than the Panel, `justify` has no effect because the Text fills the Panel exactly.
- `<Text size="xl">→</Text>` for the arrow: `fontSize.xl = 20` matches legacy `font-size: 20`. Toolbar's built-in `gap.sm` (4px) replaces the legacy `margin: 0 8px`.
- `<IconButton size="sm" title="Exit Compare Mode" icon={<CompareIcon />}>` matches the legacy `<Button size="small" type="icon" title=...>`. UIKit's IconButton wraps the button in `<Tooltip>` automatically when `title` is set, replacing the legacy `Tooltip` mechanism.
- `<DiffEditor>` is rendered as a direct child of the column-flex Panel, exactly as in the legacy. Monaco's wrapper `<section style={{ width: '100%', height: '100%' }}>` plus `automaticLayout: true` handles sizing inside the column-flex parent.
- `CompareEditorModel` (the `TComponentModel`) and its `editorDidMount` / `dispose` lifecycle are unchanged.

### Step 2 — Verify caller in `Pages.tsx`

[src/renderer/ui/app/Pages.tsx](../../../src/renderer/ui/app/Pages.tsx) at line 90 — confirm `<CompareEditor model={editor} groupedModel={rightEditor} />` continues to typecheck. No code change expected. The exported types (`CompareEditor`, `CompareEditorProps`) are unchanged.

### Step 3 — Update dashboard

[doc/active-work.md](../../active-work.md): change the existing line

```md
  - [ ] US-465: CompareEditor — UIKit migration *(Phase 4 — per-screen migration)*
```

to a link:

```md
  - [ ] [US-465: CompareEditor — UIKit migration](tasks/US-465-compare-editor-migration/README.md) *(Phase 4 — per-screen migration)*
```

### Step 4 — TypeScript check

Run `npx tsc --noEmit` and confirm no new errors on:

- `src/renderer/editors/compare/CompareEditor.tsx`
- `src/renderer/editors/compare/index.ts`
- `src/renderer/ui/app/Pages.tsx`

Specific things to verify:

- `<Text dir="rtl" truncate color="light" title=...>` typechecks (`dir` is on `React.HTMLAttributes<HTMLSpanElement>`, forwarded via `...rest`).
- `<IconButton size="sm" title="..." onClick={...} icon={<CompareIcon />} />` typechecks.
- `<Toolbar borderBottom>` typechecks.
- `<Panel direction="column" flex overflow="hidden">` and `<Panel flex overflow="hidden" justify="end">` typecheck.
- `CompareEditorModel`'s class extension of `TComponentModel<null, CompareEditorProps>` and the `props.groupedModel.changeContent(...)` call typecheck (unchanged from legacy).

### Step 5 — Manual smoke test (user)

User performs the smoke checks listed in Acceptance Criteria below.

## Concerns / Open questions

All resolved before implementation.

### 1. Why no UIKit extension in this task? — RESOLVED: every prop is already in UIKit

The audit checked each legacy CSS rule against existing UIKit primitives:

- `flex: 1 1 auto` → `Panel.flex` (boolean / number / string passthrough)
- `display: flex; flex-direction: column` → `Panel direction="column"`
- `overflow: hidden` → `Panel.overflow="hidden"`
- `border-bottom: 1px solid color.border.light` → `Toolbar.borderBottom` (already in UIKit Toolbar from US-450)
- `direction: rtl` (truncation direction) → `dir="rtl"` HTML attribute, already on `Text` via HTMLAttributes `...rest`
- `text-overflow: ellipsis; white-space: nowrap; overflow: hidden; min-width: 0` → `Text.truncate`
- `text-align: right` (left path), `text-align: left` (right path) → handled by `Panel.justify="end"` / `justify="start"` on the wrapping flex Panel — when the inner `Text` is content-sized (flex-grow: 0, content fits), the Panel's `justify` controls Text's position. When the inner Text is shrunk to Panel size (content overflows), the truncation+RTL direction owns alignment naturally. **No `Text.textAlign` prop is required.** See concern #3 for the full reasoning.
- `color: color.text.light` → `Text.color="light"`
- `font-size: 20` (arrow) → `Text.size="xl"` (`fontSize.xl = 20`)
- `Button size="small" type="icon"` → `IconButton size="sm"`
- `Button title="..."` → `IconButton title="..."` (UIKit IconButton auto-wraps in Tooltip)

All gaps closed by existing UIKit. No new component or prop is added in this task.

### 2. Does this task migrate `PageToolbar`, given US-450 deferred per-editor migration? — RESOLVED: yes, only for this editor

[US-450](../US-450-uikit-toolbar/README.md) deferred *per-editor* `PageToolbar` migration because most editors render their toolbar contents via `createPortal(..., model.editorToolbarRefLast)` into a parent-shell-owned `PageToolbar` host. Migrating those editors to UIKit `Toolbar` would require coordinated changes to the page-shell host and to every portal contributor.

CompareEditor does not use the portal pattern. It renders `<PageToolbar borderBottom>` directly as the first child of its own root, so the toolbar element belongs to CompareEditor — not to the page shell. The in-place `PageToolbar` → `Toolbar` swap is local to this file and changes nothing else. Other editors (text, browser, archive, video, pdf, mcp-inspector, image, category) keep their `PageToolbar` until each one's per-screen migration task lands.

### 3. Why not add `Text.textAlign` for the file-path alignment? — RESOLVED: `Panel.justify` covers it

Initial reading suggested `text-align` was required to position short content within the truncated `<Text>`. On closer inspection it is not, because of how `display: block` interacts with flex layout:

When a `<Text truncate dir="rtl">` is the only child of `<Panel flex overflow="hidden">`:

- The Text is a flex item with the default `flex: 0 1 auto` (flex-grow: 0, flex-shrink: 1, flex-basis: auto).
- **Short content (Text content fits inside Panel):** flex-grow: 0 means Text does not stretch; Text's main-axis size equals its content size. The Text element is positioned within Panel by `justify-content`. With `Panel.justify="end"`, the Text sits at the right of the Panel. With default `justify="start"`, it sits at the left.
- **Long content (Text content overflows Panel):** flex-shrink: 1 + `min-width: 0` (from `truncate`) lets the Text shrink to Panel size. The Text fills the Panel exactly; `justify` has no remaining slack to apply. Truncation kicks in: with `dir="rtl"`, `text-overflow: ellipsis` places the ellipsis at the *visual left* (logical end in RTL), preserving the filename at the visual right.

Combined behavior:

| Path length | Side | Wrapper `Panel.justify` | Visual |
|---|---|---|---|
| Short | Left | `"end"` | Path sits at right of left column, near the arrow |
| Long  | Left | `"end"` (no effect) | Path fills column, ellipsis on left, filename on right |
| Short | Right | `"start"` (default) | Path sits at left of right column, near the arrow |
| Long  | Right | `"start"` (no effect) | Path fills column, ellipsis on left, filename on right |

This matches the legacy visual (legacy used `text-align: right` / `text-align: left` plus `direction: rtl`). No new prop needed.

### 4. Where does the file-path tooltip come from? — RESOLVED: native HTML `title`, forwarded via `...rest`

The legacy uses the native HTML `title` attribute on the path `<div>` for hover tooltips (browser-native, not the app's `<Tooltip>` component). UIKit's `Text` extends `Omit<React.HTMLAttributes<HTMLSpanElement>, "style" | "className" | "color">` — `title?: string` is on `HTMLAttributes` and flows through `...rest` to the rendered `<span>`. So `<Text title={leftLabel}>...</Text>` produces a native browser tooltip identical to the legacy. No change to the tooltip mechanism.

The IconButton's tooltip is the *app's* `<Tooltip>`, auto-wrapped by IconButton when `title` is set — that is also identical in shape to legacy `<Button title=...>` which used the same mechanism.

### 5. Does `<DiffEditor>` need a wrapping Panel? — RESOLVED: no

`@monaco-editor/react`'s `<DiffEditor>` renders a wrapper `<section>` with `style={{ display: 'flex', position: 'relative', width: '100%', height: '100%' }}`. As the second child of a column-flex parent (the migrated outer Panel), it sizes to fill remaining space the same way it does in the legacy — where `<DiffEditor>` is also a direct child of `CompareEditorRoot` (a column-flex div with `overflow: hidden`). No wrapping Panel is needed; adding one would just add a div with no observable effect.

`automaticLayout: true` on Monaco handles parent-resize observation, so even when the toolbar height changes (e.g. theme change shifting font metrics) the editor relays out correctly.

### 6. The `arrow` is a `<Text>` rather than an icon — preserve the legacy character `→`? — RESOLVED: yes

The legacy uses the literal Unicode character `→` (U+2192 RIGHTWARDS ARROW), rendered with `font-size: 20` and the default text color. The migrated version uses the same character inside a `<Text size="xl" color="light">` — rendered identically. We do not switch to an icon-font version because the character is already visually correct, the `color="light"` matches the legacy's defaulted-to-`color.text.light` adjacency to the file-path colors, and the migration scope is "no visual drift beyond what's documented in the table".

### 7. Why is `position: relative` not on the outer Panel? — RESOLVED: not needed

Some editors (e.g. MermaidView) set `position: relative` on the column-flex root because they overlay loading spinners absolutely. CompareEditor has no overlays — only the toolbar and the diff editor stacked vertically. `position: relative` is unnecessary and would be cargo-cult. Skipped.

### 8. The `CompareEditorModel` lifecycle — preserve? — RESOLVED: unchanged

The `TComponentModel` subclass owning the Monaco diff editor's `onDidChangeModelContent` subscription and `dispose()` cleanup is preserved verbatim. The migration only changes the JSX returned by the function component. The hook usage (`useComponentModel(props, CompareEditorModel, null)`, the `useEffect` cleanup) is unchanged.

## Acceptance criteria

1. `CompareEditor.tsx` contains zero `@emotion/styled` imports, zero `clsx` imports, zero `color`-import references, zero `style=`/`className=` on UIKit components.
2. `CompareEditor.tsx` exports `CompareEditor` and `CompareEditorProps` with the same external prop signature as today (`model: TextFileModel`, `groupedModel: TextFileModel`).
3. `CompareEditor.tsx`'s only React-component imports are: `DiffEditor` from `@monaco-editor/react`, `Panel` / `Toolbar` / `Text` / `IconButton` from `../../uikit`, `CompareIcon` from theme icons, and the `TComponentModel` / `useComponentModel` core-state primitives (unchanged from legacy).
4. `CompareEditorModel` class is preserved verbatim — `editorDidMount`, `didChangeSubscription`, `editor`, and `dispose()` unchanged.
5. `Pages.tsx` is unchanged — same JSX render of `<CompareEditor model={editor} groupedModel={rightEditor} />` at line 90 still typechecks and runs.
6. `npx tsc --noEmit` reports no new errors on `CompareEditor.tsx`, `compare/index.ts`, or `Pages.tsx`.
7. **Smoke — enter compare mode**: With two text-file pages grouped, click the compare-mode toolbar button on the left page (or invoke `model.setCompareMode(true)` on both). The page area replaces with `CompareEditor` showing the toolbar at top and the Monaco diff editor below.
8. **Smoke — file paths show with correct alignment**: Toolbar shows `leftLabel → rightLabel`. The left label sits at the right edge of its flex column (close to the arrow); the right label sits at the left edge of its flex column (close to the arrow). The arrow is centered between them.
9. **Smoke — RTL truncation**: Open a compare with at least one *long* file path (e.g. `D:/projects/persephone/src/renderer/editors/very/deep/folder/structure/file.tsx`). The path renders with the *ellipsis at the left* and the filename visible at the right. Hovering the path shows the full path in the native browser tooltip.
10. **Smoke — light-color file paths**: Both file-path texts render in `color.text.light` (visibly dimmer than the diff editor's text color); the arrow renders in the same light color. Cycle themes (`default-dark`, `light-modern`, `monokai`) — colors track the theme.
11. **Smoke — exit compare mode**: Click the right-most toolbar `IconButton` (compare icon, tooltip "Exit Compare Mode"). Both `model.setCompareMode(false)` and `groupedModel.setCompareMode(false)` fire; the page area returns to the regular grouped-tabs view.
12. **Smoke — diff editor edits stream into grouped model**: Type into the right (modified) side of the diff editor. The grouped model's content updates (`groupedModel.changeContent(newValue, true)` is called for each change). Cancel out of compare mode, switch to the right tab, and confirm the typed change is present.
13. **Smoke — theme switching**: While in compare mode, switch app theme. Toolbar background, border, file-path colors, arrow color, and exit-button icon color all update to match the new theme. Monaco re-renders with `theme="custom-dark"` (legacy already pinned to dark — unchanged).
14. **Smoke — DevTools**: Inspect the compare editor. Outer root is `<div data-type="panel" data-direction="column">`. Toolbar is `<div data-type="toolbar" role="toolbar" data-orientation="horizontal" data-bg="dark">`. Each file-path wrapper is `<div data-type="panel" data-direction="row">` containing `<span data-type="text" data-color="light" data-truncate dir="rtl" title="...">`. Arrow is `<span data-type="text" data-size="xl" data-color="light">→</span>`. Exit button is `<button data-type="icon-button" data-size="sm">` followed by the UIKit-managed Tooltip portal node when hovered. The diff editor is the Monaco-managed `<section>` filling the rest.
15. **Smoke — keyboard focus**: Tab into the toolbar — focus lands on the IconButton (the only focusable child). Tab again — focus exits the toolbar. Roving tabindex within the toolbar collapses to a single stop because there is only one focusable child. Verifiable: `document.activeElement === iconButton` after one Tab from a focusable predecessor.
16. **Smoke — short paths**: Open a compare with two short titles (e.g. unsaved tabs `Untitled-1` and `Untitled-2`). Left title sits at the right of its column near the arrow; right title sits at the left of its column near the arrow; no ellipsis appears.

## Files Changed summary

| File | Action | Notes |
|------|--------|-------|
| [src/renderer/editors/compare/CompareEditor.tsx](../../../src/renderer/editors/compare/CompareEditor.tsx) | Rewrite | Same external prop interface and same `CompareEditorModel` lifecycle. UIKit composition (`Panel` + `Toolbar` + `Text` + `IconButton`). Drops `@emotion/styled`, `color` import, app-side `Button`, `clsx`-style className composition. |
| [doc/active-work.md](../../active-work.md) | Update | Change the existing US-465 line to link to this README. |
