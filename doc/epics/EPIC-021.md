# EPIC-021: Browser Automation API (Lightweight RPA)

## Status

**Status:** Active
**Created:** 2026-04-06

## Overview

Add a Playwright/Puppeteer-like scripting API for Persephone's built-in browser, enabling scripts and MCP agents to programmatically navigate pages, find elements, click buttons, type into inputs, and extract data. This turns Persephone into a lightweight RPA (Robotic Process Automation) tool that runs entirely locally — no data leaves the machine.

## Motivation

1. **Customer use case:** RPA automation on healthcare portals where patient data (PHI) cannot be sent to external services. Persephone's local execution model is ideal — scripts interact with the browser directly via DOM/JS, and AI agents via MCP only receive instructions, not page content.

2. **Competitive differentiator:** Combining a developer notepad + scripting engine + built-in browser + RPA capabilities is a unique value proposition.

3. **Technical feasibility:** Persephone's `<webview>` already supports `executeJavaScript()` (used for View Actual DOM, SVG extraction, etc.) and Electron provides `sendInputEvent()` for low-level input simulation. The infrastructure is mostly in place.

## Key Design Decisions

### Hidden tab support

Browser tabs with `display: none` (non-active) still have a running Chromium process — their DOM, JS engine, and layout are fully active. `executeJavaScript()` and `sendInputEvent()` work on hidden webviews. This allows automation to run in background tabs while the user works in the active tab.

### API approach: Playwright-core via CDP (Approach 3)

Use `playwright-core` (the library without bundled browsers) connected to webview webContents via Chrome DevTools Protocol. This gives us the full battle-tested Playwright API (selectors, auto-wait, input simulation, network interception) without reinventing browser automation.

Electron's `webContents.debugger` API speaks CDP natively. Playwright's `connectOverCDP()` attaches to existing Chromium instances — our `<webview>` is exactly that.

Expose a thin wrapper via `page.asBrowser()` facade that wraps the Playwright `Page` object with an optional sanitization layer.

### Data protection layer (PHI sanitization hooks)

**Motivation:** Customer use case requires RPA on healthcare portals. Browser pages contain patient data (PHI) that cannot leave the Azure private network. AI agents (Claude on Anthropic servers) must orchestrate automation without seeing PHI.

**Architecture:**

```
Claude (Anthropic) ←→ MCP Handler ←→ Sanitization Hooks ←→ Playwright/Browser
```

```
┌─────────────────────────────────────────────────┐
│ Claude (Anthropic servers)                       │
│ - sees only sanitized data                       │
│ - produces scripts with placeholder variables    │
└──────────────────┬──────────────────────────────┘
                   │ MCP
┌──────────────────▼──────────────────────────────┐
│ Persephone MCP Handler                           │
│                                                  │
│  ┌─────────────────────────────────┐            │
│  │ Sanitization Layer (hooks)       │            │
│  │ - configurable per-project       │            │
│  │ - user-provided JS script        │            │
│  │ - token ↔ value bidirectional    │            │
│  └──────────┬──────────────────────┘            │
│             │                                    │
│  ┌──────────▼──────────────────────┐            │
│  │ Browser Automation API           │            │
│  │ (Playwright-core via CDP)        │            │
│  └──────────┬──────────────────────┘            │
│             │                                    │
│  ┌──────────▼──────────────────────┐            │
│  │ Built-in Browser (<webview>)     │            │
│  │ - real PHI data on screen        │            │
│  │ - never leaves the machine       │            │
│  └─────────────────────────────────┘            │
└─────────────────────────────────────────────────┘
```

**Hook points:**

| Direction | Hook | What it does |
|-----------|------|-------------|
| Browser → Claude | `sanitize(text)` | Replace PHI with tokens before data reaches MCP (`John Smith` → `{{patient_1_name}}`) |
| Claude → Browser | `resolve(text)` | Resolve tokens back to real values before executing in browser (`{{patient_1_name}}` → `John Smith`) |
| Screenshots | `sanitizeImage(buffer)` | Blur/redact PHI regions, or block entirely |

**Implementation:** The sanitization layer is a user-configurable JavaScript file that exports `sanitize()` and `resolve()` functions. This keeps it general-purpose — different customers define their own PHI patterns. Azure Copilot integration (using an isolated Azure LLM to identify and replace PHI) is one possible sanitizer implementation.

**Wrapped Playwright page:**

