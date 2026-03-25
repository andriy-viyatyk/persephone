# US-281: Doc Rebrand — js-notepad → Persephone

**Epic:** EPIC-013
**Status:** Planned
**Created:** 2026-03-25

## Goal

Replace all "js-notepad" references in documentation, MCP guides, QA docs, script assets, and Claude agent configs with "Persephone". No runtime code changes — documentation only.

## Naming Convention

| Context | Old | New |
|---------|-----|-----|
| Product name in prose | js-notepad / JS-Notepad / JS Notepad | Persephone |
| GitHub URLs | `github.com/andriy-viyatyk/js-notepad` | `github.com/andriy-viyatyk/persephone` |
| MCP server name | `"js-notepad"` | `"persephone"` |
| Exe names in docs | `js-notepad-launcher.exe` | `persephone-launcher.exe` |
| Registry paths in docs | `Software\js-notepad\...` | `Software\persephone\...` |
| MCP tool prefixes | `mcp__js-notepad__*` | `mcp__persephone__*` |
| Context menu text | "Open with js-notepad" | "Open with persephone" |

## Implementation Plan

### Step 1: CLAUDE.md (remaining references)

- [ ] **`CLAUDE.md`** (1 reference) — Already says "Persephone (formerly js-notepad)" in overview. Scan for any remaining stale references in the rest of the file.

### Step 2: Developer docs (`doc/`)

- [ ] **`doc/README.md`** (1 ref) — "developer documentation for js-notepad"
- [ ] **`doc/architecture/overview.md`** (3 refs) — Project description, MCP server references
- [ ] **`doc/architecture/folder-structure.md`** (3 refs) — Folder description, snip tool exe name
- [ ] **`doc/architecture/pages-architecture.md`** (1 ref) — Page lifecycle
- [ ] **`doc/architecture/state-management.md`** (1 ref) — Reactive state intro
- [ ] **`doc/architecture/browser-editor.md`** (5 refs) — Browser tabs, webview registration
- [ ] **`doc/architecture/context-menu.md`** (1 ref) — Context menu intro
- [ ] **`doc/architecture/scripting.md`** (1 ref) — Script execution intro
- [ ] **`doc/standards/release-process.md`** (2 refs) — GitHub Actions URLs
- [ ] **`doc/standards/model-view-pattern.md`** (1 ref) — MVC pattern intro
- [ ] **`doc/standards/testing.md`** (1 ref) — Testing note

### Step 3: User docs (`docs/`)

- [ ] **`docs/index.md`** (6 refs) — User guide title, feature overview, GitHub links
- [ ] **`docs/getting-started.md`** (11 refs) — Installation, GitHub clone URL, UI descriptions
- [ ] **`docs/mcp-setup.md`** (10 refs) — MCP config examples (server name `"persephone"`), connection instructions
- [ ] **`docs/whats-new.md`** (16 refs) — Changelog entries (exe names, feature descriptions, context menu text). Add a note at version 2.0.1 about the rebrand.
- [ ] **`docs/scripting.md`** (1 ref) — Script execution intro
- [ ] **`docs/browser.md`** (11 refs) — Browser features, default browser registration
- [ ] **`docs/encryption.md`** (1 ref) — Encryption intro
- [ ] **`docs/tabs-and-navigation.md`** (6 refs) — Tab management, sidebar, session restore
- [ ] **`docs/editors.md`** (5 refs) — Editor overview
- [ ] **`docs/api/page.md`** (2 refs) — MCP serverName/serverTitle values
- [ ] **`docs/api/ui-log.md`** (1 ref) — Log View description
- [ ] **`docs/api/settings.md`** (1 ref) — MCP settings

### Step 4: README

- [ ] **`README.md`** (8 refs) — Title, description, GitHub URLs, download links

### Step 5: MCP resource guides (`assets/`)

- [ ] **`assets/mcp-res-pages.md`** (2 refs) — Tabbed pages description
- [ ] **`assets/mcp-res-notebook.md`** (1 ref) — Notebook editor
- [ ] **`assets/mcp-res-scripting.md`** (1 ref) — Script execution
- [ ] **`assets/mcp-res-ui-push.md`** (1 ref) — Log View

### Step 6: Script library assets

- [ ] **`assets/script-library/autoload/register-all.ts`** (3 refs) — Comments, GitHub URL

### Step 7: QA docs

- [ ] **`qa/README.md`** (7 refs) — MCP test docs
- [ ] **`qa/mcp-test-page-operations.md`** (1 ref) — Test case text

### Step 8: Claude agent configs

- [ ] **`.claude/agents/userdoc.md`** (1 ref) — Agent context
- [ ] **`.claude/agents/mcp-test-agent.md`** (12 refs) — MCP tool prefixes `mcp__js-notepad__*` → `mcp__persephone__*`

### Step 9: Verify

- [ ] `grep -r "js-notepad\|JS.Notepad\|JSNotepad\|JsNotepad" doc/ docs/ README.md CLAUDE.md assets/mcp-res-*.md assets/script-library/ qa/ .claude/` returns no matches (excluding `doc/epics/` and `doc/tasks/`)

## Files Changed Summary

| Directory | Files | Total refs |
|-----------|-------|-----------|
| Root (`CLAUDE.md`, `README.md`) | 2 | ~9 |
| `doc/` (developer docs) | 10 | ~20 |
| `docs/` (user docs) | 12 | ~71 |
| `assets/` (MCP guides, scripts) | 5 | ~8 |
| `qa/` | 2 | ~8 |
| `.claude/` | 2 | ~13 |
| **Total** | **33 files** | **~129 references** |

## Notes

- `doc/epics/` and `doc/tasks/` are **excluded** — they are historical records of completed work.
- `docs/whats-new.md` deserves special care — changelog entries before v2.0.1 should keep "js-notepad" as that was the product name at the time. Add a v2.0.1 entry announcing the rebrand.
- GitHub URLs won't resolve until US-282 (repo rename) is done. That's fine — update the URLs now so they're ready.

## Acceptance Criteria

- [ ] No `js-notepad` / `JS-Notepad` / `JS Notepad` / `JSNotepad` / `JsNotepad` references in any doc/asset file (except historical epics/tasks and changelog entries before v2.0.1)
- [ ] MCP setup guide shows correct `"persephone"` server config
- [ ] README reflects "Persephone" branding
