# US-059: MarkdownViewModel (Markdown ContentViewModel)

## Overview

Refactor the inline `MarkdownViewModel` (currently inside `MarkdownView.tsx`, extends `TComponentModel`) into a standalone `MarkdownViewModel extends ContentViewModel<MarkdownViewState>`.

This is **Task 6** in the content view models migration ([9.content-view-models.md](../../future-architecture/migration/9.content-view-models.md)).

## Current State

- `MarkdownViewModel` lives **inline** in `MarkdownView.tsx` (lines 395-558)
- Extends `TComponentModel<MarkdownViewState, MarkdownViewProps>`
- Created via `useComponentModel(props, MarkdownViewModel, defaultMarkdownViewState)`
- **Read-only** — renders markdown content, never saves/modifies it
- Has Ctrl+F search with DOM-based highlight navigation
- Has scroll position persistence (plain field, restored on page focus)
- Has compact mode toggle
- No embedded editors, no sub-view-models

## Design Decisions

### Host access mapping

| Current (TComponentModel) | New (ContentViewModel) |
|---------------------------|------------------------|
| `this.props.model` | `this.host` |
| `this.props.model.state.get().content` | `this.host.state.get().content` |
| `model.state.use(s => s.content)` | read via `useSyncExternalStore` on vm.state or keep direct model subscription |

### Read-only editor — no `onContentChanged` needed

Unlike Grid/Notebook/Todo ViewModels, the markdown preview **doesn't parse content into internal state**. It passes `content` directly to `<ReactMarkdown>`. The component reads content directly from `model.state` (the TextFileModel), not from the ViewModel state.

The `onContentChanged(content)` override will be minimal — only needed to trigger search re-evaluation when content changes while search is active. The component still reads `content` directly from `model.state.use()`.

### Container DOM ref — keep as plain field

The current model stores `container` (HTMLDivElement) in reactive state for search DOM operations. Since search navigation methods need the container but it's not a rendering concern, switch to a **plain field** (like `containerSrollTop` already is). The component passes the ref via a setter method.

### `effect()` replacement

TComponentModel provides `effect(callback, depsFactory)` for dependency-tracked side effects. ContentViewModel doesn't have this. The two current effects:

1. **`pagesModel.onFocus` subscription** (no deps = runs once) → `addSubscription()` in `onInit()`
2. **Search update on content/search changes** (deps: searchText, searchVisible, content) → Subscribe to `this.state` + `this.host.state` in `onInit()`, check specific fields changed

### `pageModel` getter for script context

Same as Notebook/Todo — provide `get pageModel(): TextFileModel` for potential script context access.

## Scope

### Files to create

| File | Purpose |
|------|---------|
| `src/renderer/editors/markdown/MarkdownViewModel.ts` | ViewModel extracted from MarkdownView.tsx |

### Files to modify

| File | Changes |
|------|---------|
| `src/renderer/editors/markdown/MarkdownView.tsx` | Remove inline model class, use `useContentViewModel` + `useSyncExternalStore` |
| `src/renderer/editors/register-editors.ts` | Add `createViewModel` factory for `"md-view"` |

### Files unchanged

| File | Reason |
|------|--------|
| `MarkdownSearchBar.tsx` | Stateless component, receives all data via props — no changes needed |
| `CodeBlock.tsx` | Independent rendering components — no model dependency |
| `rehypeHighlight.ts` | Pure function, no model dependency |
| `index.ts` | Re-exports — may need minor update if export names change |

## Implementation Steps

### Step 1: Create MarkdownViewModel.ts

- [ ] Create `MarkdownViewModel extends ContentViewModel<MarkdownViewState>`
- [ ] Move state type + default from MarkdownView.tsx
- [ ] Remove `container` from reactive state — make it a plain field with getter/setter
- [ ] Keep `containerSrollTop` as plain field (already is)
- [ ] Implement `onInit()`:
  - Subscribe to `pagesModel.onFocus` for scroll restoration (via `addSubscription`)
  - Subscribe to `this.state` + `this.host.state` for search highlight updates (replaces `effect` with deps)
