# US-360: View Actual DOM — Include Iframe Content

**Status:** Planned
**Created:** 2026-04-05

## Goal

Enhance "View Actual DOM" in the Browser context menu to include content from all `<iframe>` elements, including cross-origin frames. Currently only the main document's `outerHTML` is captured; iframe content is excluded.

## Background

The current implementation in [BrowserWebviewModel.ts](../../src/renderer/editors/browser/BrowserWebviewModel.ts) uses:
```typescript
const html = await webview.executeJavaScript("document.documentElement.outerHTML");
```

This only captures the main frame. `<iframe>` elements appear as empty tags in the output.

## Proposed Approach: Electron `webFrameMain` API

Electron's main process has access to `webContents.mainFrame` which provides a `.frames` property listing all child frames — including cross-origin. Each frame supports `executeJavaScript()`.

**Flow:**
1. Main process: get `webContents.mainFrame.frames` recursively (all nested iframes)
2. For each frame: call `frame.executeJavaScript("document.documentElement.outerHTML")`
3. Main process: stitch results together — replace `<iframe>` placeholders in the parent HTML with actual extracted content (as HTML comments or embedded `<iframe-content>` blocks)
4. Return the combined HTML to the renderer

This bypasses same-origin restrictions because the Electron host process controls all frames.

**Limitations:**
- Frames that failed to load or are about:blank will return empty content
- Deeply nested frames need recursive traversal
- Frame identification: match extracted content to the correct `<iframe>` element by frame URL or index

## Files to Investigate

| File | Relevance |
|------|-----------|
| `src/renderer/editors/browser/BrowserWebviewModel.ts` | Current "View Actual DOM" implementation |
| `src/main/browser-window-manager.ts` | Main process access to webContents |
| `src/ipc/` | IPC channel for main↔renderer communication |
