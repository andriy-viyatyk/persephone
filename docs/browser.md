[← Editors](./editors.md)

# Browser

A built-in web browser for viewing documentation, APIs, and web resources without leaving js-notepad.

**Opening:** Click the dropdown arrow (&#9662;) next to the **+** button → **Browser** (if pinned), or open the **Tools & Editors** sidebar panel to find Browser, Browser Incognito, and individual browser profiles.

---

## URL Bar

- Type a **URL** and press `Enter` to navigate
- Type a **search term** to search with the selected engine
- **Navigate button** at the end of the input — click to go
- **Paste and Go** — right-click the URL bar for a "Paste and Go" option that pastes clipboard text and navigates immediately
- Press `Ctrl+L` to quickly jump to the URL bar

### URL Suggestions

A dropdown appears when you focus or type in the URL bar:

- **On focus:** shows navigation history (URLs visited in the current tab)
- **On typing:** shows filtered search history with highlighted matches
- Navigate with arrow keys, select with `Enter`, dismiss with `Escape`
- **"Clear" button** removes visible filtered entries from search history

### Search Engine Selector

A clickable label appears in the URL bar on blank pages and search result pages:

- **11 engines:** Google (default), Bing, DuckDuckGo, Yahoo, Ecosia, Brave, Startpage, Qwant, Baidu, Perplexity, Gibiru
- Switch engines on a search results page to **re-search the same query** on a different engine
- Selected engine is remembered per browser tab

---

## Navigation

- **Home** — each tab remembers its "home" URL (first URL navigated to); tooltip shows the URL
- **Back / Forward** — standard browser navigation
- **Reload / Stop** — reload the current page or stop a pending load
- **Loading indicator** — animated bar below the toolbar while a page is loading

---

## Internal Tabs

Multiple browser tabs live within a single js-notepad tab, shown on a left-side panel.

- Clicking `target="_blank"` links opens a **new internal tab**
- `window.open()` from JavaScript opens a **real popup window** (for OAuth/auth flows)
- **Close Tab** button in the toolbar; **New Tab** button at the bottom of the tabs panel
- Right-click a tab for context menu: **Close Tab**, **Close Other Tabs**, **Close Tabs Below**
- Resizable tabs panel with splitter; **starts collapsed to icon-only mode**
- Active tab styled with dark background and blue border
- **Compact mode** — when the panel is narrow, hovering a tab shows a floating popup with title and close button
- Closing the last tab opens a fresh blank page

### Audio Controls

- **Volume icon** appears on tabs playing audio — click to mute/unmute individual tabs
- **Page-level mute** — volume icon on the js-notepad page tab when any internal tab is audible; click to mute/unmute all internal tabs at once
- Both tab-level and page-level must be unmuted for sound to play

---

## Browser Profiles

Each profile provides an **isolated browsing session** with its own cookies, localStorage, and cache — completely separated from other profiles and from the application itself.

### Managing Profiles

Go to **Settings → Browser Profiles**:

- **Default profile** — always present, cannot be removed
- **Add profiles** — type a name and pick a color from the palette
- **Set default** — the **Browser** quick-add item uses the default profile
- **Profile color** — click the color dot to change; shown on the page tab icon (tinted globe)
- **Clear data** — clears cookies, storage, and cache for a single profile
- **Delete** — confirmation dialog; also clears all data from disk

### Opening a Profiled Browser

- Click &#9662; → **Browser** to open with the default profile
- Click &#9662; → **Browser profile...** → select a named profile or **Incognito**

### Incognito Mode

- Ephemeral browsing — **no data is persisted**
- Incognito icon shown on the page tab and inside the URL bar
- All cookies, storage, and cache are automatically discarded when the tab closes
- Search history is not saved
- Bookmarks still work normally in incognito (only browsing data is ephemeral)

---

## Bookmarks

Per-profile bookmark management using `.link.json` files. Each browser profile can be associated with a different bookmarks file — configure in **Settings → Browser Profiles**.

### Quick Bookmark (Star Button)

The **star button (☆)** in the URL bar lets you quickly bookmark or edit the current page:

- **Empty star** when URL is not bookmarked; **filled star** when already bookmarked
- Click to open the **Edit Link Dialog** with URL and title prefilled
- **Discovered images** from page meta tags and click tracking are shown in the dialog for choosing a thumbnail

### Bookmarks Panel

Click the **"Open Links" button** on the toolbar to open a sliding bookmarks panel:

- Right-anchored overlay drawer with backdrop
- Full **Link Editor** inside — categories, tags, search, and all view modes (list and tile variants)
- Click a link to navigate (in current tab if blank, otherwise new internal tab)
- Drawer closes automatically after clicking a link
- Resizable width; Categories/Tags panel on the right side
- Press `Escape` to close

### Context Menu Bookmarking

- Right-click a **link** on a web page → **"Add to Bookmarks"** — captures URL, title, and image
- Right-click an **image** → **"Use Image for Bookmark"** — tracks the image for the next bookmark

### Blank Page

When a bookmarks file is configured for the current profile, new blank tabs display your bookmarks directly instead of an empty page:

- Click a link to **navigate the current tab**
- `Ctrl+Click` opens the link in a **new internal tab**, keeping bookmarks visible on the original tab
- Encrypted bookmark files are not unlocked automatically on blank page load — use the star button or bookmarks drawer to trigger decryption, after which the blank page will show the links

### Additional Details

- **Image discovery** — automatically collects images from page meta tags (`og:image`, `twitter:image`), clicked link elements, and context menu items for bookmark thumbnails
- **Encrypted bookmarks** — supports encrypted `.link.json` files; a password dialog appears on first access via the star button or bookmarks drawer
- **Auto-save** — all edits are automatically saved to the `.link.json` file
- If no bookmarks file is associated with the profile, clicking the star or bookmarks button prompts you to select or create a file

---

## Downloads

A download button in the toolbar tracks download progress and provides a download history.

### How It Works

1. Click a download link on a web page
2. A **save dialog** appears — choose where to save the file
3. The download button shows a **circular progress ring** while downloads are active (icon turns active color)
4. Click the button to open the **Downloads popup**

### Downloads Popup

- Scrollable list of all downloads (most recent at top)
- **Active downloads** show a progress bar with received/total bytes and a **Cancel** button
- **Completed downloads** show **"Open"** (launches file with default app) and **"Show in Folder"** (opens Explorer with file selected) buttons
- **Failed or cancelled** downloads show status text
- **"Clear" button** dismisses completed and failed entries

### Persistence

- Download list is **global** — shared across all browser pages and windows
- Last **5 completed downloads** are remembered across app restarts

---

## Context Menu

Right-click in the web page for contextual actions:

| Context | Actions |
|---------|---------|
| On a link | "Open Link in New Tab", "Copy Link Address", "Add to Bookmarks" |
| On an image | "Open Image in New Tab" (opens in Image Viewer), "Copy Image Address", "Use Image for Bookmark" |
| On selected text | "Copy" |
| On an editable field | "Cut", "Copy", "Paste" |
| On an SVG element | "Open SVG in Editor" (opens in text editor with XML syntax) |
| Always available | "Back", "Forward", "Reload", "View Source", "View Actual DOM", "Inspect Element" |

- **View Source** — view the raw HTML as fetched from the server (opens in a text tab)
- **View Actual DOM** — view the live rendered DOM after JavaScript execution (opens in a text tab)
- **Inspect Element** — opens DevTools focused on the clicked element

---

## Find in Page

Press `Ctrl+F` to open the search bar (works whether focus is on the toolbar or inside the web page):

- **Match counter** — shows "3 of 15" or "No results"
- **Next/Previous** — `Enter` or `F3` for next match, `Shift+Enter` or `Shift+F3` for previous
- **Close** — `Escape` or close button; clears all highlights
- The search bar closes automatically when navigating to a different page or switching internal tabs

---

## Default Browser Registration

js-notepad can register itself as the **Windows default browser** so that clicking links in other applications (email, chat, documents) opens them in js-notepad's browser.

### How to Register

1. Go to **Settings → Default Browser**
2. Click **Register** — this writes registry keys to HKCU (no admin privileges required)
3. Click **"Open Windows Default Apps"** — this navigates directly to the js-notepad page in Windows Settings
4. In Windows Settings, set js-notepad as the default for HTTP/HTTPS links

### How It Works

- URLs received from the OS always open in the internal browser tab using the **default profile**, regardless of the "Link open behavior" setting
- Works on cold start (via command-line arguments) and when js-notepad is already running (via the launcher's named pipe)
- To unregister, click **Unregister** in Settings — all registry keys are removed

---

## Link Open Behavior

External links clicked in the **text editor** (Monaco) or **Markdown preview** can open in the default OS browser or in js-notepad's internal browser.

Configure in **Settings → Links**:

- **Default browser** (default) — opens links in your OS browser
- **Internal browser** — opens links in the active browser page if one is focused, otherwise searches right then left from the active page. Empty browser tabs (`about:blank`) are reused. If no browser tab exists, a new one is created with the default profile

The **Markdown preview** also provides a link context menu with explicit options: "Open in Default Browser", "Open in Internal Browser", browser profiles, and "Open in Incognito".

---

## Popup Blocking

Sites that try to open excessive popups or tabs are automatically rate-limited:

- A **notification bar** appears: "Popups blocked from this site"
- Click **"Allow"** to temporarily permit popups for the current page
- Single user-initiated clicks (OAuth, payment confirmations) are not affected

---

## Session Restore

The browser saves and restores the following across app restarts:

- All internal tabs and their URLs
- Navigation history per tab
- Profile selection
- Search engine selection and last search query
- Search history (per profile, not saved for incognito)
- Tabs panel width
- Bookmarks panel width
- Home URL per tab

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+L` | Focus URL bar |
| `Ctrl+F` | Find in page (open search bar) |
| `F3` | Next match (when find bar is open) |
| `Shift+F3` | Previous match (when find bar is open) |
| `F5` | Reload page |
| `Ctrl+F5` / `Ctrl+Shift+R` | Hard reload (bypass cache) |
| `Ctrl+R` | Reload (alias) |
| `F12` | Open DevTools |
| `Alt+Left` | Go back |
| `Alt+Right` | Go forward |
| `Alt+Home` | Go to home page |
| `Escape` | Close find bar / stop loading / close bookmarks panel |

These shortcuts work regardless of where focus is within the browser page.

---

## Additional Details

- **Page title** — shown in the js-notepad tab (reflects the active internal tab)
- **Favicon** — website icon displayed in the internal tabs panel
- **DevTools** — click the gear icon or press `F12` to open the webview's developer tools
- **Isolated storage** — each profile has its own cookies, storage, and cache, separated from the application
- **Automatic cache cleanup** — HTTP cache, compiled code cache, and service worker caches are cleared when a browser page is closed to save disk space; cookies and site data are preserved
- **Security** — navigation to local file protocols (`file://`, `app-asset://`) is blocked
