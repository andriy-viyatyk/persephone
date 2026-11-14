---
title: "Available Tools"
audience: "user"
summary: "Which MCP tools are available and what does each one do?"
---

# Available Tools

## Available Tools

The manifest advertises exactly one tool:

| Tool | Description |
|------|-------------|
| **call** | Read or act on the live object model with a path. Start with no path for the overview; use `args` for method arguments, `value` for assignments, `maxLength` to bound long strings or structured results (image results are returned whole), and `timeoutMs` for a slow remote `.app` call. |

Everything Persephone can do is a path under `call` — pages, editors, windows, boards, settings,
browser automation, Agent Tools, and scripting. The twelve guide resources are separate from the
tool manifest and remain available by URI.

Member-list hints are sent once per object kind in an MCP session, while live children continue to
update. If the client loses those hints after a context compaction, call with no `path` again: the
overview is returned and the session's hint memory is reset. A node's `$help` remains available for
prose details at any time.

### Discovering the application shell with `call`

The `call` tool is the discoverable route for the live application shell. Start with an empty path
or `windows` to inspect the top-level object model. A window's persisted page summaries are
available even while it is closed; call `windows[i].open()` before asking for its live pages.

Useful paths include:

- `windows.count` and `windows[i].pages` for multi-window state. Persisted page summaries include
  `id`, `title`, `type`, `editor`, `language`, `filePath`, `modified`, and `pinned`; browser page
  summaries also include profile and private-session identity fields, but never the URL.
- `window.menuBar.folders`, `window.menuBar.selected`, and `window.menuBar.isOpen` for the current
  Menu Bar. Pass a folder's current `id` to `window.menuBar.open`.
- `page.panels.items`, `page.panels.isOpen`, and `page.panels.width` for the active page's live
  sidebar panels. Pass the bare `id` from an item to `page.panels.expand`; individual panels are
  closed with their own header controls.
- `settings.sections` to find a Settings row and `settings.highlight` to open Settings and point
  at it. Use `settings.set` to change a value, not `highlight`.
- `main.runtime.resourcesDir` and `main.runtime.demoBoardDir` for application and Demo-board
  resource paths, and `boards.assetsBaseUrl` / `boards.manifestUrl` for the published-board catalog.

For example:

```json
{"path":"settings.highlight","args":["mcp.enabled"]}
```

The `call` route refuses attempts to disable the MCP server or change its port through
`settings.set`, because either action would disconnect the current caller. The Settings page (or
the direct script API `app.settings.set()`) remains available for an intentional change.

### Browser automation through call

Use the live object-model paths for browser automation: open a page with
`pages.openUrlInBrowserTab(url, options)`, then drive it through
`pages[pageId].editor`. Use `pages[pageId].editor` for a trusted board and
`window.screen` for Persephone's own window. The browser resource
`persephone://guides/browser` documents targeting, snapshots, refs, waits, and privacy behavior.

> **Privacy guard:** User-opened incognito and Tor pages are refused by the browser host and by
> `window.screen` while that page is active. A private page opened by the agent remains available
> to that agent. Use a normal page when the guard refuses a user-opened private page.

### Optional models from boards and web pages

A trusted board or a participating web page may publish its own named model at
`pages[pageId].editor.app`. Use that node's `$help`, `helpSearch(...)`, hints, writable properties,
methods, `elements`, and `highlight(...)`; a board's highlight runs in the owning board frame,
including a declared secondary view. Browser-page model kinds carry a `page:` prefix, and page
content stays confined to `.app`. User-opened private pages are refused before Persephone probes
for a model. See the [Boards](../agents/boards/index.md) and [Browser](../agents/browser.md) references
for authoring and targeting details.

Calls under `.app` use timeout precedence of per-call `timeoutMs`, remote-declared `timeoutMs`,
the session-only in-memory `boards.callTimeoutMs`, then the built-in 30-second fallback. The
selected level and full path appear in timeout errors; the session knob is not persisted. The MCP
server allows five seconds beyond the per-call `timeoutMs` before it stops waiting. When you omit
`timeoutMs`, it waits up to 125 seconds total. Set `timeoutMs` for a slower call that needs a longer
wait.

### Automating Persephone's own UI

Use `window.screen` to drive **Persephone's own main window** instead of a web page — its tab strip,
sidebar, toolbars, dialogs, and the currently active editor. This lets an AI agent see and interact
with the live app: useful during development to reproduce or inspect a UI issue, and for end users
who want the agent to answer "where is that setting?" or click through a workflow with them.

