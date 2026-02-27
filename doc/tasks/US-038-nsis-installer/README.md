# US-038: Switch to electron-builder with NSIS Installer

## Status

**Status:** In Progress
**Priority:** High

## Summary

Replace the current Electron Forge + WiX MSI installer with electron-builder + NSIS. This eliminates the WiX stub launcher (which loses working directory), gives full control over registry entries and file associations, and provides the infrastructure to bundle the Rust launcher from US-037.

## Why

- **WiX launcher loses working directory** — when Git Extensions (or similar tools) opens a file via the "Open with" context menu using relative paths and a custom working directory, the WiX stub launcher doesn't pass the CWD to `js-notepad.exe`, so relative paths fail to resolve
- **No control over installed executables** — WiX creates its own launcher stub; we need to register the Rust launcher (US-037) as the primary entry point for file associations
- **NSIS is the industry standard** — most popular installer for Electron apps, installs files directly without intermediate stubs
- **Registry control** — NSIS supports custom registry entries needed for US-036 (default browser registration)
- **electron-builder** — mature, well-maintained, first-class NSIS support, used by VS Code, Slack, Discord, etc.

## Background

### Current Setup

- **Build:** Electron Forge with Vite plugin
- **Installer:** `@electron-forge/maker-wix` → produces `.msi`
- **Portable:** `@electron-forge/maker-zip` → produces `.zip`
- **Publishing:** `@electron-forge/publisher-github` → GitHub Releases (draft mode)

### Target Setup

