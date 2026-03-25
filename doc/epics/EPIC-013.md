# EPIC-013: Rebrand to "Persephone"

**Status:** Future
**Priority:** Low
**Created:** 2026-03-25

## Goal

Rename the application from "js-notepad" to "Persephone" across all code, configuration, documentation, binaries, and external services.

## Naming Convention

| Context | Current | New |
|---------|---------|-----|
| Package name / internal ID | `js-notepad` | `persephone` |
| Display name (UI, titles) | `JS Notepad` / `JS-Notepad` | `Persephone` |
| Executable names | `js-notepad-launcher.exe`, `js-notepad-snip.exe` | `persephone-launcher.exe`, `persephone-snip.exe` |
| App ID | `com.viyatyk.js-notepad` | `com.viyatyk.persephone` |
| MIME type | `application/js-notepad-tab` | `application/persephone-tab` |
| Named pipe | `js-notepad-{username}` | `persephone-{username}` |
| Registry paths | `Software\js-notepad\...` | `Software\persephone\...` |
| GitHub repo | `andriy-viyatyk/js-notepad` | `andriy-viyatyk/persephone` |

## Scope

### Phase 1: Core Identity (must be done together, single commit)

All changes that affect runtime behavior — if any of these are out of sync, the app breaks.

| Area | Files | What to change |
|------|-------|----------------|
| Package metadata | `package.json`, `package-lock.json` | `name`, `productName`, `description` |
| Electron builder | `electron-builder.yml` | `appId`, `productName`, exe names in `extraFiles`, `menuCategory`, `shortcutName`, repo |
| Rust launcher | `launcher/Cargo.toml`, `launcher/build.rs`, `launcher/src/main.rs` | Crate name, file descriptions, exe path lookup, named pipe name |
| Rust snip tool | `snip-tool/Cargo.toml`, `snip-tool/build.rs`, `snip-tool/src/main.rs` | Crate name, file descriptions |
| Named pipe | `src/main/pipe-server.ts` | Pipe name |
| Window title | `index.html` | `<title>` tag |
| Main process | `src/main/snip-service.ts`, `src/main/version-service.ts`, `src/main/tray-setup.ts` | Exe name references |
| MCP server | `src/main/mcp-http-server.ts` | Server name/title |
| Browser registration | `src/main/browser-registration.ts`, `src/main/browser-service.ts` | Registry paths, User-Agent, display names |
| NSIS installer | `build/installer.nsh` | Registry paths, context menu labels, file associations, browser registration (~51 references) |
| Renderer | `src/renderer/ui/tabs/PageTab.tsx` | MIME type |
| About page | `src/renderer/editors/about/AboutPage.tsx` | Display name, GitHub links |
| Settings page | `src/renderer/editors/settings/SettingsPage.tsx` | MCP config text, browser registration text |
| Registry handler | `src/ipc/main/registry-handler.ts` | `.reg` content |
| IPC types | `src/ipc/api-param-types.ts` | Reference |
| Settings | `src/renderer/api/settings.ts` | Reference |
| Global events | `src/renderer/api/internal/GlobalEventService.ts` | Reference |
| Theme | `src/renderer/theme/themes/index.ts` | Reference |
| CI workflow | `.github/workflows/publish.yml` | If exe names change |
| VMP script | `scripts/vmp-sign.mjs` | Reference |
| MCP config | `.mcp.json` | Server key |
| App icon | `assets/icon.ico` | New icon (optional, can keep current) |

### Phase 2: Documentation

Can be done after Phase 1. No runtime impact.

| Area | Files | Notes |
|------|-------|-------|
| User docs | `docs/` (~10 files) | Replace "js-notepad" with "Persephone" in prose, update GitHub URLs |
| API docs | `docs/api/` (~3 files) | Minor references |
| Developer docs | `doc/` (~9 architecture/standards files) | Replace references |
| MCP guides | `assets/mcp-res-*.md` (~4 files) | Server name in examples |
| Editor types | `assets/editor-types/mcp-inspector-editor.d.ts` | Example reference |
| Script library | `assets/script-library/autoload/register-all.ts` | Comments, GitHub link |
| QA docs | `qa/` (~2 files) | References |
| README | `README.md` | Title, description, links |
| CLAUDE.md | `CLAUDE.md` | Project description |
| What's New | `docs/whats-new.md` | Historical references (keep as-is or note rename) |
| Claude agents | `.claude/agents/` (~2 files) | References |

### Phase 3: GitHub Repo Rename

| Step | Notes |
|------|-------|
| Rename repo in GitHub Settings | `js-notepad` → `persephone`. Old URLs auto-redirect. |
| Update all GitHub URLs in code/docs | `github.com/andriy-viyatyk/js-notepad` → `github.com/andriy-viyatyk/persephone` |
| Update `publish` config in `electron-builder.yml` | `repo: persephone` |
| Update local git remotes | `git remote set-url origin ...` |
| Update MCP config paths | `.mcp.json`, any local config referencing the repo path |

### Phase 4: Cleanup (optional, low priority)

| Area | Files | Notes |
|------|-------|-------|
| Epics & tasks | `doc/epics/`, `doc/tasks/` (~12 files) | Historical docs — could leave as-is with a note |
| Visualization graphs | `doc/visualization/*.fg.json` (~3 files, 650+ references) | Auto-generated, regenerate after rename |
| Mockups | `mockups/*.html` (~3 files) | May be outdated, consider deleting |
| External scripts | `js-notepad-scripts/` (~3 files) | Rename folder and references |

## Installer Considerations

The NSIS installer (`build/installer.nsh`) is the most complex file — it contains ~51 references across:
- Windows Registry paths for file associations
- Context menu entries ("Open with Persephone")
- Browser registration (if used as default browser)
- Uninstaller cleanup

**Breaking change:** Persephone is a clean break from js-notepad. Users must uninstall js-notepad manually before installing Persephone. No migration logic — old registry entries, shortcuts, and user data remain until the user uninstalls. Version bumps to **2.0.1** to signal the breaking change.

## Tasks

| # | Task | Description | Status |
|---|------|-------------|--------|
| 1 | US-280 Core rebrand | Phase 1: rename all runtime identifiers + icon | Done |
| 2 | US-285 Version bump to 2.0.1 | Bump version to 2.0.1 to signal breaking change | Done |
| 3 | US-281 Doc rebrand | Phase 2: update all documentation | Done |
| 4 | US-282 Repo rename | Phase 3: rename GitHub repo, update URLs | Done |
| 5 | US-284 Cleanup | Phase 4: backlog, visualizations, mockups, scripts folder | Done |

## Icon

**Decided:** Lily Badge — Dark (variant B: stem + two leaves). White lily flower on dark circle background.

- Concept SVG: [`doc/tasks/US-280-core-rebrand/icon-concept-b.svg`](../tasks/US-280-core-rebrand/icon-concept-b.svg)
- Style: White petals, golden stamens, green stem with two leaves on `#2c3e50` dark circle
- Small sizes (32px, 16px): Thicker stroke weights for stem/leaves to remain recognizable
- Final icon needs to be converted to `.ico` (multi-size: 16, 32, 48, 64, 128, 256) for Windows

## Resolved Questions

1. **App icon** — Lily badge, variant B (see Icon section above)
2. **Historical docs** — No migration needed. Near-zero downloads, not worth the effort. Rename everything.
3. **User data migration** — Ignore. No active users. Nothing critical in `%APPDATA%\js-notepad` (just page states and modification cache — acceptable to lose).
4. **Named pipe compatibility** — No conflict. Different pipe names (`js-notepad-{user}` vs `persephone-{user}`).
