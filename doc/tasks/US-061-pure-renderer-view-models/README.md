# US-061: Pure Renderer ViewModels (SVG, HTML, Mermaid)

## Overview

Create `ContentViewModel` wrappers for the three pure renderer content-views: SVG View, HTML View, and Mermaid View.

This is **Task 8** in the content view models migration ([9.content-view-models.md](../../future-architecture/migration/9.content-view-models.md)).

## Current State

All three are **read-only** content-views that render a transformed view of `TextFileModel.content`. None currently have ContentViewModels or use `useComponentModel`.

### SVG View (`SvgView.tsx`, ~50 lines)
- Reads `model.state.use(s => s.content)` → builds `data:image/svg+xml,...` URL
- No local state (only a `useRef` for BaseImageView)
- One portal button: Copy to Clipboard
- Child: `BaseImageView` (has its own internal `ImageViewModel`)

### HTML View (`HtmlView.tsx`, ~53 lines)
- Reads `model.state.use(s => s.content)` → injects into `<iframe srcDoc>`
- No local state (`useMemo` for content + navigation blocker script)
- No portal buttons, no child components

### Mermaid View (`MermaidView.tsx`, ~125 lines)
- Reads `model.state.use(s => s.content)` → async `renderMermaid()` → SVG data URL
- **4 useState hooks**: `svgUrl`, `error`, `loading`, `lightMode`
- 400ms debounced rendering via `useEffect` + `setTimeout`
- Two portal buttons: Theme Toggle (light/dark), Copy to Clipboard
- Child: `BaseImageView`, `EditorError`, `CircularProgress`

## Design Decisions

### SVG & HTML: Near-empty ViewModels

These ViewModels have no meaningful state to manage. They exist for:
1. **Pattern consistency** — all content-views follow the same `useContentViewModel` pattern
2. **`pageModel` getter** — needed for Task 10 (script interfaces)
3. **Future extensibility** — e.g., SVG might get zoom persistence, HTML might get dev tools

Both implement `onInit()` and `onContentChanged()` as no-ops. The component still reads content from `model.state.use()`.

### Mermaid: Meaningful ViewModel

MermaidViewModel manages actual rendering state:

| State field | Purpose |
|-------------|---------|
| `svgUrl` | Rendered SVG data URL |
| `error` | Render error message |
| `loading` | Async rendering in progress |
| `lightMode` | User-togglable theme (initial from `isCurrentThemeDark()`) |

### Mermaid `lightMode` initialization

`lightMode` initial value depends on runtime theme detection (`isCurrentThemeDark()`). Set in `onInit()` rather than static default, since the default state object is defined at import time.

### Mermaid debounced rendering

Current `useEffect` + `setTimeout(400ms)` pattern moves to ViewModel:
- `onContentChanged(content)` → triggers debounced render
- `state.subscribe()` in `onInit()` watches `lightMode` changes → triggers debounced render
- `addSubscription()` for cleanup of pending timeout on dispose

### Portal refs unchanged

All three components still receive `model: TextFileModel` prop for portal ref access (`model.editorToolbarRefLast`). Same pattern as `MarkdownView`.

### `effect()` → ViewModel mapping

| Current (React) | New (ViewModel) |
|-----------------|-----------------|
| SVG: none | No-op `onContentChanged()` |
| HTML: `useMemo` for safeSrcDoc | Stays in component (pure rendering concern) |
| Mermaid: `useEffect` with debounced render | `onContentChanged()` + `state.subscribe()` for `lightMode` |

## Scope

### Files to create

| File | Purpose |
|------|---------|
| `src/renderer/editors/svg/SvgViewModel.ts` | Thin ViewModel (~20 lines) |
| `src/renderer/editors/html/HtmlViewModel.ts` | Thin ViewModel (~20 lines) |
| `src/renderer/editors/mermaid/MermaidViewModel.ts` | ViewModel with render state (~80 lines) |

### Files to modify

| File | Changes |
|------|---------|
| `src/renderer/editors/svg/SvgView.tsx` | Add `useContentViewModel` + `useSyncExternalStore`, guard `if (!vm) return null` |
| `src/renderer/editors/html/HtmlView.tsx` | Add `useContentViewModel` + `useSyncExternalStore`, guard `if (!vm) return null` |
| `src/renderer/editors/mermaid/MermaidView.tsx` | Replace 4x `useState` + `useEffect` with `useContentViewModel` + `useSyncExternalStore` |
| `src/renderer/editors/register-editors.ts` | Add `createViewModel` factory for all three registrations |

### Files unchanged

| File | Reason |
|------|--------|
| `render-mermaid.ts` | Utility module — no model dependency |
| `BaseImageView` | Has own internal model — no changes |
| `EditorError`, `CircularProgress` | Stateless UI components |

## Implementation Steps

### Step 1: Create SvgViewModel.ts

- [ ] Create `SvgViewModel extends ContentViewModel<SvgViewState>`
- [ ] Empty state `{}` (no meaningful state to manage)
- [ ] `onInit()` — no-op
- [ ] `onContentChanged()` — no-op
- [ ] `pageModel` getter for script context access
- [ ] Export factory: `createSvgViewModel(host: IContentHost)`

