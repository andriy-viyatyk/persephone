# EPIC-007: Drawing Editor (Excalidraw)

## Status

**Status:** Active
**Created:** 2026-03-17

## Overview

Add a drawing/sketching editor to js-notepad by embedding [Excalidraw](https://github.com/excalidraw/excalidraw) — an open-source, hand-drawn style whiteboard tool. This gives developers a quick way to sketch architecture diagrams, flowcharts, and visual notes directly inside the notepad. The editor stores drawings in Excalidraw's native JSON format as `.excalidraw` files.

## Goals

- Embed the Excalidraw React component as a new page-editor for `.excalidraw` files
- Support dark/light theme matching js-notepad's active theme
- Handle file I/O through js-notepad's `page.content` (not Excalidraw's built-in file dialogs)
- Provide SVG/PNG export via toolbar or context actions
- Expose a scripting API for programmatic drawing creation

## Why Excalidraw

Evaluated alternatives:
- **Fabric.js** — canvas-based, good SVG I/O, but no editor UI (would need to build everything from scratch)
- **SVG-Edit** — full SVG editor, but ~38 MB bundle, dated UI, too complex for quick sketches
- **Custom SVG editor** — feasible but 10-15 tasks of custom UI work for basic parity

Excalidraw wins because:
- MIT license, React-native component, actively maintained
- Simple, intuitive UI ideal for developer sketches
- Built-in: shapes, arrows, connectors, freehand drawing, line-to-curve bending, text
- Supports React 19 (js-notepad's version)
- JSON format — clean round-trip through `page.content`

## Technical Notes

### Excalidraw Integration

- **Package:** `@excalidraw/excalidraw` (v0.18.0+, ESM, ~1-2 MB bundled)
- **Component:** Uncontrolled — pass `initialData` on mount, use `excalidrawAPI` ref for updates
- **Theme:** `theme` prop accepts `"dark"` | `"light"` — sync with js-notepad theme
- **Serialization:** `serializeAsJSON()` and `restore()` utilities for round-tripping
- **Export:** `exportToSvg()`, `exportToBlob()` for SVG/PNG export
- **Electron caveats:** Built-in file save/load doesn't work in Electron (uses browser File System Access API). Must hide those UI elements and handle I/O ourselves.

### Editor Registration

- **Editor ID:** `draw-view`
- **Category:** `page-editor` (own PageModel, not a content-view of text)
- **Page type:** New `drawFile` type
- **File association:** `.excalidraw` files (standard Excalidraw extension, recognized by VS Code, Obsidian, etc.)
- **Monaco language:** Add `.excalidraw` to JSON language extensions in `monaco-languages.ts` so Monaco shows JSON syntax highlighting when viewing raw content
- **Dynamic import:** `await import("./draw")` for code splitting

### Data Format

`.excalidraw` files contain the standard Excalidraw JSON:

```json
{
  "type": "excalidraw",
  "version": 2,
  "elements": [
    {
      "id": "abc123",
      "type": "rectangle",
      "x": 100, "y": 100,
      "width": 200, "height": 100,
      "strokeColor": "#000000",
      "backgroundColor": "#ffffff",
      ...
    }
  ],
  "appState": {
    "viewBackgroundColor": "#ffffff",
    ...
  },
  "files": {}
}
```

### UI Customization

Hide Excalidraw's built-in file management (doesn't work in Electron):

```tsx
<Excalidraw
  UIOptions={{
    canvasActions: {
      loadScene: false,
      saveToActiveFile: false,
      export: false,  // we provide our own export
    }
  }}
/>
```

### Key Decisions

1. **page-editor vs content-view:** Page-editor is the right choice. Excalidraw manages its own canvas and state — it doesn't make sense as a "view" of text content. The user can still open `.excalidraw` in Monaco via view switching for raw JSON editing.
2. **File extension:** `.excalidraw` (not `.excalidraw`) — fits js-notepad's pattern of descriptive extensions (`.grid.json`, `.fg.json`, `.note.json`, `.todo.json`, `.link.json`).
3. **Content change detection:** Use Excalidraw's `onChange` callback to serialize and update `page.content`. Debounce to avoid excessive serialization on every mouse move.
4. **Binary files (images):** Excalidraw supports embedded images stored in `files` map (base64). These round-trip through the JSON naturally. May need size warnings for large drawings with many images.

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-201 | Drawing editor — basic Excalidraw integration | Done |
| US-202 | Drawing editor — theme sync & UI polish | Done |
| US-203 | Drawing editor — export (SVG/PNG) | Done |
| US-204 | Drawing editor — MCP & scripting API | Done |
| US-206 | Drawing editor — library persistence & folder config | Planned |
| US-207 | Open image/SVG in Excalidraw editor | Done |
| US-208 | Drawing editor — screen snip tool | Done |

