# US-375: Automation Layer Architecture (Playwright-Compatible)

## Goal

Isolate all Playwright-compatible browser automation code into a dedicated `src/renderer/automation/` folder, separating it from the browser editor. The browser editor exposes a lightweight adapter model (`BrowserTargetModel`); the automation layer builds everything on top: accessibility snapshots, ref resolution, input dispatch, and MCP command handlers.

## Background

### Current state

Playwright-compatible automation code is scattered across three locations:

| Code | Current Location | Issue |
|------|-----------------|-------|
| Accessibility snapshot (YAML) | `editors/browser/accessibility-snapshot.ts` | Playwright concern, not editor concern |
| CdpSession | `editors/browser/CdpSession.ts` | Used only by automation, not by editor UI |
| Ref resolution (`callOnRef`) | `api/mcp-handler.ts` (lines 498-508) | Playwright concept embedded in MCP dispatcher |
| `getBrowserFacade()` | `api/mcp-handler.ts` (lines 468-478) | Always finds first browser page, should use active |
| `browser_*` handlers (13) | `api/mcp-handler.ts` (lines 510-622) | ~160 lines of Playwright logic in generic MCP handler |
| `BrowserEditorFacade` methods | `scripting/api-wrapper/BrowserEditorFacade.ts` | `snapshot()`, `evaluate()` use CDP directly — should delegate |

### Sub-model pattern in BrowserEditorModel

The browser editor already uses sub-models:

```typescript
export class BrowserEditorModel extends EditorModel<BrowserEditorState, void> {
    readonly webview: BrowserWebviewModel;   // webview refs, IPC, context menu
    readonly urlBar: BrowserUrlBarModel;      // URL input, suggestions, search
    readonly bookmarksUI: BrowserBookmarksUIModel; // bookmarks drawer, star button
}
```

Each sub-model receives a `model: BrowserEditorModel` reference in its constructor and manages a specific concern. The new `BrowserTargetModel` follows this same pattern.

### Playwright MCP investigation findings

From investigating the Playwright source code (`D:/git/playwright` and `D:/git/playwright-mcp`):

1. **Page targeting**: No tool has a page parameter. Uses "current tab" concept — agent switches tabs first via `browser_tabs`, then interacts.
2. **Ref resolution**: Uses injected JavaScript with an in-memory `Map<ref, Element>` — O(1) lookup. We use CDP `DOM.resolveNode` which also works but is architecturally different.
3. **Input dispatch**: Uses CDP `Input.dispatchKeyEvent` (per character) and `Input.insertText` (bulk text). Bypasses Trusted Types because CDP inputs execute at browser process level.
4. **Iframe snapshots**: Uses injected JavaScript per frame context, not CDP `Accessibility.getFullAXTree`. Recursively enters each iframe, merges results.

**Decision**: Keep our own implementation (not playwright-core). Replicate Playwright's architectural patterns where beneficial. Own code allows specific fixes without relying on upstream.

## Implementation Plan

### Step 1: Create folder and types

**Create `src/renderer/automation/types.ts`**

```typescript
import type { CdpSession } from "./CdpSession";

/** Lightweight adapter interface — what automation needs from the browser editor. */
export interface IBrowserTarget {
    /** Editor model ID (for page identification). */
    readonly id: string;

    /** CDP session for a specific tab (or active tab if omitted). */
    cdp(tabId?: string): CdpSession;

    /** Navigation */
    navigate(url: string): void;
    back(): void;
    forward(): void;
    reload(): void;

    /** Tab management */
    readonly tabs: ReadonlyArray<{
        id: string; url: string; title: string;
        loading: boolean; active: boolean;
    }>;
    readonly activeTab: {
        id: string; url: string; title: string;
        loading: boolean; active: boolean;
    } | undefined;
    addTab(url?: string): string;
    closeTab(tabId?: string): void;
    switchTab(tabId: string): void;
}
```

### Step 2: Move CdpSession to automation folder

**Move `src/renderer/editors/browser/CdpSession.ts` → `src/renderer/automation/CdpSession.ts`**

No content changes needed — it already has no browser-editor dependencies (only imports `BrowserChannel` from IPC). Update all import paths:

| File | Old import | New import |
|------|-----------|-----------|
| `BrowserEditorFacade.ts` | `../../editors/browser/CdpSession` | `../../automation/CdpSession` |
| `mcp-handler.ts` | `../editors/browser/CdpSession` | `../automation/CdpSession` (temporary — removed in Step 5) |

### Step 3: Move accessibility-snapshot to automation folder

**Move `src/renderer/editors/browser/accessibility-snapshot.ts` → `src/renderer/automation/snapshot.ts`**

