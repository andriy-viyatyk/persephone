---
title: "Settings"
audience: both
summary: "Where Settings lives, how its sections work, and the settings that affect Persephone's screens and services."
screen: "settings"
editorId: "settings-view"
---

# Settings

Settings opens as an ordinary page from the Menu Bar gear icon, `[data-name="menubar-settings"]`.
It is a fixed-order editor. The page shows the settings that have UI controls, while the settings
object and its file also contain a few values that are intentionally get/set-only.

When connected over MCP, read `settings.sections` for the fixed-order catalogue of 14 sections and
25 setting rows plus one page action. Use `settings.highlight(key)` to open or activate Settings and point at the
containing section; `key` is a settings key, not a DOM selector.

## Layout

```
+---------------------------------------------------------------------+
| [Settings content]                                                  |  centered Settings content below the page toolbar
| [Theme]                                                             |  Settings content, Theme section
| [Window Behavior]                                                   |  Settings content, Window Behavior section
| [Editor Behavior]                                                   |  Settings content, Editor Behavior section
| [Browser Profiles]                                                  |  Settings content, Browser Profiles section
| [Links]                                                             |  Settings content, Links section
| [Default Browser]                                                   |  Settings content, Default Browser section
| [File Search]                                                       |  Settings content, File Search section
| [MCP Server / Mneme]                                                |  Settings content, MCP Server / Mneme section
| [Git Integration]                                                   |  Settings content, Git Integration section
| [Board Environment Variables]                                       |  Settings content, Board Environment Variables section
| [Script Library]                                                    |  Settings content, Script Library section
| [Drawing Library]                                                   |  Settings content, Drawing Library section
| [Video Player]                                                      |  Settings content, Video Player section
| [Terminal]                                                          |  Settings content, Terminal section
| [View Settings File]                                                |  bottom of Settings content
+---------------------------------------------------------------------+
```

### User-facing label → `elements` name

- Settings root → no entry: region root; the content anchor is addressable
- Settings content → no entry: region container; section anchors are addressable
- Theme → `theme`
- Window Behavior → `window.close-to-tray`
- Editor Behavior → `editor.word-wrap`
- Browser Profiles → `browser-profiles`, `browser-default-profile`, `browser-default-bookmarks-file`, `browser-incognito-bookmarks-file`, `tor.exe-path`, `tor.socks-port`, `tor.bookmarks-file`
- Links → `link-open-behavior`
- Default Browser → no entry: section has no catalog setting row
- File Search → `search-extensions`, `search-exclude`
- MCP Server / Mneme → `mcp.enabled`, `mcp.port`, `main.scripting.enabled`, `mneme.enabled`, `mneme.port`
- Git Integration → `git.enabled`
- Board Environment Variables → `board-vars.file`
- Script Library → `script-library.path`
- Drawing Library → `drawing.library-path`
- Video Player → `vlc-path`, `video-stream.port`
- Terminal → `terminal.command`
- View Settings File → `settings-view-file`

### When Settings sections are expanded and visible

```
+---------------------------------------------------------------------+
| [fixed-order section scroll surface]                                |  Settings content scroll surface
| [View Settings File]                                                |  bottom of Settings content
+---------------------------------------------------------------------+
```

## Editor Behavior

The **Editor Behavior** section contains **Enable Word Wrap by default**, which is off by default.
It controls the initial wrapping state only when a newly shown Text Editor page has no saved page
state. Existing Text Editor pages keep their own persisted Word Wrap choice; use the Text Editor's
toolbar toggle to change one of those pages.

### Drawn controls without `elements`

- Settings root and content containers — no entry: structural regions; the Settings elements list exposes catalog keys and the page action.
- Section roots — no entry as separate Settings elements: the 25 generated key entries use each section root's selector and inherit its section phrase.

Evidence: `SettingsView.ts:48-109`, `settings.ts:22-188`, and `ui-element-contract.md:139-164`.

## Settings sections and stable targets

The page has a stable root, content container, and button for viewing the settings file. Section
names are containers for highlighting rather than individual setting controls.

| Section or control | Selector |
|---|---|
| Settings root | `[data-name="settings-root"]` |
| Settings content | `[data-name="settings-content"]` |
| View Settings File | `[data-name="settings-view-file"]` |
| Theme | `[data-name="settings-section-theme"]` |
| Window Behavior | `[data-name="settings-section-window-behavior"]` |
| Editor Behavior | `[data-name="settings-section-editor"]` |
| Browser Profiles | `[data-name="settings-section-browser-profiles"]` |
| Links | `[data-name="settings-section-link-behavior"]` |
| Default Browser | `[data-name="settings-section-default-browser"]` |
| File Search | `[data-name="settings-section-file-search"]` |
| MCP Server / Mneme | `[data-name="settings-section-mcp"]` |
| Git Integration | `[data-name="settings-section-git-integration"]` |
| Board Environment Variables | `[data-name="settings-section-board-vars"]` |
| Script Library | `[data-name="settings-section-script-library"]` |
| Drawing Library | `[data-name="settings-section-drawing-library"]` |
| Video Player | `[data-name="settings-section-video-player"]` |
| Terminal | `[data-name="settings-section-terminal"]` |

The section selectors identify the containing sections. Read the live settings catalogue for the
rows and their labels instead of relying on a visual position that may change.

## Settings worth knowing about

| Key | Why it comes up |
|---|---|
| `mcp.enabled` | Off by default; enables the MCP server and starts it immediately when saved |
| `mcp.port` | Defaults to 7865; changing it requires disabling and re-enabling MCP to move a running server |
| `git.enabled` | Off by default; controls whether Git Tree and Git Diff features appear |
| `mneme.enabled` | Off by default; enables the separate Mneme service, whose port is `mneme.port` |
| `theme` | Applies when saved; the settings file comments list the accepted theme names |
| `window.close-to-tray` | On by default; controls whether closing the last window hides to the tray or quits |
| `editor.word-wrap` | Off by default; selects the initial wrapping state for newly shown Text Editor pages, while existing pages keep their persisted choice |

Session restoration is not a Settings option. See [Page Tabs → Session restore](./tabs.md#session-restore)
for the fact that a valid saved session is always attempted and there is no setting to disable it.

## Connected MCP versus file editing

When connected over MCP, use the settings API. It applies and persists a change and triggers the
behavior associated with it:

```js
app.settings.set("theme", "monokai");
return { theme: app.settings.get("theme"), path: app.settings.settingsFilePath };
```

The `call` surface refuses changes to `mcp.enabled` and `mcp.port` because either can disconnect
the caller. Direct `app.settings.set` remains the normal script and UI path.

When not connected, edit `%APPDATA%\persephone\data\appSettings.json` to turn MCP on. The file is
JSON5, so comments and trailing commas are allowed. Persephone watches it and reloads changes
without a restart. It rewrites the file and its comments when a setting changes in the UI, so
change values rather than relying on added commentary. Deleting a key restores its default, and
deleting the whole file is safe because it is recreated.
