---
title: "Getting Started"
audience: user
summary: "Installation and first steps for Persephone."
---

# Getting Started

## Installation

### Windows

1. Download the latest release from [GitHub Releases](https://github.com/andriy-viyatyk/persephone/releases)
2. Run the installer or extract the ZIP
3. Launch persephone

The installer's **Additional Options** page offers three checkboxes:
- **Add "Open with persephone" for files to Explorer context menu** (checked by default)
- **Add "Open with persephone" for folders to Explorer context menu** (checked by default) — lets you open a folder straight into persephone from Explorer; it opens as a new tab with the File Explorer panel rooted at that folder. Such a page is Persephone's equivalent of a VS Code workspace
- **Register as default browser** (unchecked by default)

Passing paths on the command line opens each file or folder in a tab. You can also pass an `http://` or `https://` URL to open it in Persephone's built-in browser, or compare two files by putting `diff` before their paths:

```text
persephone.exe notes.md another-file.js
persephone.exe https://example.com
persephone.exe diff before.txt after.txt
```

Quote paths that contain spaces. If Persephone is already running, inputs open in that instance. Upgrading from an older version with the removed default-text-app option releases those associations.

### Linux

Download the x86_64 `.deb` from [GitHub Releases](https://github.com/andriy-viyatyk/persephone/releases), then install with `sudo apt install ./persephone-<version>-linux-amd64.deb` (apt resolves dependencies). Double-clicking may open Software. Ubuntu 26.04 LTS with GNOME is supported; Debian 13 was install-checked, and other distributions are untested. The package installs in `/opt/persephone`, adds a Persephone launcher and Open With for text files and folders, and installs AppArmor policy for Chromium sandboxing. Remove it with `sudo apt remove persephone`; settings remain under `~/.config/persephone`. No AppImage, Flatpak, Snap or apt repository is provided.

Linux command examples use `/opt/persephone/persephone`, for example:

```text
/opt/persephone/persephone notes.md
/opt/persephone/persephone --profile demo --profile-dir "/home/me/Persephone Data/demo" notes.md
```

### Separate application profiles

Use a named application profile to run an isolated instance alongside your usual one:

```text
persephone.exe --profile demo
persephone.exe --profile=demo notes.md
```

Names are case-insensitive and normalized to lowercase. Use 1–32 ASCII letters, digits or hyphens;
`default` is reserved. Launching the same name again opens its existing instance. The name appears
in window titles and the tray tooltip. This is separate from browser profiles in Settings.

Each application profile has its own settings, sessions and data: `%APPDATA%\persephone-profiles\<name>` on Windows, `~/.config/persephone-profiles/<name>` by default on Linux. Files, external folders and the OS clipboard remain shared. Delete the profile folder to reset it. Browser registration is managed by the usual instance; named profiles do not check for updates automatically.

Named profiles default to MCP port 7965, Mneme 7800, video streaming 7966 and Tor SOCKS 9052.
These are configurable per profile; multiple named profiles use the same defaults, so change ports
when running their services simultaneously. An existing customized Tor configuration is preserved.

For advanced launches, `--profile-dir <path>` stores a named profile's data in a specific folder
instead of the platform default profile folder. It requires `--profile <name>` and accepts paths
with spaces when quoted:

```text
persephone.exe --profile demo --profile-dir "D:\Persephone Data\demo"
```

The profile name still identifies the instance; only its data folder changes. You can use a relative
path, which is resolved from the current working directory.

### From Source

```bash
git clone https://github.com/andriy-viyatyk/persephone.git
cd persephone
npm install
npm start
```

## First Launch

When you first open persephone, you'll see a clean, simple interface:
- Tab bar at the top
- An empty text editor

The application looks like a simple notepad by default. On Linux with automatic login, the first browser launch may prompt once to create a GNOME Keyring "Default Keyring"; see [Browser security and DRM](editors/browser/network-and-agent.md#linux-browser-security-and-drm). Click the **persephone icon** at the top-left for recent files, folder bookmarks, Settings and About.

## Basic Operations

To browse the shipped guides in the About page, choose **About** from the Menu Bar, or press `F1`. You can
also press `F1` when focus is outside a Monaco editor; it opens the matching guide for the active
editor when available, or the guide contents otherwise.

### Creating a New File
- Press `Ctrl+N` or click the + button in the tab bar
- Click the dropdown arrow (▾) next to the + button to create a page with a specific editor. The default items are:
  - **Open Folder** — Pick a folder; opens a new tab with the File Explorer panel rooted at that folder. Such a page is Persephone's equivalent of a VS Code workspace
  - **Script (JS)** — JavaScript file for scripting
  - **Script (TS)** — TypeScript file for scripting
  - **Excalidraw** — bundled Excalidraw drawing board
  - **Grid (JSON)** — Grid editor for JSON data
  - **Grid (CSV)** — Grid editor for CSV data
  - **Browser** — Built-in web browser (or pick a specific profile / incognito)

  The dropdown groups available editors into **Top**, your named categories, and **Other**. Manage categories in the **Tools & Editors** hub (see [Tabs & Navigation](tabs-and-navigation/menu-bar.md#tools--editors)).

### Opening Files
- Press `Ctrl+O` to open file dialog
- Drag and drop files onto the window
- Use recent files in the sidebar

### Saving Files
- Press `Ctrl+S` to save
- Press `Ctrl+Shift+S` to Save As
- Unsaved changes show a dot on the tab

### Closing Files
- Press `Ctrl+W` to close current tab
- Click the X on the tab

## Language Selection

persephone automatically detects the programming language based on file extension (.js, .py, .json, etc.).

To manually change the language:
- Click the language icon button on the left side of the tab
- Select the desired language from the dropdown list

On a page with no file extension in its name — a new `untitled` page, for example — the language
you choose here also decides which editors the page toolbar offers. Markdown and HTML offer
**Preview**, JSON, CSV and JSONL offer the matching **Grid**, Mermaid offers **Mermaid**, and XML
offers **SVG Preview**. A named file keeps using its extension, so a `.xml` file stays in the
Text Editor.

## Checking for Updates

Persephone checks for updates once every 24 hours and notifies you; it never installs updates automatically. **Download** opens the Windows setup `.exe` or Linux `.deb`. **Open release page** is shown when no matching installer asset is available.

To manually check for updates:
1. Click the app button (persephone icon) in the top-left corner to open the Menu Bar
2. Click **About** (the info button) to open the About page
3. Click "Check for Updates"

"Check for Updates" also refreshes the catalog of [boards published by the project](./boards/published-boards.md#published-boards-catalog--discover-install-update), so a newly published board or board update shows up immediately instead of waiting for the next automatic check.

The About page also shows:
- Current application version
- Electron, Node.js, and Chromium versions
- Available boards — the number of boards currently published in the catalog
- Links to download the latest version and report issues
- The in-app guide browser, with guide contents, release highlights, and resource links

## Changing the Theme

Persephone includes 8 built-in color themes (4 dark, 4 light) inspired by VSCode, and supports
custom themes:

1. Click the app button (persephone icon) in the top-left corner to open the Menu Bar
2. Click the Settings button (gear icon) to open the Settings page
3. Click a theme card to switch instantly

**Dark themes:** Persephone, Default Dark, Solarized Dark, Monokai
**Light themes:** Persephone Light, Light Modern, Solarized Light, Quiet Light

You can also cycle through themes with `Ctrl+Alt+]` (next) and `Ctrl+Alt+[` (previous).

Your theme preference is saved automatically and applied on next launch. New settings start with the Persephone theme; a valid theme already saved in your settings continues to be used.

The Settings page also has a "View Settings File" button for `appSettings.json` (Windows: `%APPDATA%\persephone\data\appSettings.json`; Linux: `~/.config/persephone/data/appSettings.json` by default; named or custom profiles use their own data root). Edits take effect immediately, including MCP and Mneme changes. Persephone rewrites the file's setting comments on each save.

## Window Behavior

When a system tray is available, closing Persephone's last window hides it there by default, keeping background services (the MCP server, Mneme) running. The tray icon toggles window visibility and has **Show App** and **Quit** actions. Without tray support, the app quits when the last window closes.

To make closing the last window quit the app instead:

1. Click the app button (persephone icon) in the top-left corner to open the Menu Bar
2. Click the Settings button (gear icon) to open the Settings page
3. In the **Window Behavior** section, uncheck **"Keep running in the tray after closing the last window"**

Settings file key: `window.close-to-tray` (boolean, default `true`). The tray's **Quit** action always exits persephone, regardless of this setting.

## Next Steps

- Learn about [different editors](./editors/index.md)
- Explore the [Grid Editor](./editors/grid.md) for JSON/CSV data
- Try [JavaScript scripting](scripting/index.md)
- Learn about [tabs, sidebar, and navigation](tabs-and-navigation/grouping-session-and-watching.md)
- Protect files with [encryption](./encryption.md)
- See all [keyboard shortcuts](./shortcuts.md)