No content changes needed — it has zero imports (pure function). Update imports:

| File | Old import | New import |
|------|-----------|-----------|
| `BrowserEditorFacade.ts` | `../../editors/browser/accessibility-snapshot` | `../../automation/snapshot` |

### Step 4: Create BrowserTargetModel

**Create `src/renderer/automation/BrowserTargetModel.ts`**

This sub-model sits inside `BrowserEditorModel` (like `BrowserWebviewModel`) and implements `IBrowserTarget`:

```typescript
import type { BrowserEditorModel } from "../editors/browser/BrowserEditorModel";
import { CdpSession } from "./CdpSession";
import { IBrowserTarget } from "./types";

/**
 * Lightweight automation adapter for BrowserEditorModel.
 * Exposes only what the automation layer needs — navigation, tabs, and CDP.
 * Follows the same sub-model pattern as BrowserWebviewModel.
 */
export class BrowserTargetModel implements IBrowserTarget {
    constructor(private readonly model: BrowserEditorModel) {}

    get id(): string {
        return this.model.id;
    }

    cdp(tabId?: string): CdpSession {
        const state = this.model.state.get();
        const targetTab = tabId || state.activeTabId;
        return new CdpSession(`${this.model.id}/${targetTab}`);
    }

    navigate(url: string): void {
        this.model.navigate(url);
    }

    back(): void {
        this.model.webview.goBack();
    }

    forward(): void {
        this.model.webview.goForward();
    }

    reload(): void {
        this.model.webview.reloadOrStop();
    }

    get tabs() {
        const state = this.model.state.get();
        return state.tabs.map(t => ({
            id: t.id,
            url: t.url,
            title: t.pageTitle,
            loading: t.loading,
            active: t.id === state.activeTabId,
        }));
    }

    get activeTab() {
        const state = this.model.state.get();
        const tab = state.tabs.find(t => t.id === state.activeTabId);
        if (!tab) return undefined;
        return {
            id: tab.id,
            url: tab.url,
            title: tab.pageTitle,
            loading: tab.loading,
            active: true,
        };
    }

    addTab(url?: string): string {
        return this.model.addTab(url);
    }

    closeTab(tabId?: string): void {
        const id = tabId || this.model.state.get().activeTabId;
        this.model.closeTab(id);
    }

    switchTab(tabId: string): void {
        this.model.switchTab(tabId);
    }
}
```

**Register in `BrowserEditorModel` constructor:**

```typescript
// In BrowserEditorModel.ts
import { BrowserTargetModel } from "../../automation/BrowserTargetModel";

export class BrowserEditorModel extends EditorModel<BrowserEditorState, void> {
    readonly webview: BrowserWebviewModel;
    readonly urlBar: BrowserUrlBarModel;
    readonly bookmarksUI: BrowserBookmarksUIModel;
    readonly target: BrowserTargetModel;  // ← NEW

    constructor(state: TComponentState<BrowserEditorState>) {
        super(state);
        this.webview = new BrowserWebviewModel(this);
        this.urlBar = new BrowserUrlBarModel(this);
        this.bookmarksUI = new BrowserBookmarksUIModel(this);
        this.target = new BrowserTargetModel(this);  // ← NEW
    }
}
```

### Step 5: Create automation commands module

**Create `src/renderer/automation/commands.ts`**

Extract all browser_* command handlers from `mcp-handler.ts`. This module:
- Finds the active browser page's `IBrowserTarget`
- Implements all 13 `browser_*` handlers
- Contains `callOnRef()` and `refOrSelector()` helpers
- Returns `McpResponse` compatible results

