---
title: "Browser Layout"
audience: both
summary: "How are the browser toolbar, URL bar, and page controls arranged and used?"
---

# Browser Layout

## Layout

```
+---------------------------------------------------------------------+
| [⌂][←][→][⟳]  [Proxy][Site permissions / Search engine][ address box ] [→][Site actions*][Translate][★] [100%][Bookmarks][Downloads][⋮][</>][×] | toolbar: navigation at left, address box across middle
|                                                                     |  (proxy chip inside it when routed), Go, Site actions* (when published), Translate and Add Bookmark at its right edge,
|                                                                     |  page zoom before Bookmarks, Downloads, More, DevTools and Close at the right
+---------------------------------------------------------------------+
| [Browser tabs] [Webview content]                                    |  browser content fills the page below the toolbar
| [Blocked popups]                                  [Allow] [Dismiss] |  blocked-popup bar at the top of browser content when present
| [Origin requests permission for access] [Allow] [Block]             |  prompt bar for the active inner tab when present
| [Site extension wants to run on this host] [Trust] [Not now]       |  trust bar when an extension matches the regular page
+---------------------------------------------------------------------+
```

### User-facing label → `elements` name

- Home → `toolbar-home`
- Back → `toolbar-back`
- Forward → `toolbar-forward`
- Reload → `toolbar-reload`
- Translate (when a provider is available) → `toolbar-translate`
- Address box → `url-input`
- Site permissions (HTTP(S) page, while no address text has been typed) → `url-site-permissions`
- Proxy chip (shown when the page's network is a proxy) → `url-proxy-indicator`
- Go → `url-navigate`
- Site actions (when the active page has published actions) → `toolbar-site-actions`
- Bookmark → `url-bookmark-toggle`
- Page zoom → `toolbar-page-zoom`
- Bookmarks → `toolbar-bookmarks`
- Tor info (shown only on Tor pages) → `toolbar-tor-info`
- Downloads → `toolbar-downloads`
- More → `toolbar-more`
- DevTools → `toolbar-devtools`
- Close → `toolbar-close`
- Browser tabs → `tabs-panel-host`
- Blocked popups → `popup-blocked-bar`
- Permission request (active inner tab only) → `browser-permission-prompt`
- Permission request origin → `permission-origin`
- Allow / Block permission request → `permission-allow`, `permission-block`
- Site extension Trust (when available) → `site-extension-trust`
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

### When page zoom is open

```
+---------------------------------------------------------------------+
| [Page zoom] [Slider] [200%]                                        |  page zoom popover below the toolbar control
|             [Slider] [150%]                                        |
|             [Slider] [100%]                                        |
|             [Slider]  [75%]                                        |
|             [Slider]  [50%]                                        |
+---------------------------------------------------------------------+
```

### When the downloads popup is open

```
+---------------------------------------------------------------------+
| [Downloads] [Downloads popup]                                       |  popup with download entries and their available actions
+---------------------------------------------------------------------+
```

While this transient popup is open, Cancel uses `downloads-cancel`, failed or cancelled rows use
`downloads-dismiss`, and completed rows use `downloads-show-in-folder`. The popup itself is also
transient and is not a permanent shell element.

When the translation popover is open, its transient popover root is
`[data-name="translation-source-popover"]` and its source-language selector is
`[data-name="translation-source-language"]`. These selectors are available through
`window.screen` while the popover is open; they are outside the page-scoped browser element list.

### When site permissions are open

```
+---------------------------------------------------------------------+
| [Site permissions] [Origin]                                         |  popover below the address box control
| [Built-in or site-extension ai-vision badge, when available]        |  model source shown above the origin when registered
| [Permission switches, with Ask for undecided entries]               |
| [Reset permissions] [Reload the page to apply] [Reload]             |
+---------------------------------------------------------------------+
```

The Site permissions button appears for HTTP(S) pages while no address text has been typed.
It takes the search-engine selector's place when that selector is available. The popover lists
permissions for the current origin; undecided permissions show **Ask**. Changing a switch saves an
Allow or Block choice. **Reset permissions** returns that origin's saved choices to Ask, and
**Reload** applies changed choices to the current page. On regular pages, the icon is green when a
registered model comes from the page, and blue when a trusted site extension has successfully run
in the current document and a model is registered. The popover labels the source as **built-in
ai-vision** or **site extension ai-vision**, with the extension name when applicable. Trust alone
does not show an indicator, and no indicator appears without a registered model. Incognito and Tor
pages never show it.

### When a page asks for permission

```
+---------------------------------------------------------------------+
| [Origin] wants permission to access [requested capabilities] [Allow] [Block] |  above browser content
+---------------------------------------------------------------------+
```

Only requests from the active inner tab show here. Allow and Block remember the choice for that
site in a regular browser profile. Incognito and Tor keep choices only for the life of their
session.

As in Chrome, an embedded frame from another site can't ask for notifications or external links,
and it can't use the permission you gave the page around it. Camera, microphone, location and
similar access reaches an embedded frame only when the page delegates it; the bar then names the
page's site, which is the site the choice is saved for.

When a site asks to edit files in a folder you picked, view the files in a folder, or save changes
to a file, the bar names the site and the path. **Allow** and **Block** answer that one request and
are not saved. Sites can't pick a drive root, your user folder, AppData, Windows, Program Files, or
Persephone's own folders — those picks fail without a prompt.

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

The bar counts tabs and windows the page tried to open without a click in it. **Allow** lets the tab
that was blocked open them from its current site until that tab moves to another site; other tabs and
sites are not affected.

### When the Tor overlay is open

```
+---------------------------------------------------------------------+
| [Tor status] [Reconnect]                                  [Close]   |  Tor overlay: status and reconnect left, close at top-right
+---------------------------------------------------------------------+
```

### Drawn controls without `elements`

- Page navigation and Editor switch — no entry: the measured browser toolbar draws neither generic control.
- URL suggestion, search-engine, page, page-zoom, downloads-popup, bookmarks-drawer, and Tor popup contents — no entry: transient surfaces. The browser facade separately lists `site-certificate-view`, which is available in the HTTPS site-info popover.
- Webview page controls — no entry: third-party browser content.

