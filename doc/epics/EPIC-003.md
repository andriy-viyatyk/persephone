# EPIC-003: Script Library

## Status

**Status:** Active
**Created:** 2026-03-08

## Overview

A persistent script library system that lets users save, organize, and reuse scripts across pages. The library is a linked folder on disk with a conventional structure, surfaced in the sidebar and script panel. It includes per-language saved scripts, reusable utility modules via `require("library/...")`, and IntelliSense support for library modules in Monaco.

## Goals

- Let users save scripts from the script panel to a persistent library folder
- Let users load and run saved scripts on any page
- Provide Monaco IntelliSense for library modules (so `require("library/utils")` gets autocomplete)
- Surface the library in the sidebar for browsing and management
- Keep the folder structure convention-based (no config files), so the library is just a normal folder users can manage with any file manager

## Design Decisions

### Library Folder

- **One folder per app** (global setting, not per-window)
- Path stored in `AppSettings` as `script-library.path`
- If not linked, any feature that needs it prompts the user to link or create a folder
- The folder is a normal directory — users can edit files in it with any tool

### Folder Structure (Convention-Based)

```
📁 script-library/
├── 📁 script-panel/         # [Special] Saved script panel scripts (by target language)
│   ├── 📁 json/             # Scripts for pages with "json" language
│   │   ├── flatten.ts
│   │   └── parse-jwt.js
│   ├── 📁 sql/              # Scripts for pages with "sql" language
│   │   └── format-query.ts
│   └── 📁 all/              # Scripts available for any page language
│       └── base64-encode.ts
├── 📁 utils/                # [User-defined] Shared utilities
│   ├── db-config.ts         # Connection strings, constants
│   └── helpers.ts           # Common helper functions
├── 📁 my-tests/             # [User-defined] Any custom folder
│   ├── test-runner.ts
│   └── assertions.ts
└── 📁 data-tools/           # [User-defined] Any custom folder
    └── csv-parser.ts
```

**The entire library is a module tree.** Any file in any subfolder can be imported via `require("library/...")`:

```javascript
const { run } = require("library/my-tests/test-runner");
const { parseCsv } = require("library/data-tools/csv-parser");
run();
```

**Special folder:**
- `script-panel/` — scripts surfaced in the script panel dropdown (organized by target language)

**Conventions:**
- Subfolder names under `script-panel/` match **Monaco language IDs** (json, sql, plaintext, csv, etc.)
- Special subfolder: `script-panel/all/` — scripts available for any page language
- Files can be `.js` or `.ts`
- No manifest or config file — the folder structure IS the configuration
- Users can create any other folders for their own modules

### Script Access at Runtime

- Library scripts use `require()` for importing (not ES `import`), because scripts execute via `Function` constructor in a `with(this)` sandbox where ES imports don't work
- ScriptContext patches `require("library/...")` calls to resolve to the actual library folder path
- Example: `const { myFunc } = require("library/utils/helpers")`

### Lazy Loading & Performance

**Nothing library-related loads at app startup.** Loading is split into two levels:

**Level 1 — IntelliSense types (lightweight):**
- Triggered when a JS/TS page is opened, or when a page's language is changed to JS/TS
- Reads all `.ts`/`.js` files from the library and calls `addExtraLib()` for each
- This is cheap (just file reads + Monaco API calls), doesn't block UI
- Only happens once; file watcher keeps types in sync after that
- If no library is linked, nothing happens (no prompt — user may not need the library)

**Level 2 — Full LibraryService (heavier):**
- Triggered on first actual use: script panel open, script run, sidebar "Script Library" click
- Scans `script-panel/` subfolders for the dropdown file list
- Starts file watcher for script-panel index updates
- If no library is linked, prompts user to link/create a folder

**What gets cached:**
- Monaco extra libs (file contents for IntelliSense) — loaded at Level 1
- Script-panel file index (filenames per language subfolder) — loaded at Level 2

### IntelliSense

