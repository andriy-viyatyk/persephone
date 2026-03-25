# US-280: Core Rebrand — js-notepad → Persephone

**Epic:** EPIC-013
**Status:** Planned
**Created:** 2026-03-25

## Goal

Rename all runtime identifiers from "js-notepad" to "persephone" in a single commit. After this task, the app builds, installs, and runs as "Persephone".

## Naming Convention

| Context | Old | New |
|---------|-----|-----|
| Lowercase ID | `js-notepad` | `persephone` |
| Display name | `JS Notepad` / `JS-Notepad` | `Persephone` |
| Launcher exe | `js-notepad-launcher.exe` | `persephone-launcher.exe` |
| Snip exe | `js-notepad-snip.exe` | `persephone-snip.exe` |
| App ID | `com.viyatyk.js-notepad` | `com.viyatyk.persephone` |
| MIME type | `application/js-notepad-tab` | `application/persephone-tab` |
| Named pipe | `js-notepad-{user}` | `persephone-{user}` |
| Registry root | `Software\js-notepad\...` | `Software\persephone\...` |
| ProgIDs | `JSNotepad.*`, `JSNotepadURL`, `JSNotepadHTM` | `Persephone.*`, `PersephoneURL`, `PersephoneHTM` |
| AppData folder | `%APPDATA%\js-notepad` | `%APPDATA%\persephone` |

## Implementation Plan

### Step 1: Package metadata

- [ ] **`package.json`** — Change `name`, `productName`, `description`
- [ ] **`package-lock.json`** — Will auto-update after `npm install`

### Step 2: Electron Builder config

- [ ] **`electron-builder.yml`** — Change:
  - `appId: com.viyatyk.persephone`
  - `productName: persephone`
  - `extraFiles` entries: launcher and snip exe names
  - `artifactName: "persephone-setup-${version}.${ext}"`
  - `menuCategory: Persephone`
  - `shortcutName: Persephone`
  - `repo: persephone`

### Step 3: Rust launcher

- [ ] **`launcher/Cargo.toml`** — `name = "persephone-launcher"` (both entries)
- [ ] **`launcher/build.rs`** — ProductName, FileDescription, CompanyName
- [ ] **`launcher/src/main.rs`** — All references (~9 locations):
  - Comments (lines 1, 3, 4, 13, 37, 101, 140)
  - Named pipe name: `js-notepad-{username}` → `persephone-{username}` (line 44)
  - Exe lookup: `js-notepad.exe` → `persephone.exe` (line 104)

### Step 4: Rust snip tool

- [ ] **`snip-tool/Cargo.toml`** — `name = "persephone-snip"`
- [ ] **`snip-tool/build.rs`** — ProductName, FileDescription, CompanyName
- [ ] **`snip-tool/src/main.rs`** — Comment header (line 1)

### Step 5: Main process

- [ ] **`src/main/pipe-server.ts`** (line 6) — Pipe name `persephone-{username}`
- [ ] **`src/main/snip-service.ts`** (lines 8, 10) — Exe name `persephone-snip.exe`
- [ ] **`src/main/version-service.ts`** (lines 7, 42) — GitHub API URL + User-Agent
- [ ] **`src/main/tray-setup.ts`** (line 24) — Tooltip `'persephone'`
- [ ] **`src/main/mcp-http-server.ts`** (lines 132, 134, 140, 141, 405) — Server name, title, description
- [ ] **`src/main/browser-registration.ts`** (~20 references) — All registry paths, display names, ProgIDs (`JSNotepad*` → `Persephone*`), launcher exe path
- [ ] **`src/main/browser-service.ts`** (lines 11, 28, 34) — Comment + User-Agent regex

### Step 6: Renderer process

- [ ] **`src/renderer/ui/tabs/PageTab.tsx`** (lines 442, 462) — MIME type
- [ ] **`src/renderer/editors/about/AboutPage.tsx`** (lines 284, 323, 331) — Display name + GitHub links
- [ ] **`src/renderer/editors/settings/SettingsPage.tsx`** (lines 1036, 1114, 1125) — Browser registration text, MCP config example, MCP description
- [ ] **`src/renderer/api/internal/GlobalEventService.ts`** (lines 37, 45) — MIME type for drag-drop
- [ ] **`src/renderer/api/settings.ts`** (lines 32, 58) — AppData path + MCP description
- [ ] **`src/renderer/theme/themes/index.ts`** (line 32) — AppData path