```
window.screen.snapshot()
```

`window.screen.snapshot`, `.click`, `.hover`, `.type`, `.select`, `.pressKey`, `.evaluate`, `.screenshot`,
`.networkRequests`, and `.waitFor` operate against the app window using refs or CSS selectors, exactly like a browser page,
provided the active page is not incognito or Tor.

The same host exposes `.recording.start({ region, openPlayer? })`, `.pause()`, `.resume()`, `.stop()`,
`.cancel()`, and readonly `.state`. Recording starts immediately for agents and is shared with the
header controls. `stop()` returns the temporary file path plus duration, MIME type, and dimensions;
copy the path elsewhere to keep it past seven days. `openPlayer` defaults to false.

Native operating-system dialogs are exposed on their owning window as `windows[i].nativeDialog`.
Read its `open`, `kind`, and optional `title` properties to identify a picker or message box, then
call `windows[i].nativeDialog.dismiss()` to cancel it. This cannot enter a path or confirm Save/Open.

What's different:
- The snapshot only ever shows the app **chrome** (tab strip, sidebar, toolbars) plus the **active page's** content — other open tabs stay hidden until you click their tab to activate them.
- Browser navigation and inner-tab management don't apply to the app window — use `pages` and page
  methods to open or switch Persephone pages instead.
- Editing document content (e.g. typing into a Monaco editor) should go through `pages[i].content`
  or `script.execute`, not synthetic typing. `window.screen.type` is for simple inputs like dialogs
  and search boxes.
- Use `windows[i].window.screen` to target a specific window.

### Browser Profiles

Persephone's built-in browser supports multiple **profiles** — each is an isolated cookie and login session (separate cookies, storage, and cache). Multi-profile users (e.g., a work account in one profile and a personal account in another) can have agents reliably act on the correct session without reverse-engineering which page holds which login.

**Discovering profiles**

Call `settings.browserProfiles` to discover which profiles are configured:

```json
{
  "version": "4.0.3",
  "pageCount": 3,
  "activePageId": "abc",
  "browserProfiles": ["work", "personal"],
  "defaultBrowserProfile": "work"
}
```

`browserProfiles` lists all configured profile names. `""` is always the built-in default profile (even if it is not listed).

**Profile fields on browser pages**

`pages` and `page` include these fields for `browser-view` pages:

| Field | Description |
|-------|-------------|
| `profileName` | Profile name. `""` = built-in default profile. |
| `isIncognito` | `true` for incognito sessions. |
| `isTor` | `true` for Tor browsing sessions. |
| `url` | The active tab's URL. Omitted for incognito/Tor pages (privacy). |
| `title` | The Persephone page title. Incognito and Tor pages use the generic `Browser` title so the site name is not exposed outside the private session. |

`windows` also includes `profileName`, `isIncognito`, and `isTor` for browser pages — but not `url`.

**Targeting a specific profile**

Pass `profileName` to `pages.openUrlInBrowserTab` to open or reuse the page belonging to that
profile. Pass its returned `pageId` (or one from `pages`) for precise targeting when several
pages share a profile:

```
// Snapshot the "work" profile's page
pages.openUrlInBrowserTab("https://outlook.com", { profileName: "work" })

// Click an element on a specific page by ID
pages["abc"].editor.click({ ref: "e12" })

// Navigate the default-profile page
pages.openUrlInBrowserTab("https://example.com", { profileName: "" })
```

**Opening a URL in a profile**

`pages.openUrlInBrowserTab` with `profileName` adds the tab to (and focuses) an existing page of
that profile, or creates a new page — it never attaches to a different-profile page:

```
pages.openUrlInBrowserTab("https://outlook.com", { profileName: "work" })
```

Incognito and Tor pages are never automatable: `profileName` never matches them, a direct `pageId` targeting such a page returns a privacy-refusal error, and `pageId: "app"` is refused while one of them is active. `script.execute` remains unrestricted by this browser-automation guard and can still access private-session state.

### Multi-Window Support

All tools (except `windows`) accept an optional `windowIndex` parameter to target a specific window. If omitted, the first open window is used.

- Use `windows` to discover all windows and their status (`open` or `closed`). Browser pages in the list include `profileName`, `isIncognito`, and `isTor` so you can identify which profile's page is in each window.
- Closed windows have persisted pages but cannot be targeted directly — use `windows[i].open()` to reopen them first
- After reopening, target the window with any tool using its `windowIndex`

