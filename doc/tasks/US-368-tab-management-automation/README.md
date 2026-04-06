# US-368: Tab Management and Background Automation

## Goal

Expose browser tab management to the scripting API and enable all automation methods (evaluate, click, type, waitForSelector, etc.) to target specific tabs by `tabId`. This allows scripts to automate multiple tabs simultaneously, including background (hidden) tabs.

## Background

### Current architecture (confirmed by investigation)

**All webviews are mounted in the DOM simultaneously** — `PageManager` renders every internal tab's `<webview>` element and uses `display: none` for inactive tabs. This means:
- All tabs have live webview elements in `webviewRefs` Map
- All tabs are registered in the main process `registrations` Map
- CDP commands work on any registered webview (not just active)

**BrowserTabData** fields:
```typescript
interface BrowserTabData {
    id: string;           // Unique internal tab ID (e.g., "bt-1")
    url: string;          // Current URL
    pageTitle: string;    // Page title
    loading: boolean;     // Is page currently loading
    canGoBack: boolean;
    canGoForward: boolean;
    favicon: string;
    audible: boolean;
    muted: boolean;
    homeUrl: string;
    navHistory: string[];
}
```

**Existing tab methods on BrowserEditorModel** (not yet exposed to scripts):
- `addTab(url?)` — create new tab, returns ID
- `closeTab(internalTabId)` — close a tab
- `switchTab(internalTabId)` — switch active tab
- `moveTab(fromId, toId)` — reorder tabs

### Current CdpSession key construction

`BrowserEditorFacade.cdp()` builds the registration key as:
```typescript
`${this.model.id}/${state.activeTabId}`
```

This always targets the **active tab**. To target a specific tab, we need to accept an optional `tabId` parameter.

## Implementation Plan

### Step 1: Add tabId parameter to CdpSession construction

**File: `src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts`**

Update `cdp()` to accept an optional tabId:

```typescript
/** Get a CDP session for a tab. Defaults to active tab. */
cdp(tabId?: string): CdpSession {
    const state = this.model.state.get();
    const targetTab = tabId || state.activeTabId;
    return new CdpSession(`${this.model.id}/${targetTab}`);
}
```

### Step 2: Add tabId option to all automation methods

Add optional `{ tabId?: string }` to query, interaction, and wait methods. Each method passes `tabId` to `this.cdp(tabId)`:

```typescript
async getText(selector: string, options?: { tabId?: string }): Promise<string | null> {
    return this.cdp(options?.tabId).evaluate(
        `document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`,
    );
}

async click(selector: string, options?: { tabId?: string }): Promise<void> {
    const s = JSON.stringify(selector);
    await this.cdp(options?.tabId).evaluate(`(() => {
        const el = document.querySelector(${s});
        if (!el) throw new Error('Element not found: ' + ${s});
        el.scrollIntoView({ block: 'center' });
        el.click();
    })()`);
}

// Same pattern for: getValue, getAttribute, getHtml, exists,
// type, select, check, uncheck, clear, waitForSelector, waitForNavigation, evaluate
```

### Step 3: Add tab management properties and methods

**File: `src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts`**

```typescript
/** List of all open tabs in this browser page. */
get tabs(): IBrowserTab[] {
    return this.model.state.get().tabs.map(t => ({
        id: t.id,
        url: t.url,
        title: t.pageTitle,
        loading: t.loading,
        active: t.id === this.model.state.get().activeTabId,
    }));
}

/** The active tab. */
get activeTab(): IBrowserTab {
    const state = this.model.state.get();
    const tab = state.tabs.find(t => t.id === state.activeTabId);
    return {
        id: tab?.id ?? "",
        url: tab?.url ?? "",
        title: tab?.pageTitle ?? "",
        loading: tab?.loading ?? false,
        active: true,
    };
}

/** Open a new tab. Returns the new tab's ID. */
addTab(url?: string): string {
    return this.model.addTab(url);
}

/** Close a tab. Defaults to active tab. */
closeTab(tabId?: string): void {
    const id = tabId || this.model.state.get().activeTabId;
    this.model.closeTab(id);
}

/** Switch to a tab. */
switchTab(tabId: string): void {
    this.model.switchTab(tabId);
}
```

### Step 4: Define IBrowserTab interface

**File: `src/renderer/api/types/browser-editor.d.ts`** (and assets copy)

```typescript
/** Represents a browser internal tab. */
export interface IBrowserTab {
    /** Internal tab ID (use with tabId option in automation methods). */
    readonly id: string;
    /** Current URL. */
    readonly url: string;
    /** Page title. */
    readonly title: string;
    /** Whether the page is currently loading. */
    readonly loading: boolean;
    /** Whether this is the active (visible) tab. */
    readonly active: boolean;
}
```

### Step 5: Update IBrowserEditor with all new members

Add to the interface:
```typescript
// --- Tab management ---
readonly tabs: IBrowserTab[];
readonly activeTab: IBrowserTab;
addTab(url?: string): string;
closeTab(tabId?: string): void;
switchTab(tabId: string): void;
```

Update all existing method signatures to include `options?` with `tabId`:
```typescript
getText(selector: string, options?: { tabId?: string }): Promise<string | null>;
click(selector: string, options?: { tabId?: string }): Promise<void>;
type(selector: string, text: string, options?: { tabId?: string }): Promise<void>;
// ... etc for all query/interaction/wait methods
```

### Step 6: Keep both type files in sync

Copy `src/renderer/api/types/browser-editor.d.ts` to `assets/editor-types/browser-editor.d.ts`.

## Script API Examples

```javascript
const browser = await page.asBrowser();

// List tabs
browser.tabs.forEach(t => console.log(t.id, t.url, t.active));

// Open a new tab
const newTabId = browser.addTab("https://example.com");

// Work on background tab while active tab is undisturbed
await browser.waitForSelector("h1", { tabId: newTabId });
const title = await browser.getText("h1", { tabId: newTabId });
await browser.click("#submit", { tabId: newTabId });

// Switch to the new tab
browser.switchTab(newTabId);

// Close a tab
browser.closeTab(newTabId);
```

## Edge Cases

- **Tab closed during automation:** CDP call will throw "WebContents not found or destroyed". Scripts should handle this with try/catch.
- **addTab returns immediately:** The tab's webview needs `dom-ready` before CDP works. Use `waitForNavigation` or `waitForSelector` after `addTab`.
- **closeTab active tab:** `BrowserEditorModel.closeTab` handles this — switches to adjacent tab automatically.
- **closeTab last tab:** Model replaces it with a fresh `about:blank` tab.
- **tabs getter:** Returns a snapshot — not reactive. Call `tabs` again for updated state.

## Files Changed

| File | Change |
|------|--------|
| `src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts` | Add tab management + tabId option to all methods |
| `src/renderer/api/types/browser-editor.d.ts` | Add `IBrowserTab`, tab methods, tabId options |
| `assets/editor-types/browser-editor.d.ts` | Mirror copy |

## Acceptance Criteria

- [ ] `browser.tabs` returns list of open tabs with id, url, title, loading, active
- [ ] `browser.activeTab` returns the active tab
- [ ] `browser.addTab(url)` opens a new tab and returns its ID
- [ ] `browser.closeTab(tabId)` closes a specific tab
- [ ] `browser.switchTab(tabId)` switches the active tab
- [ ] All automation methods accept `{ tabId }` option for targeting specific tabs
- [ ] Automation works on background (`display: none`) tabs
- [ ] Type definitions updated in both source and assets
- [ ] `IBrowserTab` interface defined and exported