### Step 7: IPC

- [ ] **`src/ipc/main/registry-handler.ts`** (~8 references) — All registry key paths and context menu labels
- [ ] **`src/ipc/api-param-types.ts`** (line 26) — Comment with AppData path

### Step 8: NSIS installer

- [ ] **`build/installer.nsh`** (~51 references) — Replace all occurrences:
  - `js-notepad` → `persephone` (registry paths, context menu, exe names)
  - `JS-Notepad` → `Persephone` (display names)
  - `JS Notepad` → `Persephone` (descriptions)
  - `JSNotepad.*` → `Persephone.*` (ProgIDs: `JSNotepad.Document`, `JSNotepadURL`, `JSNotepadHTM`)
  - `js-notepad-launcher.exe` → `persephone-launcher.exe`

### Step 9: HTML + Build scripts

- [ ] **`index.html`** (lines 8, 20) — Title tag + AppData path in theme preloader
- [ ] **`scripts/vmp-sign.mjs`** (line 7) — Comment
- [ ] **`.mcp.json`** (line 3) — Server key name

### Step 10: Rebuild Rust binaries

- [ ] Run `cargo build --release` in `launcher/` — produces `persephone-launcher.exe`
- [ ] Run `cargo build --release` in `snip-tool/` — produces `persephone-snip.exe`

### Step 11: Verify

- [ ] `npm install` — regenerate `package-lock.json`
- [ ] `npm start` — dev mode works
- [ ] Window title shows "Persephone"
- [ ] Tray tooltip shows "persephone"
- [ ] Named pipe uses new name
- [ ] Screen snip works (finds `persephone-snip.exe`)
- [ ] Tab drag-drop works (new MIME type)
- [ ] About page shows "persephone" with correct GitHub links
- [ ] Settings page shows correct MCP config example
- [ ] `npm run dist` — production build works (installer named `persephone-setup-*.exe`)

## Files Changed Summary

| File | Changes |
|------|---------|
| `package.json` | 3 references |
| `electron-builder.yml` | 10 references |
| `launcher/Cargo.toml` | 2 references |
| `launcher/build.rs` | 3 references |
| `launcher/src/main.rs` | 9 references |
| `snip-tool/Cargo.toml` | 1 reference |
| `snip-tool/build.rs` | 3 references |
| `snip-tool/src/main.rs` | 1 reference |
| `src/main/pipe-server.ts` | 1 reference |
| `src/main/snip-service.ts` | 2 references |
| `src/main/version-service.ts` | 2 references |
| `src/main/tray-setup.ts` | 1 reference |
| `src/main/mcp-http-server.ts` | 5 references |
| `src/main/browser-registration.ts` | ~20 references |
| `src/main/browser-service.ts` | 3 references |
| `src/renderer/ui/tabs/PageTab.tsx` | 2 references |
| `src/renderer/editors/about/AboutPage.tsx` | 3 references |
| `src/renderer/editors/settings/SettingsPage.tsx` | 3 references |
| `src/renderer/api/internal/GlobalEventService.ts` | 2 references |
| `src/renderer/api/settings.ts` | 2 references |
| `src/renderer/theme/themes/index.ts` | 1 reference |
| `src/ipc/main/registry-handler.ts` | 8 references |
| `src/ipc/api-param-types.ts` | 1 reference |
| `build/installer.nsh` | ~51 references |
| `index.html` | 2 references |
| `scripts/vmp-sign.mjs` | 1 reference |
| `.mcp.json` | 1 reference |
| **Total** | **~254 references across 27 files** |

## Acceptance Criteria

- [ ] All runtime occurrences of "js-notepad" replaced with "persephone"
- [ ] App builds and runs in dev mode
- [ ] Rust binaries compile with new names
- [ ] No hardcoded "js-notepad" strings remain in source files (Phase 1 scope)
- [ ] NSIS installer produces `persephone-setup-*.exe`