- **Covers the entire library tree** — all `.ts` and `.js` files in any subfolder get IntelliSense
- Loaded when a JS/TS page is opened (not at app bootstrap) — zero overhead for non-JS/TS pages
- All script files are registered via `addExtraLib()` with virtual paths like `file:///library/my-tests/test-runner.ts`
- Monaco compiler options get a `paths` mapping: `"library/*"` → virtual file paths
- This gives autocomplete for any `require("library/...")` call — Monaco resolves types from the extra libs
- Example: `const t = require("library/my-tests/test-runner")` → Monaco shows exports of `test-runner.ts`
- Library folder is watched; on file change, old libs are disposed and re-added

### Library Setup Wizard

A multi-step dialog for linking or creating the library folder. Triggered from sidebar, script panel "Save", or any action that needs the library when none is linked.

**Step 1 — Choose folder:**
- Folder path input field + "Browse..." button (opens Electron folder dialog)
- User can select an existing folder or type a new path
- "Next" button proceeds

**Step 2 — Initialize options:**
- Checkbox: **Create system folders** (`script-panel/`) — checked by default
- Checkbox: **Create example scripts** — checked by default
  - `script-panel/all/example.ts` — example script panel script
- "Finish" button applies

**Behavior:**
- If folder doesn't exist, creates it
- Only creates folders/files that don't already exist (safe for existing folders)
- After setup, saves path to `script-library.path` setting and initializes LibraryService
- The wizard is reusable — also shown when user wants to change the library path from settings

### Sidebar Integration

- New static entry "Script Library" in the MenuBar left panel (alongside "Open Tabs" and "Recent Files")
- When selected:
  - If no library linked → panel shows "Link Script Library Folder" / "Create New Library Folder" buttons (both open the setup wizard)
  - If linked → shows FileExplorer rooted at the library path
- Opening a library file from sidebar opens it as a normal page (editable)

### Script Panel Integration

The script panel header gets two new controls: a **script selector dropdown** and a **save button**.

**Script selector dropdown:**
- Shows filenames from `script-panel/{pageLanguage}/` + `script-panel/all/`
- Example: for a JSON page, dropdown lists files from `script-panel/json/` and `script-panel/all/`
- Selecting a file loads its content into the script panel (replacing current content)
- User then clicks the existing Run button to execute
- Dropdown refreshes when library folder changes (file watcher)
- First entry could be "(unsaved script)" representing the current ad-hoc script

**Save button:**
- Saves current script panel content to `script-panel/{language}/` folder
- Prompts for filename (text input or small dialog)
- After saving, the new script appears in the dropdown and is selected
- If a library script is currently selected and modified, saving overwrites it (with confirmation)
- If no library folder linked → prompts to link/create one first

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-128 | Library folder setting & sidebar integration | Done |
| US-134 | Library setup wizard (link/create folder dialog) | Done |
| US-130 | LibraryService — folder scanning, caching, file watching | Done |
| US-133 | Script panel dropdown & save to library | Done |
| US-129 | require("library/...") resolution in ScriptContext | Done |
| US-131 | IntelliSense for library modules (addExtraLib + path mapping) | Done |
| US-132 | Path completion for require("library/...") | Done |

## Resolved Decisions

1. **Import syntax**: `require("library/utils/helpers")` — full path, discoverable, no alias magic
2. **No auto-run context scripts**: Users explicitly `require()` shared utilities — simpler, no hidden magic
3. **Script metadata**: Not needed for now — just filenames
4. **Custom editors from library**: Future idea, out of scope for this epic

## Notes

### 2026-03-08
- Epic created based on initial design discussion
- Key architectural decision: convention-based folder structure (no config files)
- Key architectural decision: `require()` for runtime, `addExtraLib()` for IntelliSense
- `script-panel/` folder with language subfolders for saved scripts
- Entire library is an open module tree — any file can be `require()`d
- Lazy loading: IntelliSense on JS/TS page open, full service on first use
- Removed context scripts concept — users explicitly require() shared modules instead
