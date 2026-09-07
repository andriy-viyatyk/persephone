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

When connected over MCP, read `settings.sections` for the fixed-order catalogue of 13 sections and
25 setting rows. Use `settings.highlight(key)` to open or activate Settings and point at the
containing section; `key` is a settings key, not a DOM selector.

## Layout

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

