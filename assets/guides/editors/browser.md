---
title: "Browser"
audience: both
summary: "A built-in web browser for documentation, APIs, and web resources."
editorId: "browser-view"
---

# Browser

A built-in Chromium browser keeps documentation, APIs, and web resources in a Persephone tab.

## How to Open

Choose **Browser** from the arrow beside **+** when it is pinned, use the **Tools & Editors** hub,
or open a URL from a script with `pages.openUrlInBrowserTab(url, options)`. Browser, Browser Incognito,
Browser (Tor), and browser profiles are separate choices in the hub.

## Layout

```
+---------------------------------------------------------------------+
| [⌂][←][→][⟳]  [ address box            ] [→]        [★][⋮][</>][×]  |  toolbar: navigation at left, address box across middle,
|                                                                     |  Go at its right edge, bookmarks/more/devtools/close at the right
+---------------------------------------------------------------------+
| [Browser tabs] [Webview content]                                    |  browser content fills the page below the toolbar
| [Blocked popups]                                  [Allow] [Dismiss] |  blocked-popup bar at the top of browser content when present
+---------------------------------------------------------------------+
```

### User-facing label → `elements` name

- Home → `toolbar-home`
- Back → `toolbar-back`
- Forward → `toolbar-forward`
- Reload → `toolbar-reload`
- Address box → `url-input`
- Go → `url-navigate`
- Bookmark → `url-bookmark-toggle`
- Bookmarks → `toolbar-bookmarks`
- Tor info → `toolbar-tor-info`
- Downloads → `toolbar-downloads`
- More → `toolbar-more`
- DevTools → `toolbar-devtools`
- Close → `toolbar-close`
- Browser tabs → `tabs-panel-host`
- Blocked popups → `popup-blocked-bar`
- Page navigation and Editor switch → no entry: this custom browser toolbar draws neither control
- Webview page controls → no entry: third-party browser content

### When URL suggestions are open

```
+---------------------------------------------------------------------+
| [Address box] [URL suggestions]                                     |  address field with its transient suggestion surface
+---------------------------------------------------------------------+
```

### When the search-engine menu is open

```
+---------------------------------------------------------------------+
| [Address box] [Search engine choices]                               |  search-engine menu anchored to the address field
+---------------------------------------------------------------------+
```

### When the page menu is open

```
+---------------------------------------------------------------------+
| [More] [Page menu]                                                  |  page menu opened from the toolbar's More control
+---------------------------------------------------------------------+
```

### When the downloads popup is open

```
+---------------------------------------------------------------------+
| [Downloads] [Downloads popup]                                       |  downloads popup anchored to the toolbar control
+---------------------------------------------------------------------+
```

### When the bookmarks drawer is open

```
+---------------------------------------------------------------------+
| [Browser tabs] [Bookmarks drawer] [Webview content]                 |  browser content with the bookmarks drawer at the left
+---------------------------------------------------------------------+
```

### When popups are blocked

```
+---------------------------------------------------------------------+
| [Blocked popups]                                  [Allow] [Dismiss] |  blocked-popup bar with actions at the right
+---------------------------------------------------------------------+
```

### When the Tor overlay is open

```
+---------------------------------------------------------------------+
| [Tor status] [Reconnect]                                  [Close]   |  Tor overlay: status and reconnect left, close at top-right
+---------------------------------------------------------------------+
```

### Drawn controls without `elements`

- Page navigation and Editor switch — no entry: the measured browser toolbar draws neither generic control.
- URL suggestion, search-engine, page, downloads-popup, bookmarks-drawer, and Tor popup contents — no entry: transient surfaces; the stable toolbar controls are listed above.
- Webview page controls — no entry: third-party browser content.

## URL Bar

Type a URL and press `Enter`, or type a search term and use the selected search engine. The navigate
button submits the field, and its context menu offers **Paste and Go**. `Ctrl+L` focuses the URL bar.
Focusing it shows current-tab history; typing filters history, and **Clear** removes the visible
filtered entries. The search-engine label is available on blank and search-result pages and offers
Google, Bing, DuckDuckGo, Yahoo, Ecosia, Brave, Startpage, Qwant, Baidu, Perplexity, and Gibiru.

## Navigation and tabs

**Home** remembers the first URL for each tab. **Back**, **Forward**, **Reload**, and **Stop** have
the expected browser behavior, with a loading indicator below the toolbar. One Persephone page can
contain inner browser tabs, isolated profiles, incognito sessions, bookmarks, downloads, find-in-page,
DevTools (`F12`), and session restore.

## Agent API

After narrowing `pages[i].editor.id` to `browser-view`, the `BrowserEditor` facade exposes browser
tabs and the automation surface: snapshots, clicks, typing, key presses, evaluation, waiting,
screenshots, network requests, and tab selection. The verified chrome elements include `url-input`,
`url-navigate`, `url-bookmark-toggle`, `toolbar-back`, `toolbar-forward`, `toolbar-reload`,
`toolbar-home`, `toolbar-bookmarks`, `toolbar-tor-info`, `toolbar-downloads`, `toolbar-more`,
`toolbar-devtools`, `toolbar-close`, `tabs-panel-host`, and `popup-blocked-bar`.
Participating web pages may additionally publish a page-authored model at `page.editor.app`; it
offers the page's help, hints, state, methods, elements, and in-frame `highlight(...)`. Its kinds
are prefixed `page:` and its content remains confined to `.app`. User-opened private pages are
refused before this model is probed. See [Browser automation](../agents/browser.md) for details.

## Errors and limits

Use `pages.openUrlInBrowserTab` rather than `pages.addEditorPage` for Browser. Network failures,
blocked popups, certificate errors, and pages requiring browser permissions remain browser states;
they are not editor-format errors. The browser's page automation is available only after its tab is
ready.
