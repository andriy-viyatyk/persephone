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
| [⌂][←][→][⟳]  [Proxy][Site permissions / Search engine][ address box ] [→] [★][⋮][</>][×] | toolbar: navigation at left, address box across middle
|                                                                     |  (proxy chip inside it when routed), Go at its right edge,
|                                                                     |  bookmarks/more/devtools/close at the right
+---------------------------------------------------------------------+
| [Browser tabs] [Webview content]                                    |  browser content fills the page below the toolbar
| [Blocked popups]                                  [Allow] [Dismiss] |  blocked-popup bar at the top of browser content when present
| [Origin requests permission for access] [Allow] [Block]             |  prompt bar for the active inner tab when present
+---------------------------------------------------------------------+
```

### User-facing label → `elements` name

- Home → `toolbar-home`
- Back → `toolbar-back`
- Forward → `toolbar-forward`
- Reload → `toolbar-reload`
- Address box → `url-input`
- Site permissions (HTTP(S) page, while no address text has been typed) → `url-site-permissions`
- Proxy chip (shown when the page's network is a proxy) → `url-proxy-indicator`
- Go → `url-navigate`
- Bookmark → `url-bookmark-toggle`
- Bookmarks → `toolbar-bookmarks`
- Tor info (shown only on Tor pages) → `toolbar-tor-info`
- Downloads → `toolbar-downloads`
- More → `toolbar-more`
- DevTools → `toolbar-devtools`
- Close → `toolbar-close`
- Browser tabs → `tabs-panel-host`
- Blocked popups → `popup-blocked-bar`
- Permission request (active inner tab only) → `browser-permission-prompt`
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

### When site permissions are open

```
+---------------------------------------------------------------------+
| [Site permissions] [Origin]                                         |  popover below the address box control
| [Permission switches, with Ask for undecided entries]               |
| [Reset permissions] [Reload the page to apply] [Reload]             |
+---------------------------------------------------------------------+
```

The Site permissions button appears for HTTP(S) pages while no address text has been typed.
It takes the search-engine selector's place when that selector is available. The popover lists
permissions for the current origin; undecided permissions show **Ask**. Changing a switch saves an
Allow or Block choice. **Reset permissions** returns that origin's saved choices to Ask, and
**Reload** applies changed choices to the current page.

### When a page asks for permission

```
+---------------------------------------------------------------------+
| [Origin] wants permission to access [requested capabilities] [Allow] [Block] |  above browser content
+---------------------------------------------------------------------+
```

Only requests from the active inner tab show here. Allow and Block remember the choice for that
site in a regular browser profile. Incognito and Tor keep choices only for the life of their
session.

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
- URL suggestion, search-engine, site-permissions popover, page, downloads-popup, bookmarks-drawer, and Tor popup contents — no entry: transient surfaces; the stable toolbar controls are listed above.
- Webview page controls — no entry: third-party browser content.

## URL Bar

Type a URL and press `Enter`, or type a search term and use the selected search engine. The navigate
button submits the field, and its context menu offers **Paste and Go**. `Ctrl+L` focuses the URL bar.
Focusing it shows current-tab history; typing filters history, and **Clear** removes the visible
filtered entries. The search-engine label is available on blank and search-result pages and offers
Google, Bing, DuckDuckGo, Yahoo, Ecosia, Brave, Startpage, Qwant, Baidu, Perplexity, and Gibiru.

## Site permissions and prompts

On an HTTP(S) page, the **Site permissions** button appears at the start of the address field until
you type into the address field. It opens the current site's permission choices. Camera,
microphone, location, notifications, MIDI, clipboard reading, and other prompted capabilities can
be set to **Allow** or **Block**; **Ask** means there is no saved choice. Some permission requests
show a bar above the page with the requesting site and requested access. Choose **Allow** or
**Block** to answer. Choices for regular profiles are saved between app runs. Incognito and Tor
choices stay in memory for that private session and are discarded when it ends.

## Navigation and tabs

**Home** remembers the first URL for each tab. **Back**, **Forward**, **Reload**, and **Stop** have
the expected browser behavior, with a loading indicator below the toolbar. One Persephone page can
contain inner browser tabs, isolated profiles, incognito sessions, bookmarks, downloads, find-in-page,
DevTools (`F12`), and session restore. An active browser page handles `F12` for its own DevTools;
when no browser page claims it, `F12` opens Persephone's DevTools.

Click **+** at the bottom of the browser tab panel to create a blank inner tab; the URL bar is focused
ready for a URL or search. Tabs opened at a specific URL leave focus with the page.

Videos can use their own fullscreen control to fill the app window. Press `Esc` to leave fullscreen,
even when keyboard focus is in Persephone rather than the page. Fullscreen also ends when you close
the browser tab or leave it hidden.

When a page link uses a scheme registered by a trusted board, clicking it leaves the browser tab and
opens the link through Persephone's normal content pipeline. Unregistered non-web schemes remain
blocked rather than being sent to Chromium.

## Profile network (proxy)

Every browser profile — a named profile, the built-in Default profile, and Incognito — can be set to
route its traffic through a proxy instead of your normal direct connection. Set it in
**Settings → Browser Profiles**: each profile row, the Default row, and the Incognito row have a
**Network:** control with **Direct**, **SOCKS5 proxy**, or **HTTP proxy**, plus a host and port field
when a proxy is selected. Proxy credentials are not supported — use an unauthenticated local endpoint,
such as a SOCKS5 listener exposed by a VPN client running in WSL2.

A proxied page shows a small chip next to the address box, with a tooltip naming the protocol and
endpoint (for example `Proxy: SOCKS5 127.0.0.1:1080`). Click it to open a connection-info dialog
reporting the egress IP address and its approximate location, looked up through that same proxy —
the same dialog Tor uses, minus the Tor-only exit-node verdict and Reconnect button. This is distinct
from the separate **Tor info** button and Tor overlay, which only appear on **Browser (Tor)** pages;
a profile's proxy setting and Tor mode do not mix.

A proxied page never falls back to your normal connection. If the proxy is not running or cannot be
reached, pages fail to load with the browser's own connection error (for example
`ERR_SOCKS_CONNECTION_FAILED`) — start the proxy and reload. If the proxy setting itself is invalid
(for example a host name with a space, typed straight into the settings file), the page shows an
error panel with a **Retry** button instead of any content until the setting is fixed. Editing a profile's network while its pages are open reapplies the
change immediately and closes existing connections; already-loaded pages keep showing their old
content until reloaded. Everything the proxied profile requests — page loads, downloads, tab and
bookmark-drawer favicons, and Link editor preview images — is routed through the same proxy. The one
exception is the resources list opened by **Show Resources** (in the page menu or a right-click): it
is a separate Link page outside the profile's session, so on a Tor or proxied page its tiles show no
thumbnails rather than loading them directly, and opening an entry from it uses your normal connection.

Local addresses (`localhost` and link-local addresses) are never sent through the proxy, matching
ordinary browser behavior; routing them to a remote proxy would only break local development without
adding privacy. WebRTC on a proxied or Tor page is restricted to the proxy connection, so it cannot
reveal your local or public IP address outside it.

## Windows single sign-on

On Windows, turn on **Allow Windows single sign-on for Microsoft, work, and school accounts** in
**Settings → Browser Profiles** to let regular browser profiles, including Default, use the device's
Windows sign-in proof on supported Microsoft sign-in pages. This can help work or school accounts
satisfy company sign-in rules that require a registered device. The setting is global and off by
default.

The proof is requested only for HTTPS page or frame navigations to `login.microsoftonline.com` and
`login.live.com`. It is obtained from Windows for each eligible request and is not used by Incognito
or Tor pages. If Windows cannot provide it, the browser continues the sign-in without it.

## Agent API

After narrowing `pages[i].editor.id` to `browser-view`, the `BrowserEditor` facade exposes browser
tabs and the automation surface: snapshots, clicks, typing, key presses, evaluation, waiting,
screenshots, network requests, and tab selection. The verified chrome elements include `url-input`,
`url-navigate`, `url-bookmark-toggle`, `toolbar-back`, `toolbar-forward`, `toolbar-reload`,
`toolbar-home`, `toolbar-bookmarks`, `toolbar-tor-info`, `toolbar-downloads`, `toolbar-more`,
`toolbar-devtools`, `toolbar-close`, `tabs-panel-host`, `popup-blocked-bar`, and, on a proxied page,
`url-proxy-indicator`.
Participating web pages may additionally publish a page-authored model at `page.editor.app`; it
offers the page's help, hints, state, methods, elements, and in-frame `highlight(...)`. Its kinds
are prefixed `page:` and its content remains confined to `.app`. User-opened private pages are
refused before this model is probed. See [Browser automation](../agents/browser.md) for details.

## Errors and limits

Use `pages.openUrlInBrowserTab` rather than `pages.addEditorPage` for Browser. Network failures,
blocked popups, certificate errors, and pages requiring browser permissions remain browser states;
they are not editor-format errors. The browser's page automation is available only after its tab is
ready. A proxied page whose proxy is down fails with the browser's connection error; one whose proxy
setting is invalid shows an error panel instead of any webview — fix the setting, then use **Retry**.
