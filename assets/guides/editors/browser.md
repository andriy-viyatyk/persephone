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
`toolbar-home`, `toolbar-bookmarks`, `toolbar-more`, `toolbar-devtools`, `toolbar-close`,
`toolbar-tor-info`, `tabs-panel-host`, and `popup-blocked-bar`.

## Errors and limits

Use `pages.openUrlInBrowserTab` rather than `pages.addEditorPage` for Browser. Network failures,
blocked popups, certificate errors, and pages requiring browser permissions remain browser states;
they are not editor-format errors. The browser's page automation is available only after its tab is
ready.
