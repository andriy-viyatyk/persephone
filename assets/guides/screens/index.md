---
title: "Persephone Screens"
audience: both
summary: "A catalogue of Persephone's screen guides, with the window model and agent guidance for finding and highlighting elements."
---

# Persephone Screens

Use this catalogue when a question is about Persephone itself rather than the user's content:
what a control does, where to change a tab's language, how to open a folder, or how the app is
organized. The focused guides cover the [header strip](./header.md), [Menu Bar](./menu-bar.md),
[Settings](./settings.md), [page area and sidebar](./sidebar.md), [page tabs](./tabs.md),
[dialogs and transient surfaces](./dialogs.md), and the [MCP Inspector](./mcp-inspector.md).

For editor capabilities, see the [Editors catalogue](../editors/index.md). For creating and
reading pages as an agent, see [Pages & Windows](../agents/pages.md); for driving the application
window, see [Browser automation](../agents/browser.md). When the MCP `call` tool is available,
`ui.elements` provides the curated shell controls with their purposes, resolved selectors, and
current visibility. `ui.highlight(name, message?)` points at one of those controls. The list is
curated rather than an exhaustive DOM inventory.

When a selector is needed instead of a curated name, `app.ui.highlightElement(selector, ...)` is
still reachable from `script.execute(code)`. Prefer the named highlight when possible because it
knows the purpose of each control.

## What Persephone is

Persephone is a Windows notepad replacement built for developers. It keeps Notepad's fast,
tabbed, open-anything feel and adds the VS Code editor engine (syntax highlighting, IntelliSense,
multi-cursor, and compare mode), specialized editors for structured data, notebooks, diagrams,
link collections, HTTP requests, a built-in browser, and a JavaScript/TypeScript runtime with full
Node.js access. Boards are small sandboxed web apps an agent can build for the user. Persephone is
deliberately a container: the app stays light, and the user or their agent brings the integrations.

That description is intentionally broad. Match it to what the user actually asked about rather
than reciting the whole catalogue.

## Anatomy of the window

Persephone has no native title bar or native menu bar. Everything lives in one header strip across
the top, and everything below it is the page area.

```
+-------------------------------------------------------------------------+
| [P] [tab] [tab] [tab] [+]                        [-] [box] [x]          |  header strip
|                                                    ... Mneme  * MCP     |  status indicators
+-------------------------------------------------------------------------+
|                      |                                                  |
|  sidebar panels      |   the active page, rendered by its editor         |  page area
|  (when the page      |                                                  |
|   has any open)      |                                                  |
+-------------------------------------------------------------------------+
```

The header's detailed controls and conditional status indicators are in [Header Strip](./header.md).
Tabs, grouping, and restore behavior are in [Page Tabs](./tabs.md). The shared page-area frame and
its page-owned panels are in [Page Area and Sidebar](./sidebar.md). The Menu Bar is the app's file
browser, tab switcher, and Settings entry point; its controls and destinations are in [Menu Bar](./menu-bar.md).

## Layout

## About guide browser

About is a fixed page with the version card on the left and the guide browser on the right. The
contents view provides the guide tree, summaries, an optional **Show agent guides** filter, inline
What's New, and Resources. Selecting a guide renders it in the right pane with breadcrumbs,
**Back**, and **Open in tab**; the latter opens a read-only `persephone-guide://...` Markdown tab.

| Element | Selector |
|---|---|
| About root / version card | `[data-name="about-root"]`, `[data-name="about-card"]` |
| Guide browser / contents tree | `[data-name="about-guide-browser"]`, `[data-name="about-guide-tree"]` |
| Agent-guide filter | `[data-name="about-show-agent-guides"]` |
| What's New / Resources | `[data-name="about-whats-new"]`, `[data-name="about-resources"]` |
| Guide page / breadcrumbs / body | `[data-name="about-guide-page"]`, `[data-name="about-guide-breadcrumbs"]`, `[data-name="about-guide-body"]` |
| Back / Open in tab | `[data-name="about-guide-back"]`, `[data-name="about-guide-open-in-tab"]` |