```javascript
class SanitizedPage {
    constructor(private page: PlaywrightPage, private sanitizer: Sanitizer) {}
    
    async textContent(selector: string): Promise<string> {
        const raw = await this.page.textContent(selector);
        return this.sanitizer.sanitize(raw);  // PHI → tokens
    }
    
    async fill(selector: string, value: string): Promise<void> {
        const resolved = this.sanitizer.resolve(value);  // tokens → real values
        await this.page.fill(selector, resolved);
    }
}
```

This ensures Claude never sees raw PHI — it operates with placeholder tokens, and Persephone resolves them locally before browser interaction.

### Accessibility snapshots (not screenshots)

Instead of sending full DOM or screenshots to AI agents, use Playwright's accessibility tree — a compact YAML representation of the page's interactive elements:

```yaml
- heading "Patient Details" [level=2]
- textbox "Patient Name" [ref=e5]: "John Smith"
- combobox "Status" [ref=e10]: "Active"
- button "Save" [ref=e15]
- table "Medications":
  - row: "Aspirin", "100mg", "Daily"
```

| Approach | Token cost | Vision model needed |
|----------|-----------|-------------------|
| Screenshot | 5,000-8,000 tokens | Yes |
| Full DOM | 10,000-50,000+ tokens | No |
| Accessibility snapshot | 200-500 tokens | No |

Each interactive element gets a **ref ID** (`ref=e5`). The agent uses refs directly: `click ref=e15` → clicks "Save". No CSS selector guessing, no screenshot parsing, deterministic and unambiguous.

This also makes PHI sanitization more reliable — structured YAML fields are easier to sanitize than raw HTML.

### Playwright MCP API compatibility

Playwright has an official MCP server (`@playwright/mcp`) with well-known tool names. AI agents (Claude, Copilot, Cursor, etc.) are already trained on these tools. By replicating the same MCP method names and parameters, any AI agent that knows Playwright MCP can use Persephone without learning a new API.

**Playwright MCP tools to replicate:**

| Tool | Purpose |
|------|---------|
| `browser_navigate` | Navigate to URL |
| `browser_snapshot` | Get accessibility tree (YAML) |
| `browser_click` | Click element by ref, selector, or description |
| `browser_type` | Type text into element |
| `browser_fill_form` | Fill form fields |
| `browser_press_key` | Press keyboard key |
| `browser_hover` | Hover over element |
| `browser_select_option` | Select dropdown option |
| `browser_take_screenshot` | Capture screenshot |
| `browser_evaluate` | Run JS in page |
| `browser_run_code` | Run Playwright script |
| `browser_tabs` | List open tabs |
| `browser_navigate_back` | Go back |
| `browser_console_messages` | Get console log |
| `browser_network_requests` | Get network log |
| `browser_handle_dialog` | Handle alert/confirm dialogs |
| `browser_drag` | Drag and drop |
| `browser_file_upload` | Upload file to input |
| `browser_wait_for` | Wait for condition |
| `browser_close` | Close browser/tab |
| `browser_resize` | Resize viewport |

**Key parameter pattern** (from Playwright MCP):
- `ref` — exact element reference from snapshot (e.g. `ref=e5`)
- `element` — human-readable element description (AI fallback)
- `selector` — CSS or role selector

This means US-369 (MCP commands) should use these exact tool names instead of `mcp__persephone__browser_*` names.

### Tab targeting

Operations target the active tab by default. An optional `tabId` parameter can target a specific internal tab (for background automation). Access non-active tabs via `browser.tabs` collection.

## Technical Context

### Current browser scripting surface

**`IBrowserEditor`** (6 methods): `url`, `title`, `navigate()`, `back()`, `forward()`, `reload()`

**`BrowserEditorFacade`** wraps `BrowserEditorModel` → `BrowserWebviewModel` → `webviewRefs` Map (internalTabId → `Electron.WebviewTag`).

### Electron APIs available

| API | Source | Purpose |
|-----|--------|---------|
| `webview.executeJavaScript(code)` | WebviewTag | Run JS in guest page, return result |
| `webContents.sendInputEvent(event)` | Main process | Low-level mouse/keyboard events |
| `webview.capturePage()` | WebviewTag | Screenshot (for debugging) |
| `webContents.mainFrame.framesInSubtree` | Main process | Access iframes |

### Key files

