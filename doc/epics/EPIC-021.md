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

### API approach: Own CDP implementation with Playwright-compatible patterns

After investigating the Playwright source code (both `playwright-core` and `@playwright/mcp`), we decided to **keep our own CDP implementation** rather than integrating `playwright-core` as a dependency.

**Why not playwright-core:**
- Integrating with Electron's `webContents.debugger` requires a WebSocket bridge or custom transport — non-trivial bridging work
- Adds ~3MB dependency and version coupling
- We already have a working CDP layer via `webContents.debugger.attach()`
- Owning the code lets us fix edge cases (healthcare portals, contentEditable, Trusted Types) without waiting for upstream

**What we replicate from Playwright's patterns:**
- Same MCP tool names and parameters (trained agents work without learning a new API)
- Accessibility snapshot format (YAML with `[ref=eN]` for each element)
- CDP `Input.dispatchKeyEvent`/`Input.insertText` for typing (bypasses Trusted Types)
- Frame traversal for iframe content in snapshots

**Architecture:** Electron's `webContents.debugger.attach("1.3")` enables CDP on any webview — no network port, works per-webview. A dedicated `src/renderer/automation/` layer isolates all Playwright-compatible logic from the browser editor.

Expose a thin wrapper via `page.asBrowser()` facade that wraps the browser model with an optional sanitization layer.

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

**Wrapped automation target:**

```javascript
class SanitizedTarget {
    constructor(private target: IBrowserTarget, private sanitizer: Sanitizer) {}
    
    async snapshot(): Promise<string> {
        const raw = await captureSnapshot(this.target);
        return this.sanitizer.sanitize(raw);  // PHI → tokens
    }
    
    async type(ref: string, text: string): Promise<void> {
        const resolved = this.sanitizer.resolve(text);  // tokens → real values
        await typeByRef(this.target.cdp(), ref, resolved);
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

### Automation layer architecture

All Playwright-compatible code lives in `src/renderer/automation/`, isolated from the browser editor:

```
┌─────────────────────────────────────────────────────────┐
│  MCP tool call (browser_click, browser_snapshot, etc.)   │
│  mcp-http-server.ts → IPC → mcp-handler.ts              │
└────────────────────────┬────────────────────────────────┘
                         │ delegates browser_* commands
┌────────────────────────▼────────────────────────────────┐
│  src/renderer/automation/                                │
│                                                          │
│  commands.ts         — browser_* MCP command handlers    │
│  snapshot.ts         — accessibility tree → YAML format  │
│  CdpSession.ts       — CDP wrapper via IPC               │
│  BrowserTargetModel  — IBrowserTarget adapter            │
│  input.ts            — CDP Input.dispatchKeyEvent        │
│  ref-resolver.ts     — ref="e52" → DOM element           │
│  types.ts            — IBrowserTarget interface           │
└────────────────────────┬────────────────────────────────┘
                         │ IBrowserTarget interface
