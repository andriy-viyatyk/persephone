# US-038: Switch to electron-builder with NSIS Installer

## Status

**Status:** Planned
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
- [ ] ZIP portable build still available
- [ ] `npm run make` produces NSIS installer
- [ ] `npm run publish` uploads to GitHub Releases
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

`build/installer.nsh` — additional NSIS commands for:
- Register file associations pointing to the launcher exe
- "Open with js-notepad" shell context menu entry
- Registry cleanup on uninstall
- Optional: browser registration entries (for US-036)

### Phase 4: Bundle Rust Launcher

electron-builder's `extraFiles` or `extraResources` config includes the pre-built launcher:

```yaml
extraFiles:
  - from: "launcher/target/release/js-notepad-launcher.exe"
    to: "js-notepad-launcher.exe"
```

The NSIS installer script registers this launcher as the handler for file associations instead of `js-notepad.exe`.

### Phase 5: Build Pipeline

Update `package.json` scripts:
```json
{
  "scripts": {
    "start": "...",           // Development (electron-builder or keep Forge)
    "build": "...",           // Vite build
    "dist": "electron-builder --win",  // Build + NSIS installer
    "dist:zip": "electron-builder --win zip",  // Portable ZIP
    "publish": "electron-builder --win --publish always"
  }
}
```

Pre-build step: compile Rust launcher (`cargo build --release` in `/launcher/`)

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

### Phase 1: electron-builder Setup
- [ ] Install electron-builder and remove Forge maker packages
- [ ] Create `electron-builder.yml` configuration
- [ ] Configure Vite build integration
- [ ] Verify `npm run dist` produces a working unpacked build
- [ ] Verify preload scripts and webview preload work correctly

### Phase 2: NSIS Installer
- [ ] Configure NSIS options (install wizard, directories, shortcuts)
- [ ] Add file associations matching current WiX config
- [ ] Verify installer produces working `.exe` setup
- [ ] Verify uninstaller removes all files and registry entries
- [ ] Test upgrade installation (install over existing)

### Phase 3: Custom Registry & Associations
- [ ] Create `build/installer.nsh` with custom NSIS script
- [ ] Register "Open with js-notepad" context menu
- [ ] Point file associations to launcher exe (after US-037)
- [ ] Clean up registry on uninstall

### Phase 4: Bundle Launcher
- [ ] Add `extraFiles` config to include Rust launcher
- [ ] Add pre-build script to compile Rust launcher
- [ ] Verify launcher is included in both installer and ZIP builds

### Phase 5: Publishing
- [ ] Configure GitHub publisher in electron-builder
- [ ] Verify `npm run publish` uploads to GitHub Releases
- [ ] Update release process documentation

### Phase 6: Cleanup
- [ ] Remove unused Forge maker packages
- [ ] Update `npm run make` / `npm run package` scripts
- [ ] Update developer documentation
- [ ] Document MSI → EXE migration for existing users

## Notes

### 2026-02-26
- Task created alongside US-037 (Rust Launcher) — they are tightly coupled
- NSIS chosen over Inno Setup because electron-builder has first-class NSIS support
- electron-builder chosen over custom Forge maker because of maturity, documentation, and community support
- The WiX working directory bug is the immediate motivator, but the migration also enables US-036 (default browser) and US-037 (launcher bundling)

## Related

- Depends on: US-037 (Rust Launcher) — for bundling the launcher
- Enables: US-036 (Register as Default Browser) — NSIS can write browser registration registry entries
- Related doc: [Release Process](../../standards/release-process.md)