## Task Details

### US-201: Drawing editor — basic Excalidraw integration

**The foundation task.** Install `@excalidraw/excalidraw`, create the editor, register it, and get basic round-tripping working.

Scope:
- `npm install @excalidraw/excalidraw`
- Add `drawFile` to `PageType` and `draw-view` to `PageEditor` in `shared/types.ts`
- Create `/src/renderer/editors/draw/` folder:
  - `DrawPageModel.ts` — PageModel with content state, dirty tracking
  - `DrawEditor.tsx` — wraps `<Excalidraw>` component
  - `index.ts` — EditorModule
- Register in `register-editors.ts` (page-editor, `.excalidraw`, priority 50)
- `initialData` from `page.content` on mount (parse JSON, pass to `restore()`)
- `onChange` callback → `serializeAsJSON()` → update page content (debounced)
- Hide Excalidraw's file load/save UI via `UIOptions`
- Verify: create new `.excalidraw`, draw shapes, close and reopen (session restore), save to file

### US-202: Drawing editor — theme sync & UI polish

- Sync Excalidraw `theme` prop with js-notepad's active theme (dark/light)
- React to theme changes in real-time
- Customize `UIOptions` further — hide welcome screen, tune canvas actions
- Ensure the editor fills its container correctly (flex layout)
- Test with split/grouped pages
- CSS overrides if needed to match js-notepad's visual style

### US-203: Drawing editor — export (SVG/PNG)

- Add toolbar buttons or context menu for "Export as SVG" / "Export as PNG"
- Use `exportToSvg()` / `exportToBlob()` from Excalidraw API
- Export options: open as new page (SVG text or image), save to file, copy to clipboard
- Consider: "Export to SVG" could create a new page with the SVG source in Monaco

### US-204: Drawing editor — MCP & scripting API

- `page.asDraw()` facade for scripting:
  - Read/modify elements programmatically
  - Create drawings from scripts (e.g., generate architecture diagrams)
  - Export to SVG/PNG from scripts
- MCP: register `.excalidraw` in page creation, content format documentation
- Type definitions in `draw-editor.d.ts`
- MCP resource guide update

### US-206: Drawing editor — library persistence & folder config

Excalidraw's library panel (shape reuse) has no built-in persistence in the npm package — items are lost on reload. Implement a `LibraryPersistenceAdapter` backed by a configurable folder on disk.

Scope:
- **New setting:** `drawing.libraryPath` — path to the folder storing `library.excalidrawlib`
- **First-use dialog:** When the library panel is accessed and no path is configured, show a dialog:
  - "Default (user data folder)" — uses `<appData>/excalidraw-library/`
  - "Custom folder..." — opens folder picker
  - Save choice to settings, never ask again
- **Persistence adapter:** Implement `LibraryPersistenceAdapter` (`load`/`save`) reading/writing `library.excalidrawlib` JSON from the configured folder
- **Wire via `useHandleLibrary` hook** in `DrawView.tsx`
- **Async dialog is supported:** Both `load()` and `save()` accept `MaybePromise` return types, so the first `load()` call can `await` the dialog, resolve the path, then return library items
- **"Browse libraries" button:** Won't work in Electron (uses redirect-back flow to excalidraw.com). Consider hiding or replacing. Users can download `.excalidrawlib` files and use "Open" to import.
- **Settings UI:** Add library path display/change button to settings page (drawing section)

## Notes

### 2026-03-17
- Evaluated Fabric.js, SVG-Edit, Excalidraw, tldraw, Konva, Paper.js, SVG.js
- Decided on Excalidraw: MIT license, React component, simple UX, actively maintained
- Dropped original "SVG editor" concept — Excalidraw's JSON format is better suited than trying to build a general SVG editor
- Key risk: bundle size (~1-2 MB). Mitigated by dynamic import (code splitting) — only loaded when a `.excalidraw` file is opened