┌────────────────────────▼────────────────────────────────┐
│  BrowserEditorModel.target (BrowserTargetModel)          │
│  Exposes: navigate, tabs, cdp — nothing more             │
└─────────────────────────────────────────────────────────┘
```

The browser editor knows nothing about Playwright patterns, snapshots, or refs. It only exposes navigation, tab management, and CDP access through `BrowserTargetModel`.

## Technical Context

### Electron CDP access

Electron's `webContents.debugger.attach("1.3")` enables CDP on any webview — no network port needed, works per-webview. Managed by `src/main/cdp-service.ts` via IPC. Auto-attaches on first command.

### Key files

| File | Purpose |
|------|---------|
| `src/renderer/automation/` | **Playwright-compatible automation layer** (US-375+) |
| `src/renderer/api/types/browser-editor.d.ts` | Script API type definitions |
| `src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts` | Script facade for `page.asBrowser()` |
| `src/renderer/editors/browser/BrowserEditorModel.ts` | Browser state management, sub-models |
| `src/renderer/editors/browser/BrowserWebviewModel.ts` | Webview references, IPC events |
| `src/main/cdp-service.ts` | Main process CDP session management |
| `src/main/mcp-http-server.ts` | MCP tool registration (IPC forwarding) |
| `src/renderer/api/mcp-handler.ts` | MCP command dispatch |

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
| US-365 | CDP integration (Electron debugger API) | Done |
| US-366 | Browser query and interaction API | Done |
| US-367 | Browser wait methods (waitForSelector, waitForNavigation) | Done |
| US-368 | Tab management and background automation | Done |
| US-369 | MCP browser automation commands (Playwright-compatible) | Done |
| US-371 | Browser accessibility snapshot | Done |
| US-375 | Automation layer architecture (refactoring) | Planned |
| US-376 | Input dispatch via CDP (Trusted Types fix) | Planned |
| US-377 | Ref resolution improvements | Planned |
| US-374 | Accessibility snapshot: include iframes, detect overlays/popups | Planned |
| US-370 | Data protection hooks (PHI sanitization layer) | Planned |
| US-372 | Fix script implicit return with block-body callbacks | Planned |
| US-373 | Missing Playwright MCP browser tools (hover, drag, dialog, console, upload, resize, etc.) | Planned |
| US-379 | Fix browser_evaluate — accept `function` param (Playwright compat) | Done |
| US-380 | Fix browser_select_option — accept `values` array (Playwright compat) | Done |
| US-381 | Fix browser_wait_for — add `time` and `textGone` params (Playwright compat) | Done |
| US-382 | Fix browser_tabs — action-based interface (Playwright compat) | Done |
| US-383 | Block browser automation on incognito/Tor pages | Done |
| US-384 | MCP browser tools toggle (optional Playwright tools) | Done |

## Task Breakdown

### Phase 1: Foundation (Done)

#### US-365: CDP integration (Electron debugger API)
Foundation task — direct CDP access via Electron's `webContents.debugger.attach("1.3")`:
- `src/main/cdp-service.ts` — main process CDP session management via IPC
- `src/renderer/editors/browser/CdpSession.ts` — renderer-side CDP wrapper with `send()` and `evaluate()`
- `src/ipc/browser-ipc.ts` — IPC channels: `cdpAttach`, `cdpDetach`, `cdpSend`
- Auto-attaches on first command, no explicit attach needed

#### US-366: Browser query and interaction API
High-level wrapper in `BrowserEditorFacade` using CDP `Runtime.evaluate`:
- Query: `evaluate()`, `getText()`, `getValue()`, `getAttribute()`, `getHtml()`, `exists()`
- Interaction: `click()`, `type()`, `select()`, `check()`, `uncheck()`, `clear()`
- All methods accept optional `{ tabId }` for targeting specific tabs

#### US-367: Browser wait methods
- `waitForSelector()` — in-page polling via `requestAnimationFrame`
- `waitForNavigation()` — polls `document.readyState === 'complete'`
- `wait(ms)` — simple delay
- All use single IPC call with in-page Promise (efficient)

#### US-368: Tab management and background automation
- `tabs`, `activeTab`, `addTab()`, `closeTab()`, `switchTab()`
- All automation methods work on hidden (`display: none`) webviews via CDP

#### US-371: Browser accessibility snapshot
- CDP `Accessibility.getFullAXTree` → formatted YAML with roles, names, refs
- `[ref=eN]` uses `backendDOMNodeId` from CDP
- Filters noise (none, generic, InlineTextBox), deduplicates StaticText

#### US-369: MCP browser automation commands
13 Playwright-compatible MCP tools registered in `mcp-http-server.ts`, dispatched via `mcp-handler.ts`:
- `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`, `browser_select_option`, `browser_press_key`, `browser_evaluate`, `browser_tabs`, `browser_navigate_back`, `browser_wait_for`, `browser_take_screenshot`, `browser_network_requests`, `browser_close`
- Ref resolution via CDP `DOM.resolveNode` + `Runtime.callFunctionOn`

### Phase 2: Architecture & Quality (Planned)

#### US-375: Automation layer architecture (refactoring)
Extract all Playwright-compatible code into `src/renderer/automation/`:
- Move `CdpSession.ts` and `accessibility-snapshot.ts` from `editors/browser/`
- Create `BrowserTargetModel` sub-model implementing `IBrowserTarget` interface
- Extract all `browser_*` MCP handlers from `mcp-handler.ts` into `automation/commands.ts`
- Fix active-page targeting (use active browser page, not first)
- Pure refactoring — no behavior changes except page targeting fix

#### US-376: Input dispatch via CDP (Trusted Types fix)
New `automation/input.ts` — proper keyboard input using CDP:
- `Input.dispatchKeyEvent` per character (like Playwright)
- `Input.insertText` for bulk text
- Bypasses Trusted Types CSP (CDP inputs execute at browser process level)
- Fixes Gmail and other sites that block `innerHTML`/`textContent` assignment
- Replaces current `Runtime.evaluate` approach in `browser_type` and `browser_press_key`

#### US-377: Ref resolution improvements
New `automation/ref-resolver.ts` — improve ref-to-element resolution:
- Current approach: CDP `DOM.resolveNode` + `Runtime.callFunctionOn` (works but different from Playwright)
- Playwright's approach: injected JavaScript with `Map<ref, Element>` — O(1) lookup
- Evaluate whether to switch to injected-script approach or keep CDP approach
- Ensure refs work reliably for click, type, select_option

#### US-374: Accessibility snapshot: include iframes, detect overlays/popups
Extend `automation/snapshot.ts` for iframe content:
- Detect `<iframe>` elements during snapshot
- Execute snapshot logic in each iframe context via CDP `Runtime.evaluate` with `contextId`
- Merge iframe snapshots into parent with proper indentation
- Detect modal overlays/popups that may intercept interaction

### Phase 3: Advanced Features (Planned)

#### US-370: Data protection hooks (PHI sanitization layer)
Configurable hook system wrapping `IBrowserTarget`:
- User-provided JS script exporting `sanitize(text)` and `resolve(text)`
- `SanitizedTarget` wrapper that intercepts snapshot output and input values
- Token ↔ value bidirectional mapping (maintained per session)
- Screenshot sanitization option
- Integration point for Azure Copilot

#### US-372: Fix script implicit return with block-body callbacks
Fix `/\breturn\b/.test(script)` matching `return` inside `.map()` callbacks.

#### US-373: Missing Playwright MCP browser tools
Collection document for all missing Playwright-compatible MCP tools: hover, drag, dialog, console messages, file upload, fill form, resize, run code. Will be split into sub-tasks during implementation.

#### US-379–382: Playwright parameter compatibility fixes
Four targeted fixes for tools that have parameter name/type mismatches with the Playwright MCP spec: `browser_evaluate` (`function` alias), `browser_select_option` (`values` array), `browser_wait_for` (`time`/`textGone`), `browser_tabs` (action-based interface).

## Implementation Order

### Phase 1 (Done)
**US-365 → US-366 → US-367 → US-371 → US-368 → US-369**

### Phase 2 (Next)
**US-375 → US-376 → US-377 → US-374**

US-375 (architecture) first — creates the folder structure. Then US-376 (input) and US-377 (refs) improve quality within that structure. US-374 (iframes) extends the snapshot module.

### Phase 3 (Later)
**US-370 → US-373**

US-370 (PHI sanitization) wraps the automation layer — clean insertion point after architecture is stable. US-373 (deferred tools) adds remaining Playwright-compatible tools.

## Concerns / Open Questions

### Resolved

1. ~~**`playwright-core` package size**~~ — **Resolved:** Decided not to use `playwright-core`. Own CDP implementation via Electron's debugger API is simpler and gives full control.

2. ~~**CDP connection to `<webview>`**~~ — **Resolved:** `webContents.debugger.attach("1.3")` works perfectly. Auto-attach on first command, no WebSocket bridge needed.

3. ~~**Cross-origin iframes**~~ — **Partially resolved:** CDP `Accessibility.getFullAXTree` only captures main frame. Playwright uses injected JavaScript per frame context. Our solution (US-374): execute snapshot in each iframe via CDP `Runtime.evaluate` with per-frame `contextId`.

4. ~~**Page targeting**~~ — **Resolved:** Playwright MCP has no page parameter — uses "current tab" concept. We use active browser page with fallback to first. Agent switches tabs via `browser_tabs` before interacting.

### Open

5. **Security:** MCP automation commands from external agents should be gated — require user confirmation or a setting to enable/disable.

6. **Script async context:** Long-running automation scripts need to survive without blocking the UI. Current execution model may need adjustments.

7. **Sanitization completeness:** PHI can appear in unexpected places (URLs, cookies, localStorage, network requests). The sanitization layer needs to intercept at the `IBrowserTarget` wrapper level.

8. **Token mapping persistence:** The token ↔ value map must survive across multiple MCP calls in the same session. Need a session concept for automation runs.

## Notes

### 2026-04-06 — Epic created, Phase 1 implemented
- Epic created based on customer RPA requirement (healthcare portal automation)
- Key advantage: entirely local execution — no PHI exposure to cloud APIs
- AI agents via MCP can orchestrate without seeing page content
- Hidden tabs support automation in background (confirmed: CDP works on `display: none` webviews)
- Initially considered `playwright-core` via CDP (Approach 3), then decided on own implementation
- Implemented US-365 through US-369, US-371 in one session
- Live tested: Gmail compose+send, Outlook read — confirmed MCP tools work end-to-end

### 2026-04-06 — Playwright source investigation, architecture pivot
- Cloned and investigated `microsoft/playwright` and `microsoft/playwright-mcp` source
- Key findings from Playwright source:
  - **No page parameter** on any MCP tool — uses "current tab" concept
  - **Ref resolution** uses injected JavaScript with `Map<ref, Element>`, not CDP `DOM.resolveNode`
  - **Input dispatch** uses CDP `Input.dispatchKeyEvent`/`Input.insertText` — bypasses Trusted Types
  - **Iframe snapshots** use injected JS per frame context, not CDP `Accessibility.getFullAXTree`
- **Decision:** Keep own implementation, replicate Playwright patterns where beneficial
  - Own code allows specific fixes for healthcare portal edge cases
  - No dependency coupling with playwright-core versions
  - Simpler architecture (no WebSocket bridge needed)
- Created `src/renderer/automation/` layer to isolate Playwright-compatible code from browser editor
- Split remaining work into Phase 2 (US-375, US-376, US-377, US-374) and Phase 3 (US-370, US-373)