```typescript
import { pagesModel } from "../api/pages";
import { CdpSession } from "./CdpSession";
import { formatAccessibilityTree } from "./snapshot";
import type { IBrowserTarget } from "./types";
import type { BrowserChannel } from "../../ipc/browser-ipc";

const { ipcRenderer } = require("electron");

interface McpResponse {
    result?: any;
    error?: { code: number; message: string; data?: any };
}

/**
 * Get the automation target for the ACTIVE browser page.
 * Falls back to the first browser page if the active page is not a browser.
 */
async function getTarget(): Promise<IBrowserTarget | null> {
    const pages = pagesModel.state.get().pages;
    const activePage = pagesModel.getActivePage();

    // Prefer active page if it's a browser
    let browserPage = (activePage?.mainEditor?.type === "browserPage") ? activePage : null;

    // Fallback to first browser page
    if (!browserPage) {
        browserPage = pages.find(p => p.mainEditor?.type === "browserPage") ?? null;
    }
    if (!browserPage?.mainEditor) return null;

    const { BrowserEditorModel } = await import("../editors/browser/BrowserEditorModel");
    if (browserPage.mainEditor instanceof BrowserEditorModel) {
        return browserPage.mainEditor.target;
    }
    return null;
}

/** Get accessibility snapshot as formatted text. */
async function snapshot(target: IBrowserTarget, tabId?: string): Promise<string> {
    const tree = await target.cdp(tabId).send("Accessibility.getFullAXTree");
    return formatAccessibilityTree(tree.nodes || []);
}

// ... callOnRef, refOrSelector, all 13 browser_* handlers ...
// (moved verbatim from mcp-handler.ts, replacing `facade` with `target`)

/** Dispatch a browser command. Called from mcp-handler.ts switch statement. */
export async function handleBrowserCommand(
    command: string,
    params: any,
): Promise<McpResponse> {
    const target = await getTarget();
    if (!target) return { error: { code: -32602, message: "No browser page open" } };

    switch (command) {
        case "browser_navigate":    return browserNavigate(target, params);
        case "browser_snapshot":    return browserSnapshot(target);
        case "browser_click":       return browserClick(target, params);
        // ... etc
        default:
            return { error: { code: -32601, message: `Unknown browser command: ${command}` } };
    }
}
```

### Step 6: Simplify mcp-handler.ts

**Modify `src/renderer/api/mcp-handler.ts`**

Replace 13 individual browser cases and ~160 lines of handler code with a single delegation:

```typescript
import { handleBrowserCommand } from "../automation/commands";

async function handleCommand(method: string, params: any): Promise<McpResponse> {
    switch (method) {
        case "execute_script":
            return executeScript(params);
        // ... existing non-browser cases ...

        // Browser automation — delegate to automation layer
        default:
            if (method.startsWith("browser_")) {
                return handleBrowserCommand(method, params);
            }
            return { error: { code: -32601, message: `Unknown command: ${method}` } };
    }
}
```

**Remove from mcp-handler.ts:**
- `import type { BrowserEditorFacade }` — no longer needed
- `import type { CdpSession }` — no longer needed
- `import { BrowserChannel }` — no longer needed (for browser commands)
- `getBrowserFacade()` function
- `browserCommand()` wrapper
- `refOrSelector()` helper
- `callOnRef()` helper
- All 13 `browser*()` handler functions (lines 510-622)

### Step 7: Update BrowserEditorFacade

**Modify `src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts`**