The Menu Bar's **User Guide** item and the global `F1` shortcut open this browser at guide
contents. `F1` opens the guide matching the active editor when one is mapped; with no match it
opens About at contents. The ordinary About item preserves an existing guide-browser location,
while User Guide explicitly returns to contents.

## Pointing at an element on screen

Describing a small grey indicator in the corner rarely lands. Draw a highlight instead: an orange
ring around the element and a card with your text and a **Close** button. The look is fixed in every
theme and context, so the user can tell that the callout came from their agent.

### In a board

`app.ui` cannot reach other frames, so inject the overlay module into the board. Read its source
once from the renderer:

```js
return await (await fetch("app-asset://agent/ui-highlight.js")).text();
```

Then use that text as `CODE` in a board-page `editor.evaluate` call:

```js
() => { CODE; return window.__persephoneHighlight.show({ selector: "#submit", text: "This is the button that submits the form." }); }
```

The module installs `window.__persephoneHighlight` with `show(options)`, `showMany([options])`,
and `clear(id?)`, with the same behavior and appearance as `app.ui.highlightElement`. Injecting it
twice is safe because an existing installation is reused.

### In a browser page — not supported

Persephone has no highlight overlay for web pages by design. Browser pages run in their own
sessions and cannot load app assets. Do not look for a way around this security boundary or tell
the user that the feature exists.

If a web page needs an explanation, style one element directly and explain the change in chat:

```js
() => { const element = document.querySelector("#submit"); if (!element) return { found: false }; element.style.outline = "2px solid #F97316"; element.style.outlineOffset = "2px"; element.scrollIntoView({ block: "nearest" }); return { found: true }; }
```

Say what was outlined and why, then clear the same properties. This mutates the page's own styles,
unlike the app-window overlay, so keep it to one element and restore it when finished.

## Answering "where is X?" reliably

1. **Prefer purpose over position.** "The Persephone glyph in the top-left corner opens the menu"
   survives a redesign; "the third button from the left" does not.
2. **Check that the element exists before pointing at it.** Zoom, overflow arrows, the reload
   button, Mneme, MCP, the language button, and the sidebar are conditional. A `found: false`
   result from `highlight` is the check.
3. **Look before describing** when the state is uncertain: `window.screen.snapshot()` shows the
   chrome plus the active page only.
4. **Highlight, then explain.** One highlight call and a sentence in chat beat a paragraph of
   layout description.

## Errors & verification

| Symptom | Meaning | Fix |
|---|---|---|
| `{ found: false, count: 0 }` | The selector matched nothing, usually because the target is conditional | Check the current state or snapshot the app window |
| `{ found: false, error: "invalid CSS selector: …" }` | The selector is malformed | Fix the selector; it is reported, not thrown |
| `count` is larger than `highlighted` | `all: true` matched more than the 20-ring cap | Narrow the selector |
| Highlight vanished | Its target left the screen after a page switch, Menu Bar close, or panel collapse | Re-highlight after restoring the UI state |
| `highlight` throws `ui-highlight.js: HTTP …` | The overlay asset could not be loaded | Report the incomplete installation and explain in chat |
| `fetch("app-asset://…")` fails in a browser page | Browser pages cannot access app assets | Use the plain-border form above |
| A tab has no language button | Its editor declares no language | Say that there is no syntax-highlighting language to change |
| A tab has no title | It is pinned and shows only icons | Read its title from `pages` |
| `[data-name="menu-bar"]` exists but no menu is visible | The backdrop is always in the DOM and is hidden when closed | Click `[data-name="persephone-menu"]` to open it |

Selectors listed by these screen guides are stable contracts. A `data-name` inside an editor,
dialog, or popup menu that is not listed here is a debug label; use `window.screen.snapshot()` for
those surfaces.

## Where to go next

- [Editors catalogue](../editors/index.md) — what each editor is for and how to open it.
- [Pages & Windows](../agents/pages.md) — editor IDs, languages, title suffixes, and page operations.
- [Browser automation](../agents/browser.md) — snapshots, refs, clicking, typing, and app-window driving.
- [Boards](../boards.md) — building a custom mini web app for the user.
