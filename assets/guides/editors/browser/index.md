---
title: "Browser"
audience: both
summary: "How do users and agents open, navigate, and automate the built-in browser?"
editorId: "browser-view"
---

# Browser

Scripts and agents can fullscreen a visible browser video using `pages[id].editor.fullscreen()`;
`exitFullscreen()` exits it and returns `{ fullscreen: false }`. Both report guest HTML state,
separate from host fullscreen. The active tab must be visible; private pages are protected unless
opened by the agent. Without a selector, playing videos across frames are preferred, then largest
frame-local area. A CSS selector matches the largest visible main-frame element only. Iframe
permissions may reject a request; use the player's own fullscreen button when needed.

TV recipe: `moveToDisplay('largest')` first, then `pages[id].editor.fullscreen()`. A video already
in fullscreen is restored after the window moves when `fullscreen` is omitted. Use `getDisplays()` to
inspect fresh zero-based indexes and DIP geometry; largest/smallest compare bounds area and other
is relative to the window. Through MCP use `windows[i].window` and `windows[i].pages[id]` for a
specific live window. Host `setFullScreen(false)` exits guest fullscreen too.

A built-in Chromium browser keeps documentation, APIs, and web resources in a Persephone tab.

Boards can create a private Run page with bridge **1.46.0+** by calling
`persephone.openRawLink(url, { editor: "browser-view", reuseKey })`. The page is owned by that
board root and reuse key; it does not select or navigate a user's Browser page or another board's
Run page. When the active tab still shows the requested URL, repeating the call hard-reloads it to
pick up regenerated local HTML. If the user switched tabs or navigated away, the call navigates
back to the requested URL; web URL path and query case is significant when matching. If the page was
closed, the next call creates a fresh Browser page with one tab.

## How to Open

Choose **Browser** from the arrow beside **+** in its category or under **Other**, use the **Tools & Editors** hub,
or open a URL from a script with `pages.openUrlInBrowserTab(url, options)`. Browser, Browser Incognito,
Browser (Tor), and browser profiles are separate choices in the hub.
Incognito and Tor pages save nothing to disk (pages, searches, downloads) and do not reopen after a
restart.


## URL Bar

Type a URL and press `Enter`, or type a search term and use the selected search engine. The navigate
button submits the field, and its context menu offers **Paste and Go**. `Ctrl+L` focuses the URL bar.
Focusing it lists the pages visited in the current tab; once you type, it lists your earlier search
queries that match the text, and **Clear** removes the visible entries. The search-engine label is
available on blank and search-result pages and offers Google, Bing, DuckDuckGo, Yahoo, Ecosia, Brave,
Startpage, Qwant, Baidu, Perplexity, and Gibiru.
The engine you pick is preselected in new browser pages. Incognito and Tor pages remember their
own choice, separate from profile pages.