| File | Purpose |
|------|---------|
| `src/renderer/api/types/browser-editor.d.ts` | Script API type definitions |
| `src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts` | Script facade (6 methods) |
| `src/renderer/editors/browser/BrowserEditorModel.ts` | Browser state management |
| `src/renderer/editors/browser/BrowserWebviewModel.ts` | Webview references, `getActiveWebview()` |
| `src/main/browser-service.ts` | Main process webContents management |

## Proposed Script API

```javascript
const browser = await page.asBrowser();

// --- Navigation ---
browser.navigate("https://portal.example.com");
await browser.waitForNavigation();                  // wait for page load
await browser.waitForSelector("#login-form");       // wait for element

// --- Accessibility snapshot (compact page representation) ---
const snapshot = await browser.snapshot();           // YAML accessibility tree
// Returns:
// - heading "Login" [level=1]
// - textbox "Username" [ref=e5]
// - textbox "Password" [ref=e8]
// - button "Sign In" [ref=e12]

// --- Query ---
const text = await browser.getText("#status");              // textContent
const value = await browser.getValue("#name-input");        // input value
const attr = await browser.getAttribute("a.link", "href");  // attribute
const html = await browser.getHtml("#container");           // innerHTML
const exists = await browser.exists("#submit-btn");         // boolean

// --- Interaction (by selector or ref from snapshot) ---
await browser.click("#submit-btn");                     // by CSS selector
await browser.click({ ref: "e12" });                    // by snapshot ref
await browser.type("#search-input", "patient name");    // type text
await browser.select("#dropdown", "option-value");      // select option
await browser.check("#checkbox");                       // check checkbox
await browser.uncheck("#checkbox");                     // uncheck
await browser.clear("#input");                          // clear input

// --- Evaluate (arbitrary JS) ---
const result = await browser.evaluate(`
    document.querySelectorAll('.row').length
`);

// --- Wait ---
await browser.waitForSelector(".results", { timeout: 5000 });
await browser.waitForNavigation();
await browser.wait(1000);  // ms delay

// --- Tabs ---
browser.tabs;                           // list of internal tabs
browser.activeTab;                      // current tab
await browser.switchTab(tabId);         // switch active tab

// --- Playwright Page (full API when needed) ---
const pw = await browser.playwright();  // raw Playwright Page object
await pw.locator("text=Submit").click();
```

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-365 | Playwright-core CDP integration | Done |
| US-366 | Browser query and interaction API | Done |
| US-367 | Browser wait methods (waitForSelector, waitForNavigation) | Planned |
| US-368 | Tab management and background automation | Planned |
| US-369 | MCP browser automation commands | Planned |
| US-370 | Data protection hooks (PHI sanitization layer) | Planned |

## Task Breakdown

### US-365: Playwright-core CDP integration

Foundation task — connect `playwright-core` to webview webContents via CDP:
- Add `playwright-core` as dependency (library only, no bundled browsers)
- Use Electron's `webContents.debugger.attach()` to enable CDP on a webview
- New IPC channel for main process to manage CDP sessions per webview
- Expose `playwright()` on `BrowserEditorFacade` returning a Playwright `Page` object
- Verify it works on hidden (`display: none`) tabs
- Basic smoke test: `page.textContent()`, `page.click()`, `page.fill()`

### US-366: Browser query and interaction API

High-level wrapper around Playwright `Page` with Persephone-specific conveniences:
- `evaluate(code)`, `getText(selector)`, `getValue(selector)`, `getAttribute(selector, attr)`, `getHtml(selector)`, `exists(selector)`
- `click(selector)`, `type(selector, text)`, `select(selector, value)`, `check(selector)`, `uncheck(selector)`, `clear(selector)`
- Update `IBrowserEditor` types and `BrowserEditorFacade`
- All methods delegate to the Playwright `Page` internally

### US-367: Browser wait methods

- `waitForSelector(selector, options?): Promise<void>` — poll for element existence (MutationObserver or interval)
- `waitForNavigation(options?): Promise<void>` — wait for `did-stop-loading` event
- `wait(ms): Promise<void>` — simple delay
- Configurable timeout (default 30s) with clear error on timeout

### US-368: Tab management and background automation

- `browser.tabs: IBrowserTab[]` — list internal tabs
- `browser.activeTab: IBrowserTab` — current tab
- `browser.switchTab(tabId): Promise<void>` — switch active tab
- Allow targeting specific tabs in all methods: `browser.click(selector, { tabId })`
- Verify all methods work on `display: none` tabs