The facade keeps all its existing methods (they're the script API for `page.asBrowser()`), but:
1. Update imports for moved files (CdpSession, accessibility-snapshot)
2. `snapshot()` and `cdp()` now delegate to the target model

```typescript
// Before
import { CdpSession } from "../../editors/browser/CdpSession";
import { formatAccessibilityTree } from "../../editors/browser/accessibility-snapshot";

// After
import { CdpSession } from "../../automation/CdpSession";
import { formatAccessibilityTree } from "../../automation/snapshot";
```

The facade still wraps `BrowserEditorModel` directly for script API purposes. It does NOT go through `IBrowserTarget` — it has its own richer API (query methods, wait methods, check/uncheck, etc.) that scripts need.

### Step 8: Verify no broken imports

Files that need import path updates:

| File | Import to update |
|------|-----------------|
| `BrowserEditorFacade.ts` | `CdpSession`, `formatAccessibilityTree` |
| `mcp-handler.ts` | Remove browser imports, add `handleBrowserCommand` |
| `BrowserEditorModel.ts` | Add `BrowserTargetModel` import |

Files that should NOT change:
- `src/main/cdp-service.ts` — main process, no renderer imports
- `src/main/mcp-http-server.ts` — tool registrations unchanged (just IPC forwarding)
- `src/ipc/browser-ipc.ts` — shared IPC channels, no renderer imports
- `BrowserWebviewModel.ts` — does not use CdpSession or snapshot

## Final Folder Structure

```
src/renderer/automation/
  types.ts                  # IBrowserTarget interface
  CdpSession.ts             # CDP session wrapper (moved from browser/)
  snapshot.ts               # Accessibility snapshot formatter (moved from browser/)
  BrowserTargetModel.ts     # Sub-model adapter for BrowserEditorModel
  commands.ts               # browser_* MCP command handlers (extracted from mcp-handler.ts)
```

## Dependency Diagram

```
┌─────────────────────────────────────────────────────────┐
│  mcp-handler.ts                                          │
│  handleCommand("browser_*") ──delegates──▶               │
└──────────────────────────┬──────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────┐
│  automation/commands.ts                                   │
│  handleBrowserCommand() → getTarget() → handler          │
│  Uses: snapshot.ts, CdpSession, IBrowserTarget           │
├──────────────────────────────────────────────────────────┤
│  automation/snapshot.ts        ← pure function, 0 deps   │
│  automation/CdpSession.ts      ← only ipc import         │
│  automation/BrowserTargetModel ── implements IBrowserTarget│
│     └── wraps BrowserEditorModel (navigate, tabs, etc.)  │
│  automation/types.ts           ← IBrowserTarget interface │
└──────────────────────────────────────────────────────────┘
         ▲
         │ model.target
┌────────┴─────────────────────────────────────────────────┐
│  editors/browser/BrowserEditorModel                       │
│     .webview: BrowserWebviewModel                        │
│     .urlBar: BrowserUrlBarModel                          │
│     .bookmarksUI: BrowserBookmarksUIModel                │
│     .target: BrowserTargetModel  ← NEW                   │
└──────────────────────────────────────────────────────────┘
         ▲
         │ wraps model (for scripts)
┌────────┴─────────────────────────────────────────────────┐
│  scripting/api-wrapper/BrowserEditorFacade                │
│  Script API: page.asBrowser()                            │
│  Imports: automation/CdpSession, automation/snapshot      │
└──────────────────────────────────────────────────────────┘
```

## Bug Fix Included: Active Page Targeting

`getTarget()` in `commands.ts` uses the **active browser page** (not first browser page):

```typescript
const activePage = pagesModel.getActivePage();
let browserPage = (activePage?.mainEditor?.type === "browserPage") ? activePage : null;
if (!browserPage) {
    browserPage = pages.find(p => p.mainEditor?.type === "browserPage") ?? null;
}
```

This fixes the critical issue from US-369 testing where MCP tools always targeted the first browser page.

## Files Changed Summary

| File | Change |
|------|--------|
| `src/renderer/automation/types.ts` | **NEW** — IBrowserTarget interface |
| `src/renderer/automation/CdpSession.ts` | **MOVED** from `editors/browser/CdpSession.ts` |
| `src/renderer/automation/snapshot.ts` | **MOVED** from `editors/browser/accessibility-snapshot.ts` |
| `src/renderer/editors/browser/BrowserTargetModel.ts` | **NEW** — sub-model adapter (implements IBrowserTarget) |
| `src/renderer/automation/commands.ts` | **NEW** — extracted browser_* handlers from mcp-handler |
| `src/renderer/editors/browser/BrowserEditorModel.ts` | Add `target: BrowserTargetModel` sub-model |
| `src/renderer/editors/browser/CdpSession.ts` | **DELETED** (moved) |
| `src/renderer/editors/browser/accessibility-snapshot.ts` | **DELETED** (moved) |
| `src/renderer/api/mcp-handler.ts` | Remove ~160 lines of browser handlers, delegate to automation |
| `src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts` | Update import paths only |

### Files NOT changed

- `src/main/mcp-http-server.ts` — tool registrations unchanged (IPC forwarding only)
- `src/main/cdp-service.ts` — main process CDP management unchanged
- `src/ipc/browser-ipc.ts` — IPC channel definitions unchanged
- `src/renderer/editors/browser/BrowserWebviewModel.ts` — no automation imports
- `src/renderer/editors/browser/BrowserEditorView.tsx` — no automation imports
- `src/renderer/api/types/browser-editor.d.ts` — script type definitions unchanged

## Future Work (enabled by this architecture)

| Task | Where it goes | Notes |
|------|--------------|-------|
| Input via CDP `Input.dispatchKeyEvent` | `automation/input.ts` (new) | Fixes Trusted Types issue |
| Iframe snapshot traversal | `automation/snapshot.ts` (extend) | Frame-by-frame CDP evaluation |
| PHI sanitization (US-370) | `automation/sanitizer.ts` (new) | Wraps `IBrowserTarget` with sanitize/resolve |
| Deferred tools (US-373) | `automation/commands.ts` (extend) | hover, drag, dialog, upload |
| Injected-script ref resolution | `automation/ref-resolver.ts` (new) | Replace CDP DOM.resolveNode approach |

## Acceptance Criteria

- [ ] `src/renderer/automation/` folder exists with 5 files
- [ ] `CdpSession.ts` and `accessibility-snapshot.ts` removed from `editors/browser/`
- [ ] `BrowserEditorModel` has `.target: BrowserTargetModel` sub-model
- [ ] `mcp-handler.ts` has no browser_* handler code — only `handleBrowserCommand()` delegation
- [ ] All 13 browser MCP tools work exactly as before (no behavior change)
- [ ] Active browser page is targeted instead of first browser page
- [ ] `BrowserEditorFacade` (script API) works unchanged
- [ ] No circular dependency between `automation/` and `editors/browser/`
- [ ] Build succeeds (`npm run lint`)
