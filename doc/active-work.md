# Active Work Dashboard

Overview of all active and planned epics and tasks.

- Epic docs live in [`/doc/epics/`](epics/)
- Task details tracked in [`/doc/tasks/completed.md`](tasks/completed.md) after completion
- Ideas and future concepts in [`/doc/tasks/backlog.md`](tasks/backlog.md)

## Active

- **EPIC-021** — [Browser Automation API (Lightweight RPA)](epics/EPIC-021.md)
  - *Phase 1 (Done):*
  - [x] [US-365: CDP integration (Electron debugger API)](tasks/US-365-playwright-cdp-integration/README.md)
  - [x] [US-366: Browser query and interaction API](tasks/US-366-browser-query-interaction-api/README.md)
  - [x] [US-367: Browser wait methods (waitForSelector, waitForNavigation)](tasks/US-367-browser-wait-methods/README.md)
  - [x] [US-368: Tab management and background automation](tasks/US-368-tab-management-automation/README.md)
  - [x] [US-371: Browser accessibility snapshot](tasks/US-371-browser-accessibility-snapshot/README.md)
  - [x] [US-369: MCP browser automation commands](tasks/US-369-mcp-browser-commands/README.md)
  - *Phase 2 (Architecture & Quality):*
  - [x] [US-375: Automation layer architecture (refactoring)](tasks/US-375-automation-layer-architecture/README.md)
  - [x] [US-376: Input dispatch via CDP (Trusted Types fix)](tasks/US-376-input-dispatch-cdp/README.md)
  - [x] [US-377: Ref resolution improvements](tasks/US-377-ref-resolution/README.md)
  - [x] [US-374: Accessibility snapshot: include iframes, detect overlays/popups](tasks/US-374-iframe-snapshot/README.md)
  - *Phase 3 (Advanced):*
  - [ ] US-370: Data protection hooks (PHI sanitization layer)
  - [x] [US-372: Fix script implicit return with block-body callbacks](tasks/US-372-fix-script-implicit-return/README.md)
  - [ ] [US-373: Missing Playwright MCP browser tools (hover, drag, dialog, console, upload, resize, etc.)](tasks/US-373-deferred-mcp-browser-tools/README.md)
  - [x] [US-379: Fix browser_evaluate — accept `function` param (Playwright compat)](tasks/US-379-browser-evaluate-param-fix/README.md)
  - [x] [US-380: Fix browser_select_option — accept `values` array (Playwright compat)](tasks/US-380-browser-select-option-values/README.md)
  - [x] [US-381: Fix browser_wait_for — add `time` and `textGone` params (Playwright compat)](tasks/US-381-browser-wait-for-playwright/README.md)
  - [x] [US-382: Fix browser_tabs — action-based interface (Playwright compat)](tasks/US-382-browser-tabs-action/README.md)
  - [x] [US-378: Known issues & edge cases (review before epic completion)](tasks/US-378-browser-automation-fixes/README.md)
  - [x] [US-383: Block browser automation on incognito/Tor pages](tasks/US-383-browser-automation-privacy-guard/README.md)
  - [x] [US-384: MCP browser tools toggle (optional Playwright tools)](tasks/US-384-mcp-browser-tools-toggle/README.md)

## Planned

- **EPIC-014** — [Claude AI Chat Panel](epics/EPIC-014.md)
  - [ ] US-385: Right panel slot in Pages.tsx layout
  - [ ] US-386: ClaudeChatModel + SDK integration (query, streaming, abort)
  - [ ] US-387: Chat UI — message list, input, markdown rendering
  - [ ] US-388: MCP auto-registration + page context injection
  - [ ] US-389: Conversation persistence + session resume
  - [ ] US-390: Settings: API key, model, system prompt
  - [ ] US-391: PowerShell shortcut (Ctrl+\`) — open shell at cwd
- **EPIC-011** — [Chrome Extension Support for Built-in Browser](epics/EPIC-011.md)
- *(no epic)*
  - [ ] US-347: CategoryView / CategoryEditor Breadcrumb
  - [ ] US-325: Fix webview preload script error in HTML view
  - [ ] [US-392: Paste Rich Text as Markdown in Monaco Editor](tasks/US-392-paste-rich-text-as-markdown/README.md)
  - [ ] [US-393: Interactive Resource Templates in MCP Inspector](tasks/US-393-mcp-inspector-resource-templates/README.md)


---

## How This Dashboard Works

### Structure

Each section (Active / Planned) lists epics as top-level items and tasks as sub-items:

```
- **EPIC-XXX** — [Title](epics/EPIC-XXX.md)
  - [ ] US-YYY: Task title
  - [x] US-ZZZ: Completed task title
- *(no epic)*
  - [ ] US-AAA: Standalone task
```

### Starting work

1. Move an epic or task from **Planned** to **Active**
2. Mark the task `[ ]` → `[x]` when done

### Completing a standalone task (no epic)

1. Mark task `[x]` in Active section
2. Move it to [`/doc/tasks/completed.md`](tasks/completed.md)
3. Remove from this dashboard

### Completing an epic

1. All tasks under the epic should be `[x]`
2. Move the entire epic block (with tasks) to [`/doc/epics/completed.md`](epics/completed.md)
3. Remove from this dashboard

### Creating new work

- **New epic:** Add to Planned with link to its doc in `/doc/epics/`
- **New task (with epic):** Add as sub-item under the epic
- **New task (standalone):** Add under `*(no epic)*`

### Task ID Format

`US-XXX` — sequential number. `EPIC-XXX` — sequential number.