### US-369: MCP browser automation commands (Playwright-compatible)

Expose browser automation via MCP using **Playwright MCP-compatible tool names** so any AI agent already trained on Playwright MCP works with Persephone out of the box:

Core tools (80% of usage):
- `browser_navigate(url)` — navigate to URL
- `browser_snapshot()` — return accessibility tree YAML
- `browser_click(ref?, selector?, element?)` — click element
- `browser_type(ref?, selector?, text)` — type into element
- `browser_select_option(ref?, selector?, value)` — select dropdown
- `browser_press_key(key)` — keyboard key press
- `browser_wait_for(selector?, text?, timeout?)` — wait for condition
- `browser_handle_dialog(action)` — handle alert/confirm

Extended tools:
- `browser_take_screenshot()` — capture page screenshot
- `browser_evaluate(code)` — run JS in page
- `browser_tabs()` — list open tabs
- `browser_navigate_back()` — go back
- `browser_console_messages()` — get console log
- `browser_network_requests()` — get network log (reuse US-362)
- `browser_hover()`, `browser_drag()`, `browser_file_upload()`, `browser_close()`, `browser_resize()`

Each tool returns the updated accessibility snapshot by default (same as Playwright MCP). Parameter format matches Playwright's `ref`/`selector`/`element` pattern.

### US-370: Data protection hooks (PHI sanitization layer)

Configurable hook system between browser automation and MCP:
- User-provided JS script that exports `sanitize(text): string` and `resolve(text): string`
- `SanitizedPage` wrapper around Playwright `Page` that intercepts all data extraction and input methods
- Token ↔ value bidirectional mapping (maintained per session)
- Screenshot sanitization option (`sanitizeImage(buffer)`: blur/redact or block)
- Settings UI to configure sanitization script path per browser profile
- Integration point for Azure Copilot or other external sanitization services

## Implementation Order

**US-365 → US-366 → US-367 → US-368 → US-369 → US-370**

Start with Playwright-core CDP integration (foundation), then query/interaction API, then wait methods, then tabs, then MCP, then sanitization layer. Each task is independently testable. US-370 wraps the existing API — can be added last without affecting earlier tasks.

## Concerns / Open Questions

1. **`playwright-core` package size:** Need to verify the size of `playwright-core` (without bundled browsers). It should be significantly smaller than full `playwright` since we provide our own Chromium via Electron.

2. **CDP connection to `<webview>`:** Electron's `webContents.debugger.attach()` enables CDP. Need to verify Playwright's `connectOverCDP()` works with this — Playwright docs note CDP connection is "lower fidelity" than native. Test which features work and which don't.

3. **Cross-origin iframes:** Playwright handles iframes natively via `frame()` and `frameLocator()`. This should work through CDP, but needs verification with Electron webviews.

4. **Security:** Scripts have full access already (Node.js context). But MCP automation commands from external agents should be gated — require user confirmation or a setting to enable/disable.

5. **Script async context:** Long-running automation scripts need to survive without blocking the UI. Current script execution model may need adjustments for scripts that take minutes to complete.

6. **Sanitization completeness:** PHI can appear in unexpected places (URLs, cookies, localStorage, network requests). The sanitization layer needs to be thorough. Consider whether to intercept at the Playwright API level (wrapping methods) or at the MCP serialization level (sanitizing all outgoing JSON).

7. **Token mapping persistence:** The token ↔ value map must survive across multiple MCP calls in the same session. Need a session concept for automation runs.

## Notes

### 2026-04-06
- Epic created based on customer RPA requirement (healthcare portal automation)
- Key advantage: entirely local execution — no PHI exposure to cloud APIs
- AI agents via MCP can orchestrate without seeing page content
- Hidden tabs support automation in background (confirmed: `executeJavaScript` and `sendInputEvent` work on `display: none` webviews)
- Decided on Approach 3: `playwright-core` via CDP — gives full battle-tested Playwright API without reinventing browser automation. `playwright-core` is the library-only package (no bundled browsers), Apache 2.0 licensed
- Added data protection layer (US-370): sanitization hooks between browser and MCP for PHI protection. User-configurable JS script exports `sanitize()`/`resolve()` functions. Enables Azure Copilot integration for automated PHI detection and replacement with tokens