Unfocused, the bar emphasises the site's host and marks plain-HTTP sites **Not secure**
([details](layout.md#how-the-url-bar-shows-a-page)).

## Site permissions and prompts

On an HTTP(S) page, the **Site permissions** button appears at the start of the address field until
you type in it. It opens the current site's permission choices. Camera, microphone, location,
notifications, MIDI, clipboard reading, and other prompted capabilities can be set to **Allow** or
**Block**; **Ask** means there is no saved choice. Some requests show a bar above the page naming
the site and the access; answer with **Allow** or **Block** (file access and embedded frames:
[layout](layout.md#when-a-page-asks-for-permission)). Choices for regular profiles are saved between
app runs. Incognito and Tor choices stay in memory for that private session and end with it.

On HTTPS pages, the site-info popover also has **View certificate**
([details](layout.md#when-site-permissions-are-open)).

## Site extensions

When a site extension matches a regular browser page, a bar above the page names the extension
and the hosts where it may run. **Trust** allows its script to run with the capabilities available
to that signed-in site's session; **Not now** declines the prompt. Trust only extensions you want
to run. An agent may choose Trust only when you ask it to. If the extension's host list changes,
Persephone asks for trust again. Extensions never run in Incognito or Browser (Tor) pages.

Manage the folder, trust, and installed extensions in [Site Extensions](../../site-extensions.md).

## Navigation and tabs

**Home** remembers the first URL for each tab. **Back**, **Forward**, **Reload**, and **Stop** have
the expected browser behavior, with a loading indicator below the toolbar. One Persephone page can
contain inner browser tabs, isolated profiles, incognito sessions, bookmarks, downloads, find-in-page,
DevTools (`F12`), and session restore. An active browser page handles `F12` for its own DevTools;
when no browser page claims it, `F12` opens Persephone's DevTools.

Click **+** at the bottom of the browser tab panel to create a blank inner tab; the URL bar is focused
ready for a URL or search. Tabs opened at a specific URL leave focus with the page.

A web page can open web addresses in new tabs and windows (**Open Link in New Tab**, links and
scripts that open a new window), but not a local file, a `data:` URL, or another address a page has
no business opening; **Open Image in New Tab** likewise refuses a local image. To open such an
address yourself, paste it into the URL bar.

### Downloads

Select **Downloads** in the toolbar to see current and completed downloads. Active downloads show
their progress and can be cancelled. For every completed download, choose **Open in Windows Default
App** to hand it to Windows. When Persephone has a matching built-in editor, installed board, or
Monaco language for the file type, **Open in Persephone** also opens the file in a Persephone tab.
**Show in Folder** opens its location in File Explorer. Use **Clear** in the popup header to remove
completed, failed, and cancelled entries from the list. Incognito and Tor pages list only their own
downloads.

### Page zoom

The percentage button in the toolbar shows the active browser tab's page zoom. Select it to use the
vertical slider or choose a preset from 50% to 200%; scroll over the popover to change zoom in 5%
steps. Each inner tab keeps its own zoom across navigation and normal session restore. Page zoom is
relative to Persephone's window zoom, so changing the window zoom also scales the page.

With focus on the web page, `Ctrl+=` or `Ctrl++` zooms in, `Ctrl+-` zooms out, `Ctrl+0` resets to
100%, and `Ctrl+Mouse Wheel` changes zoom in 5% steps. With focus on Persephone's controls, these
shortcuts change the window zoom instead.

### Cinema mode

Move the pointer over a video to show the **Cinema Mode** button, then select it to expand the video
across the browser page and hide the surrounding page content. This also works for videos embedded
in nested frames. Select the button again or press `Esc` to leave cinema mode and restore the page.
If an embedded video cannot show its own button, the button appears over the video from its
containing page. Videos that do not resize with their player are fitted to the expanded view.

Videos can also use their own fullscreen control to fill the app window; a notice names the site
and `Esc`. Press `Esc` to leave fullscreen, even when keyboard focus is in Persephone rather than the
page. Fullscreen also ends when you close the browser tab or leave it hidden.

A page link to a scheme registered by a trusted board opens in that board once you allow it for the
site ([details](layout.md#when-a-page-asks-for-permission)). Other non-web schemes stay blocked.

## Show Resources

Choose **Show Resources** from the page menu or the page's right-click menu to open a categorized
link collection. It includes fonts loaded by the page, including fonts loaded from stylesheets and
the cache. Favicons open in Image Viewer, and audio and video resources open in Video Player. A font
can open in an installed custom editor that supports its file type and web URLs.

## Translate a page

Choose **Translate** in the browser toolbar to translate the current page in place. The page keeps
its layout, and choosing Translate again restores the original. If the source language is not
detected, choose it in the Translate popup. To change the destination, open **Settings → Browser
Profiles → Translate pages into**; **App language** follows Persephone's language setting. Persephone
asks before downloading missing language models and shows progress. Translation applies only to the
current page load.

Install and trust the **Translate** board from the board catalog to provide translation. It
downloads language models as needed and can translate offline after the models are available.


## Read next

| What you need | Page (object-model path) |
|---|---|
| Browser layout | [layout](layout.md) - `guides.editors.browser.layout` |
| Network, sign-on, agent API and errors | [network-and-agent](network-and-agent.md) - `guides.editors.browser["network-and-agent"]` |