### Step 2: Update SvgView component

- [ ] Add `useContentViewModel<SvgViewModel>(model, "svg-view")` + `useSyncExternalStore`
- [ ] Guard `if (!vm) return null` before render
- [ ] Keep `model.state.use()` for content (host state, not VM state)
- [ ] Keep `model.editorToolbarRefLast` for portal buttons

### Step 3: Create HtmlViewModel.ts

- [ ] Create `HtmlViewModel extends ContentViewModel<HtmlViewState>`
- [ ] Empty state `{}` (no meaningful state to manage)
- [ ] `onInit()` — no-op
- [ ] `onContentChanged()` — no-op
- [ ] `pageModel` getter for script context access
- [ ] Export factory: `createHtmlViewModel(host: IContentHost)`

### Step 4: Update HtmlView component

- [ ] Add `useContentViewModel<HtmlViewModel>(model, "html-view")` + `useSyncExternalStore`
- [ ] Guard `if (!vm) return null` before render
- [ ] Keep `model.state.use()` for content
- [ ] Keep `useMemo` for `safeSrcDoc` (pure rendering concern)

### Step 5: Create MermaidViewModel.ts

- [ ] Create `MermaidViewModel extends ContentViewModel<MermaidViewState>`
- [ ] State: `{ svgUrl: string, error: string, loading: boolean, lightMode: boolean }`
- [ ] `onInit()`:
  - Set `lightMode` from `isCurrentThemeDark()`
  - Trigger initial render via `renderDebounced()`
  - Subscribe to `this.state` for `lightMode` changes → `renderDebounced()`
- [ ] `onContentChanged(content)` → `renderDebounced()`
- [ ] `renderDebounced()` — 400ms setTimeout, calls `renderMermaid(content, lightMode)`
- [ ] `onDispose()` — clear pending timeout
- [ ] `toggleLightMode()` — toggles `lightMode` state
- [ ] `pageModel` getter for script context access
- [ ] Export factory: `createMermaidViewModel(host: IContentHost)`

### Step 6: Update MermaidView component

- [ ] Replace 4x `useState` + `useEffect` with `useContentViewModel` + `useSyncExternalStore`
- [ ] Read `svgUrl`, `error`, `loading`, `lightMode` from VM state
- [ ] Theme toggle button calls `vm.toggleLightMode()`
- [ ] Guard `if (!vm) return null` before render
- [ ] Keep `model.editorToolbarRefLast` for portal buttons
- [ ] Remove `useEffect` debounce block entirely (moved to VM)

### Step 7: Register factories in register-editors.ts

- [ ] `"svg-view"`: add `createViewModel: createSvgViewModel` to module return
- [ ] `"html-view"`: add `createViewModel: createHtmlViewModel` to module return
- [ ] `"mermaid-view"`: add `createViewModel: createMermaidViewModel` to module return

## Test Checklist

- [ ] Open `.svg` file — preview renders correctly, copy button works
- [ ] Open `.html` file — preview renders in iframe, links blocked
- [ ] Open `.mmd`/`.mermaid` file — diagram renders after debounce
- [ ] Mermaid theme toggle — switches between light/dark rendering
- [ ] Mermaid error handling — invalid syntax shows error message
- [ ] Mermaid loading indicator — shows during async render
- [ ] Mermaid copy button — copies rendered image to clipboard
- [ ] Switch to Monaco and back — all three previews re-render correctly
- [ ] Edit content in Monaco → switch to preview — updated content shows

## Concerns

### 1. Empty ViewModels add code with no functional benefit

**Status: Accepted**

SVG and HTML ViewModels are nearly empty. The overhead is ~20 lines each + factory registration. Justified by pattern consistency, `pageModel` getter for script context (Task 10), and future extensibility.

### 2. Mermaid content access in ViewModel

**Status: Resolved**

`onContentChanged(content)` receives the new content string directly. For the debounced render, we need the *latest* content, not stale closure content. Solution: read `this.host.state.get().content` inside the render function (same pattern as other ViewModels).

### 3. Mermaid `renderMermaid` is async and updates state

**Status: Resolved**

The async render updates `svgUrl`, `error`, `loading` via `this.state.update()`. Since ContentViewModel state is not tied to React lifecycle, there's no "setState after unmount" risk. If disposed during render, the state update is harmless (no subscribers).

### 4. `isCurrentThemeDark()` in MermaidViewModel

**Status: Resolved**

Called once in `onInit()` to set the initial `lightMode` value. After that, user controls it via toggle button. No need to subscribe to theme changes — the user explicitly chose light/dark for the diagram.

## Related

- Foundation: [US-052](../US-052-content-view-models-foundation/)
- MarkdownViewModel (closest reference — read-only content-view): [US-059](../US-059-markdown-view-model/)
- Architecture: [9.content-view-models.md](../../future-architecture/migration/9.content-view-models.md)
