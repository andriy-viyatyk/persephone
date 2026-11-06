# US-1774: Remove embedded body-view scaffolding

## Goal

Remove unused configuration and registry support for embedding built-in editor bodies, preserving current page behavior. Epic: [EPIC-137](../../epics/EPIC-137.md); research: [US-1770](../US-1770-editor-architecture-simplification/README.md).

## Background

No current `editorConfig` producer or `module.BodyView` reader exists. The five registered bodies are constructed directly by their page views; `src/renderer/editors/about/AboutGuidePageView.ts` also constructs `MarkdownBodyView` with `MarkdownBodyModel`. The Browser's Link body uses its own live `IPageHost` path.

## Implementation Plan

- [x] Delete `src/renderer/editors/base/EditorConfig.ts` and its exports in `src/renderer/editors/base/index.ts`. Remove its import and `BodyView` property from `src/renderer/editors/base/editorRegistry.ts`; correct the `getModule` comment while retaining the accessor.
- [x] Remove `BodyView` entries from `src/renderer/editors/grid/index.ts`, `src/renderer/editors/markdown/index.ts`, `src/renderer/editors/svg/index.ts`, `src/renderer/editors/html/index.ts`, and `src/renderer/editors/mermaid/index.ts`. Remove Markdown's cast and explanatory comment; retain direct body construction and all body classes.
- [x] In `src/renderer/editors/grid/GridBodyView.ts`, remove the prop/import and embedded sizing, `highlightString`, `growToHeight`, `appliedEmbeddedMode`, `lastDisableAutoFocus` and associated update logic. Keep page sizing, sidebar focus guard, and mount's `minHeight: 0` behavior.

```ts
// Before → after, grid root panel
height: editorConfig?.maxEditorHeight !== undefined ? "fit-content" : 200,
// becomes
height: 200,
```

- [x] In `src/renderer/editors/markdown/MarkdownBodyView.ts`, remove embedded sizing/layout bookkeeping, external config highlight and minimap/compact overrides, and the link-click opt-out. Keep model search highlighting, minimap, model compact mode and navigation:

```ts
// Before
const compact = this.props.editorConfig?.compact || this.model.state.get().compactMode;
// After
const compact = this.model.state.get().compactMode;
```

- [x] In `src/renderer/editors/svg/SvgBodyView.ts` and `src/renderer/editors/mermaid/MermaidBodyView.ts`, retain the existing no-config panel layout and remove config plumbing. In `src/renderer/editors/html/HtmlBodyView.ts`, retain the no-config iframe style and remove config and embedded sizing. In `src/renderer/editors/env-vars/EnvVarsBodyView.ts`, remove the prop throughout its subviews and keep the sidebar focus guard.
- [x] Remove the obsolete comment in `src/renderer/editors/about/AboutGuidePageView.ts`. Update `doc/architecture/editors.md`, `doc/architecture/folder-structure.md`, `doc/architecture/overview.md`, `doc/architecture/key-files.md`, `doc/standards/editor-guide.md`, and `doc/standards/model-view-pattern.md` to describe body composition without a registry embedding contract.
- [x] Search for removed symbols, typecheck/build and lint.
- [ ] Manually inspect JSON and CSV grids, Markdown search, links and compact toggle, SVG, HTML, Mermaid, EnvVars, About guides, and Grid with script panel toggled.

## Concerns

Independent of US-1772, US-1773 and US-1775. US-1776 also edits `HtmlBodyView.ts`; either order is valid, but apply changes sequentially to avoid conflicts. The user approved removing future embedding scaffolding. Preserve the separate live `highlightText` navigation API and model-swap handling; neither is this config. No affected scripting, MCP, board bridge or `assets/editor-types/` API was found.

Files needing no change: `src/renderer/editors/markdown/MarkdownBodyModel.ts`, `src/renderer/editors/browser/BrowserView.ts`, `src/renderer/editors/browser/BrowserBookmarks.ts`, `src/renderer/editors/base/editor-switch.ts`, `src/renderer/ui/app/RenderEditorView.ts`, and `src/renderer/api/pages/PagesLifecycleModel.ts` (all retain their existing roles).

## Acceptance Criteria

- [x] No `EditorConfig`, `editorConfig` or registry `BodyView` contract remains; direct body reuse and `getModule` remain functional.
- [ ] Current page layout, focus, search, navigation and previews pass the manual checks and build checks.
- [x] Developer docs no longer advertise the removed embedding contract.

## Files Changed

| File | Change |
|---|---|
| `src/renderer/editors/base/EditorConfig.ts` | Delete |
| `src/renderer/editors/base/index.ts`, `src/renderer/editors/base/editorRegistry.ts` | Remove config exports and module slot |
| `src/renderer/editors/grid/GridBodyView.ts`, `src/renderer/editors/markdown/MarkdownBodyView.ts`, `src/renderer/editors/svg/SvgBodyView.ts`, `src/renderer/editors/mermaid/MermaidBodyView.ts`, `src/renderer/editors/html/HtmlBodyView.ts`, `src/renderer/editors/env-vars/EnvVarsBodyView.ts` | Remove embedded branches |
| `src/renderer/editors/grid/index.ts`, `src/renderer/editors/markdown/index.ts`, `src/renderer/editors/svg/index.ts`, `src/renderer/editors/html/index.ts`, `src/renderer/editors/mermaid/index.ts` | Remove slots and Markdown cast |
| `src/renderer/editors/about/AboutGuidePageView.ts` | Remove obsolete comment |
| `doc/architecture/editors.md`, `doc/architecture/folder-structure.md`, `doc/architecture/overview.md`, `doc/architecture/key-files.md`, `doc/standards/editor-guide.md`, `doc/standards/model-view-pattern.md` | Update contract and file descriptions |

## Implementation notes

- No deviations from the plan.
- Runtime checks require a running app and remain outstanding: JSON and CSV grids, Markdown search, links and compact toggle, SVG, HTML, Mermaid, EnvVars, About guides, and Grid with the script panel toggled.