- **Build:** electron-builder (replaces Forge's `package` + `make` steps; Vite build stays as-is or is adapted)
- **Installer:** NSIS → produces `.exe` installer
- **Portable:** ZIP → produces `.zip`
- **Publishing:** electron-builder's GitHub publisher → GitHub Releases

### Key Differences

| Aspect | Electron Forge + WiX | electron-builder + NSIS |
|--------|----------------------|-------------------------|
| Installer format | `.msi` | `.exe` |
| Stub launcher | Yes (WiX-generated) | No (direct exe) |
| Working directory | Lost through stub | Preserved |
| Custom registry | Limited | Full NSIS scripting |
| File associations | WiX declarative | NSIS scripting |
| Auto-update | Manual | Built-in (electron-updater) |
| Bundle size | Similar | Similar |
| Install location | User-chosen | User-chosen |

## Acceptance Criteria

- [ ] NSIS installer produces a working `.exe` setup
- [ ] Installation includes both `js-notepad.exe` and `js-notepad-launcher.exe` (from US-037)
- [ ] File associations point to the launcher, not directly to `js-notepad.exe`
- [ ] "Open with" context menu works with correct working directory
- [ ] Uninstaller removes all files, registry entries, and shortcuts
- [ ] Start menu shortcut created
- [ ] Desktop shortcut (optional, user-selectable during install)
- [ ] Custom install directory supported
- [ ] Custom installer options page with checkboxes:
  - [ ] "Add 'Open with js-notepad' to Explorer context menu" (checked by default) — registers `HKCU\Software\Classes\*\shell\js-notepad` for ALL file types (not just text), pointing to the launcher exe
  - [ ] "Set as default app for text files" (unchecked by default) — file associations for .txt, .log, .md, .js, .ts, .jsx, .tsx, .json, .xml, .html, .css, .py, .java, .c, .cpp
  - [ ] "Register js-notepad as default browser" (unchecked by default) — browser registration (for US-036)
- [ ] Uninstaller cleans up only the options that were selected during install
- [ ] ZIP portable build still available
- [ ] `npm run make` produces NSIS installer
- [ ] `npm run publish` uploads to GitHub Releases
- [ ] GitHub Actions pipeline builds Rust launcher and Electron app
- [ ] Upgrade from previous WiX MSI version is handled (or documented)
- [ ] No regressions to existing functionality

## Technical Approach

### Phase 1: Set Up electron-builder

**Option A: Replace Electron Forge entirely**
- Remove `@electron-forge/*` packages
- Install `electron-builder`
- Configure in `electron-builder.yml` or `package.json`
- Adapt Vite build output to match electron-builder's expected structure

**Option B: Keep Forge for dev, use electron-builder for production builds only**
- Keep `npm start` using Forge (development)
- Add `npm run dist` using electron-builder (production builds)
- Both use the same Vite build output

**Recommended: Option A** — cleaner, single tool for everything. electron-builder has its own dev mode and Vite integration.

### Phase 2: NSIS Configuration

```yaml
# electron-builder.yml (or equivalent in package.json)
nsis:
  oneClick: false              # Show install wizard (not one-click)
  allowToChangeInstallationDirectory: true
  createDesktopShortcut: true
  createStartMenuShortcut: true
  menuCategory: "JS-Notepad"
  include: "build/installer.nsh"  # Custom NSIS script for registry/associations

fileAssociations:
  - ext: txt
    name: "Text File"
    role: Editor
  - ext: js
    name: "JavaScript File"
    role: Editor
  # ... (same extensions as current WiX config)
```

### Phase 3: Custom NSIS Script

`build/installer.nsh` — custom installer options page and registry logic:

**Custom Options Page (nsDialogs checkboxes):**
- **Add "Open with js-notepad" to Explorer context menu** (checked by default) — registers for ALL file types via `HKCU\Software\Classes\*\shell\js-notepad`, pointing to the launcher exe. js-notepad can open text files, PDFs, images, and more.
- **Set as default app for text files** (unchecked by default) — associates common extensions (.txt, .log, .md, .js, .ts, .jsx, .tsx, .json, .xml, .html, .css, .py, .java, .c, .cpp) with the launcher exe
- **Register as default browser** (unchecked by default) — writes browser registration registry entries (prepares for US-036)

**Registry entries for "Open with" context menu:**
```nsis
WriteRegStr HKCU "Software\Classes\*\shell\js-notepad" "" "Open with js-notepad"
WriteRegStr HKCU "Software\Classes\*\shell\js-notepad" "Icon" "$INSTDIR\js-notepad-launcher.exe,0"
WriteRegStr HKCU "Software\Classes\*\shell\js-notepad\command" "" '"$INSTDIR\js-notepad-launcher.exe" "%1"'
```

**Install actions (conditional on checkboxes):**
- "Open with js-notepad" shell context menu for all files
- File associations for specific extensions pointing to the launcher exe
- Browser registration registry entries
- Store selected options in registry for uninstaller to read

**Uninstall actions:**
- Read stored options from registry
- Remove only the registry entries that were created during install
- Clean up all files, shortcuts, and remaining registry keys

### Phase 4: Bundle Rust Launcher

electron-builder's `extraFiles` or `extraResources` config includes the pre-built launcher:

```yaml
extraFiles:
  - from: "launcher/target/release/js-notepad-launcher.exe"
    to: "js-notepad-launcher.exe"
```

The NSIS installer script registers this launcher as the handler for file associations instead of `js-notepad.exe`.

### Phase 5: Build Pipeline (local)

Update `package.json` scripts:
```json
{
  "scripts": {
    "start": "electron-forge start",  // Development (keep Forge)
    "dist": "electron-builder --win",  // Build + NSIS installer
    "dist:zip": "electron-builder --win zip",  // Portable ZIP
    "publish": "electron-builder --win --publish always"
  }
}
```

Pre-build step: compile Rust launcher (`cargo build --release` in `/launcher/`)

### Phase 6: GitHub Actions Pipeline

Update `.github/workflows/publish.yml` to:
1. Install Rust toolchain (`dtolnay/rust-toolchain@stable`)
2. Build Rust launcher (`cargo build --release` in `/launcher/`)
3. Install Node.js dependencies
4. Build and publish with electron-builder

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: dtolnay/rust-toolchain@stable
  - name: Build Rust launcher
    run: cargo build --release
    working-directory: launcher
  - uses: actions/setup-node@v4
    with:
      node-version: 20
      cache: 'npm'
  - run: npm install
  - name: Build and Publish
    env:
      GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    run: npm run publish
```

## Concerns

1. **Migration risk:** Switching from Forge to electron-builder affects the entire build pipeline. Need to verify that Vite integration, preload scripts, and the webview preload all work correctly with electron-builder.

2. **MSI → EXE upgrade path:** Users with the current MSI installation will need to uninstall the MSI before installing the new EXE version. Document this in release notes. NSIS can detect and offer to uninstall the old MSI, but it's complex.

3. **Vite compatibility:** electron-builder has plugins for Vite (`electron-vite`, `vite-plugin-electron`), but the current setup uses Electron Forge's Vite plugin. Need to evaluate whether to keep the current Vite config or migrate to electron-builder's Vite integration.

4. **Code signing:** Not currently used, but NSIS supports it. Can be added later.

5. **Auto-update:** electron-builder includes `electron-updater` for automatic updates. This could replace the current manual GitHub Release check (US-007). Not required for this task but worth considering.

6. **Asar packaging:** Current config uses `asar: true`. electron-builder also supports asar. Verify the embedded asar integrity fuse still works.

7. **Forge dev server:** If switching to electron-builder completely, need to set up a development mode equivalent. electron-builder's dev mode or `electron-vite` provides this.

## Files to Create/Modify

- `electron-builder.yml` — NEW: electron-builder configuration
- `build/installer.nsh` — NEW: custom NSIS install/uninstall script
- `package.json` — update scripts, dependencies (remove Forge makers, add electron-builder)
- `forge.config.ts` — remove or keep for dev only
- `vite.*.config.ts` — may need adjustments for electron-builder compatibility

## Implementation Progress

### Phase 1: electron-builder Setup ✅
- [x] Install electron-builder
- [x] Create `electron-builder.yml` configuration
- [x] Create standalone Vite build script (`scripts/build-prod.mjs`) replicating Forge VitePlugin output structure
- [x] Add npm scripts: `build-prod`, `dist`, `dist:zip`, `dist:publish`
- [x] Fix `when-exit` browser/node conditional export (resolve conditions: `["node"]` for main process)
- [x] Fix renderer `buffer`/`string_decoder` resolution (don't externalize node builtins for ESM renderer)
- [x] Verify `npm run dist` produces working unpacked build
- [x] Verify preload scripts and webview preload work correctly

### Phase 2: NSIS Installer ✅
- [x] Configure NSIS options (install wizard, directories, per-user install)
- [x] Verify installer produces working `.exe` setup
- [x] Verify ZIP portable build still works

### Phase 3: Custom NSIS Script (installer.nsh) ✅
- [x] Create `build/installer.nsh` with custom "Additional Options" page
- [x] nsDialogs checkboxes (5 options, upgrade-aware defaults from registry):
  - [x] "Create desktop shortcut" (checked by default)
  - [x] "Create Start menu shortcut" (checked by default)
  - [x] "Add 'Open with js-notepad' to Explorer context menu" (checked by default) — all files via `HKCU\Software\Classes\*\shell\js-notepad`
  - [x] "Set as default app for text files" (unchecked by default) — 15 extensions with previous association backup/restore
  - [x] "Register js-notepad as default browser" (unchecked by default) — full Windows internet client + URL handler registration
- [x] All shortcuts and file associations point to `js-notepad-launcher.exe`
- [x] Store selected options in registry (`HKCU\Software\js-notepad\Install`) for uninstaller
- [x] Uninstaller reads stored options and removes only what was installed
- [x] SHChangeNotify call to refresh Explorer after changes

### Phase 3b: Launcher SHOW command ✅
- [x] Launcher sends `SHOW` command via pipe when started without arguments (brings existing instance to front)
- [x] Falls back to spawning `js-notepad.exe` if no running instance
- [x] Pipe server handles `SHOW` → `makeVisible()` + `activateSomeWindow()`

### Phase 4: Bundle Launcher ✅
- [x] `extraFiles` config includes Rust launcher next to main exe
- [x] Launcher included in both NSIS installer and ZIP builds

### Phase 5: Local Build Pipeline ✅
- [x] `npm run dist` produces NSIS installer + ZIP locally
- [x] `npm run dist:publish` configured for GitHub Releases (draft mode)

### Phase 3c: Bring to Front on Open ✅
- [x] Launcher calls `AllowSetForegroundWindow(ASFW_ANY)` before sending pipe messages (grants focus permission)
- [x] `OpenWindows.bringToFront()` method combines `makeVisible()` + `activateSomeWindow()`
- [x] Pipe server uses `bringToFront()` for OPEN, SHOW, and DIFF commands
- [x] `second-instance` handler in main-setup.ts uses `bringToFront()`

### Phase 6: GitHub Actions Pipeline ✅
- [x] Add Rust toolchain step (`dtolnay/rust-toolchain@stable`)
- [x] Add Rust launcher build step
- [x] Update publish step for electron-builder (`npm run dist:publish`)
- [x] Add `workflow_dispatch` for manual trigger from any branch
- [x] Tested: manual build from `upcoming-v16` branch succeeded

### Phase 7: Cleanup ✅
- [x] Remove unused Forge maker/publisher packages (kept Forge for dev server)
- [x] Remove old `make`/`package`/`publish` scripts from package.json
- [x] Clean up forge.config.ts (remove makers and publishers, keep plugins)
- [x] Update CLAUDE.md (commands, tech stack)
- [x] Document MSI → EXE migration for existing users (below)

## Notes

### MSI → EXE Migration
Existing users with the WiX MSI installation should uninstall the MSI version first (via Windows Settings → Apps), then install the new NSIS `.exe` installer. The NSIS installer uses a different install location (`%LOCALAPPDATA%\Programs\js-notepad` by default) and does not conflict with the MSI, but having both installed is not recommended. App data (`%APPDATA%\js-notepad`) is preserved across the migration.

### 2026-02-27
- Phase 1–5 completed. electron-builder + NSIS installer working with custom options page.
- Kept Forge for dev (`npm start`), electron-builder for production builds (`npm run dist`)
- Custom installer page has 5 checkboxes organized into "Shortcuts" and "System integration" sections
- Launcher enhanced with SHOW command for instant window activation from shortcuts
- File associations use per-extension backup/restore to be a good citizen with other programs
- `!ifndef BUILD_UNINSTALLER` guards needed for installer-only variables and functions (NSIS two-pass compilation)

### 2026-02-26
- Task created alongside US-037 (Rust Launcher) — they are tightly coupled
- NSIS chosen over Inno Setup because electron-builder has first-class NSIS support
- electron-builder chosen over custom Forge maker because of maturity, documentation, and community support
- The WiX working directory bug is the immediate motivator, but the migration also enables US-036 (default browser) and US-037 (launcher bundling)

## Related

- Depends on: US-037 (Rust Launcher) — for bundling the launcher
- Enables: US-036 (Register as Default Browser) — NSIS can write browser registration registry entries
- Related doc: [Release Process](../../standards/release-process.md)