- [ ] Implement `onContentChanged(content)` — minimal: trigger search re-evaluation if search is active
- [ ] Move all methods: `setContainer`, `pageFocused`, `containerScroll`, `toggleCompact`, search methods
- [ ] Replace `this.props.model` → `this.host` (for identity comparison in `pageFocused`)
- [ ] Add `pageModel` getter for script context access
- [ ] Export factory: `createMarkdownViewModel(host: IContentHost) => new MarkdownViewModel(host)`

### Step 2: Update MarkdownView component

- [ ] Remove inline `MarkdownViewModel` class, `defaultMarkdownViewState`, `MarkdownViewState` type
- [ ] Replace `useComponentModel(props, MarkdownViewModel, defaultMarkdownViewState)` with `useContentViewModel<MarkdownViewModel>(model, "md-view")`
- [ ] Subscribe to ViewModel state via `useSyncExternalStore` (unconditional, with noop fallback when vm is null)
- [ ] Keep direct `model.state.use()` for `content` and `filePath` (read-only, no need to duplicate in VM state)
- [ ] Update all `pageModel.xxx` → `vm.xxx` references
- [ ] Handle `vm === null` (loading state) — return null before render

### Step 3: Register factory in register-editors.ts

- [ ] Add parallel import of `MarkdownViewModel` in `"md-view"` loadModule
- [ ] Add `createViewModel: createMarkdownViewModel` to the module return

### Step 4: Update index.ts (if needed)

- [ ] Update re-exports if any exported names changed

## Test Checklist

- [ ] Markdown preview renders correctly
- [ ] Ctrl+F search opens, highlights matches, navigates with F3/Shift+F3
- [ ] Search closes with Escape, clears highlights
- [ ] External highlight text (from notebook) works
- [ ] Compact mode toggles via toolbar button
- [ ] Scroll position restored when switching tabs and coming back
- [ ] Minimap renders correctly
- [ ] Context menu on links shows "Copy Link" + open options
- [ ] Mermaid diagrams render with correct theme (light/dark)
- [ ] Code blocks have syntax highlighting and copy button
- [ ] Switch to Monaco editor and back preserves search state (NEW benefit)

## Concerns

### 1. Search DOM manipulation needs container reference

**Status: Resolved**

Search navigation (`navigateToMatch`, `scrollToActiveMatch`, etc.) requires a DOM element reference. Current model stores it in reactive state. Plan: switch to plain field with setter — the component calls `vm.setContainer(el)` via ref callback, same as now. The search methods access `this._container` directly.

### 2. Search update effect replacement

**Status: Resolved**

The current `effect()` with deps `[searchText, searchVisible, content]` auto-re-runs when any dep changes. ContentViewModel doesn't have `effect()`. Plan: in `onInit()`, subscribe to both `this.state` and `this.host.state`, track previous values of relevant fields, and call `updateMatchNavigation()` via `setTimeout(0)` when they change (same timing as current implementation).

### 3. No embedded editors — simplest migration yet

**Status: Non-issue**

Unlike Notebook (embedded grid/markdown) or even Todo (lists, tags, items), the Markdown preview is purely a renderer. No sub-view-models, no content parsing to internal state, no two-way data binding. This is the simplest ContentViewModel migration.

## Related

- Foundation: [US-052](../US-052-content-view-models-foundation/)
- TextViewModel (first reference): [US-055](../US-055-text-view-model/)
- GridViewModel (second reference): [US-056](../US-056-grid-view-model/)
- NotebookViewModel (direct pattern): [US-057](../US-057-notebook-view-model/)
- TodoViewModel (previous migration): [US-058](../US-058-todo-view-model/)
- Architecture: [9.content-view-models.md](../../future-architecture/migration/9.content-view-models.md)
