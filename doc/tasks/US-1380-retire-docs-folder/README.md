# US-1380 — Delete `docs/` and re-point the last references

**Status:** Planned  
**Epic:** [EPIC-095 — Retire `docs/`](../../epics/EPIC-095.md)  
**Dashboard:** Already listed under EPIC-095 in [`doc/active-work.md`](../../active-work.md); do not add a second entry.

## Goal

Delete the retired `docs/` folder and remove the last live prose pointers to it. Leave the
in-app guide corpus under `assets/guides/` as the canonical copy shown by the About page and
`F1`, and remove only the two stale references to the deleted `read_guide` MCP tool.

## Background

EPIC-092 moved the user and agent guide corpus into `assets/guides/` and left two one-line stubs
temporarily so old GitHub paths did not 404 before the replacement passed the roadmap gates.
The tracked inventory was verified with `git ls-files docs`: it contains exactly:

| Current path | Verified contents | Disposition |
|---|---|---|
| `docs/index.md` | Stub linking to `assets/guides/index.md` | Delete |
| `docs/api/index.md` | Stub linking to `assets/guides/scripting/api/index.md` | Delete |
| `docs/examples/` | Directory exists on disk but contains no files and no tracked entries | No move currently required; inspect again immediately before deletion |

The standing fixture rule applies if that last result changes: any file found under
`docs/examples/` must be moved with `git mv` to `assets/guides/examples/`, never deleted. The
future implementation must record each such move and must not remove the destination fixture.

The additional reference check `git grep -n "docs/examples"` currently finds only historical
records: `doc/epics/EPIC-082.md`, `doc/epics/EPIC-092.md`,
`doc/in-app-guides-roadmap.md`, and the historical migration plan in
`doc/tasks/US-1361-guides-corpus-move/README.md`. The moved destination
`assets/guides/examples/greek-gods.fg.json` exists on disk. A non-history reference, or a missing
destination fixture, is a stop condition: report it and do not delete `docs/` until the reference
or incomplete move is resolved.

The replacement corpus is not just a repository link. `electron-builder.yml` already copies
`assets/` to the installed app's `resources/assets/`, and the About guide browser and global `F1`
route consume the same corpus. Therefore the user-facing guides in `assets/guides/` are the
canonical in-app copy and the folder ships inside the app.

The four requested pointer areas were read at their current locations. Three contain stale
`/docs/` wording; `doc/agents-common.md` also has an already-correct Documentation Map row and
one stale Folder Structure entry that must be fixed. Current line numbers are recorded here only
as investigation anchors; use the surrounding text, not a stale line number, when applying the
future edit.

## Implementation Plan

### 1. Recheck the retired folder and remove it safely

- Before editing, run `git ls-files docs` and inspect `docs/examples/` recursively. The verified
  baseline is the two stubs above and no example files.
- If any file has appeared under `docs/examples/`, move it with `git mv` to the corresponding
  path under `assets/guides/examples/` before deleting the old folder. Do not use `Remove-Item`
  or otherwise delete a fixture. Update the plan's inventory only if the new file is actually
  found.
- Delete the two stub files, allowing Git to remove the now-empty `docs/` tree:
  `docs/index.md` and `docs/api/index.md`. Do not delete or rewrite any guide in
  `assets/guides/`.

### 2. Re-point the four documentation areas

Keep each pointer line concise and parallel with its surrounding block. Add one nearby sentence
per file for the fact that `/assets/guides/` is the shipped, canonical in-app copy reached through
the About page and `F1`; do not bolt that explanation onto a numbered step or tree label.

#### `CONTRIBUTING.md`

The current Documentation block at line 164 says user docs are in `/docs/`. Preserve the block's
developer/user split, but replace the second line as follows:

Before:

```md
- **Developer docs** are in `/doc/` - architecture, standards, tasks
- **User docs** are in `/docs/` - guides for end users
```

After:

```md
- **Developer docs** are in `/doc/` - architecture, standards, tasks
- **User-facing guides** are in `/assets/guides/` - guides for end users, shipped inside the app

The guides in `/assets/guides/` are the canonical copy: the app serves them from its own
installed copy, and users read them in the About page or with `F1`. Editing them on GitHub and
editing what ships are the same act.
```

Leave the surrounding PR checklist, update reminder, questions, and license text unchanged.

#### `doc/README.md`

Replace the current line 15 with a local link to the shipped corpus and the canonicality
statement:

Before:

```md
User documentation is in [/docs](../docs/) (separate from dev docs).
```

After:

```md
User-facing guides are in [/assets/guides](../assets/guides/) - guides for end users, shipped inside the app (separate from developer docs).

The in-app copy in `/assets/guides/` is canonical: users read these guides in the About page or with `F1`.
```

#### `doc/agents-common.md`

Make both stale `/docs` references in this file accurate:

1. In the standalone-task completion list, replace:

   ```md
   4. Run `/userdoc` — update user docs in `/docs/`
   ```

   with:

   ```md
   4. Run `/userdoc` — update the user-facing guides in `/assets/guides/`
   ```

2. In the Folder Structure summary, remove the obsolete `/docs` line and keep the existing
   `/assets` entry concise. Add one sentence after the code block stating that `/assets/guides/`
   is the shipped canonical in-app copy reached through the About page and `F1`. Do not introduce
   a second top-level `guides/` directory.

Before:

```text
/assets              # Static assets (board-template/, demo-board/, agent/, guides/, editor-types/, …)
/doc                 # Developer documentation
  /epics             # Epic tracking
/docs                # User documentation
```

After:

```text
/assets              # Static assets (board-template/, demo-board/, agent/, guides/, editor-types/, …)
/doc                 # Developer documentation
  /epics             # Epic tracking
```

The `/assets/guides/` corpus is the canonical in-app copy shipped inside the app; users read it in
the About page or with `F1`.

The Documentation Map row was checked at its current line 144 and is already correct:

```md
| User documentation            | [assets/guides/index.md](../assets/guides/index.md) |
```

Do not change that row unless the implementation-time source has unexpectedly regressed. In
particular, do not restore a link to `docs/index.md`.

#### `doc/architecture/folder-structure.md`

The root tree already describes `assets/guides/` and its `agents/`, `editors/`, `screens/`,
`formats/`, and `scripting/` subtrees. Keep the existing `guides/` tree comment concise, then
remove the obsolete final tree line. Add one sentence after the tree stating that
`/assets/guides/` is the shipped canonical in-app copy reached through the About page and `F1`.

Before:

```text
│   ├── guides/             # Shared user and agent guide corpus
...
└── docs/                   # User documentation (published)
```

After:

```text
│   ├── guides/             # Shared user and agent guide corpus, shipped inside the app
...
```

The user-facing pages in `/assets/guides/` are the canonical in-app copy; users read them in the
About page or with `F1`.

Keep the rest of the verified root tree unchanged.

### 3. Remove the two stale `read_guide` mentions

The `read_guide` MCP tool was deleted in US-1353. Change only these two live residue sites:

- In `assets/board-call-regex/CLAUDE.md:10`, replace the obsolete tool instruction:

  Before:

  ```md
  The canonical bridge guide is available through `read_guide("boards")`.
  ```

  After:

  ```md
  The canonical bridge guide is available through the `guides.agents.boards` call path; the `persephone://guides/boards` MCP resource is an alternative.
  ```

  This matches the current `src/main/mcp/manifest.ts` instruction and resource registration:
  `guides.agents.boards` is the call path, while `persephone://guides/boards` resolves to
  `assets/guides/agents/boards.md`. The guide's front matter confirms it is the agent-facing
  Boards authoring reference.

- In `.claude/skills/mcp-test-agent/SKILL.md`, remove only the
  `mcp__persephone__read_guide, ` token from the single `allowed-tools` frontmatter line. Do not
  reorder, rewrap, or otherwise rewrite that skill.

  Before (fragment):

  ```text
  mcp__persephone__get_app_info, mcp__persephone__read_guide, mcp__persephone__browser_snapshot
  ```

  After (fragment):

  ```text
  mcp__persephone__get_app_info, mcp__persephone__browser_snapshot
  ```

Do not change the deliberate `read_guide` history in `assets/guides/whats-new.md`, any file under
`doc/epics/`, any file under `doc/tasks/`, or the `mcp-test-agent-call` skill's test wording that
mentions the deleted tool as unavailable.

### 4. Run the tracked-file gate and classify expected residue

After the deletion and pointer edits, run:

```bash
git grep -n "docs/"
```

Review every result manually. The acceptance condition is no live pointer into the deleted
repository folder. The following remaining hits are legitimate and must be enumerated in the
implementation result rather than mass-rewritten:

- historical records under `doc/epics/`, `doc/tasks/`, and `qa/runs/`;
- the changelog history in `assets/guides/whats-new.md`;
- the active roadmap's planning/history references in `doc/in-app-guides-roadmap.md`, which are
  not runtime pointers and belong to the EPIC-095 close-out record;
- third-party URLs: `developer.mozilla.org/.../docs/`, and av-grid's `main/docs/api.md` in
  `assets/board-template/CLAUDE.md`, `assets/guides/agents/boards.md`,
  `boards-assets/manifest.json`, and `boards-assets/README.md`;
- example strings that only look like paths: `"C:/docs/notes.txt"` in
  `assets/editor-types/recent.d.ts:13` and `src/renderer/api/types/recent.d.ts:13`.

Also confirm `git ls-files docs` returns no paths after the deletion, `git diff --check` is clean,
and the only changed files are the planned task files plus any conditional fixture move. Do not
use the grep gate as a reason to rewrite history, changelog prose, third-party URLs, or example
data.

Confirmed decisions requiring no change: this repository-hygiene task gets no
`assets/guides/whats-new.md` entry; the `mcp-test-agent-call` skill's “no `read_guide`” wording
stays as intentional test text; and the roadmap's own `docs/` mentions remain for EPIC-095
close-out.

### 5. Confirm the requested already-correct pointers remain correct

The following audit was performed against the current source. The future implementation should
re-run these checks after the edits and should add a file to the implementation plan only if a
value marked **already correct** has regressed:

| Source | Verified result | Planned implementation change |
|---|---|---|
| `README.md` Documentation block and inline guide links | Already points to local `assets/guides/*` pages, including the six Documentation entries and the inline setup, Boards, Mneme, Scripting, and catalog links | None |
| `build/README.txt` | `Documentation:` points to the GitHub `assets/guides` tree; the AI-agent section uses `resources\assets\guides\*` paths and `call("")` | None |
| `assets/board-template/CLAUDE.md:724` | Board guide points to `assets/guides/boards.md` | None; the av-grid `docs/api.md` links are third-party and stay |
| `assets/script-library/autoload/register-all.ts:11` | Comment points to `assets/guides/scripting/index.md` | None |
| `doc/standards/release-process.md` steps 3–4 and `.claude/commands/release.md` | Both use `assets/guides/whats-new.md` | None |
| `.agents/skills/userdoc/SKILL.md` | Scope says user docs are `/assets/guides/`, which ships inside the app; developer docs in `/doc/` belong to `/document` | None |
| `.agents/skills/document/SKILL.md` | Scope separates developer `/doc/` and Board docs from user-facing app docs in `/assets/guides/`, handled by `/userdoc` | None |
| `qa/README.md` and `.claude/skills/mcp-test-agent-call/SKILL.md` | Neither has a `docs/` folder residue; the call-only skill's `no read_guide` phrase is an intentional test constraint | None |
| `electron-builder.yml` | No `docs/` reference; `extraResources` copies `assets` to `assets`, which packages the guides | None |
| `.github/` workflows, `package.json`, `tsconfig*.json`, ESLint config, `.gitignore` | `git grep` found no `docs/` reference in these build/config surfaces | None |
| `doc/agents-common.md` Documentation Map row | Already links `User documentation` to `assets/guides/index.md`; only the stale completion and Folder Structure wording needs change | None for the row |

## Concerns

- **External bookmarks:** deleting the two stubs makes old GitHub `/docs/` bookmarks 404. EPIC-095
  explicitly accepts that cost because the discoverable README, build, and guide links already
  point at `assets/guides/`; do not add redirect stubs back.
- **Standing fixture rule:** the current `docs/examples/` inventory is empty, but the
  implementation must inspect it again. A newly appearing fixture is moved with `git mv` to
  `assets/guides/examples/`, never deleted.
- **False-positive grep results:** `docs/` is also part of historical records, changelog prose,
  third-party URLs, and path-shaped examples. Classify those hits instead of broad replacement.
- **Line drift:** the epic's cited line numbers are investigation anchors only. Match the exact
  surrounding sentence and tree block when editing.
- **Dashboard ownership:** `doc/active-work.md` and the EPIC-095 task table already contain the
  single US-1380 entry. They must not receive a duplicate link during implementation.

## Acceptance Criteria

- [ ] `git ls-files docs` returns no tracked paths, and the repository has no `docs/` folder after
      the two stubs are deleted.
- [ ] Before deletion, `git grep -n "docs/examples"` has only the verified historical records,
      and `assets/guides/examples/greek-gods.fg.json` exists. Any non-history reference or missing
      destination stops the task before deletion.
- [ ] Any file found under `docs/examples/` at implementation time is moved with `git mv` to
      `assets/guides/examples/`; no fixture is deleted.
- [ ] `CONTRIBUTING.md`, `doc/README.md`, `doc/agents-common.md`, and
      `doc/architecture/folder-structure.md` describe `/doc/` as developer docs and
      `/assets/guides/` as the shipped corpus, with one clear sentence per file identifying it as
      the canonical in-app copy reached through About/`F1`.
- [ ] `doc/agents-common.md` has no `/docs` naming in its completion or Folder Structure text, and
      its Documentation Map row remains linked to `assets/guides/index.md`.
- [ ] `assets/board-call-regex/CLAUDE.md` points board authors to `guides.agents.boards` and/or
      `persephone://guides/boards`, with no `read_guide("boards")` instruction.
- [ ] `.claude/skills/mcp-test-agent/SKILL.md` has the `mcp__persephone__read_guide` entry removed
      and is otherwise unchanged.
- [ ] No existing `read_guide` history is changed in `assets/guides/whats-new.md`,
      `doc/epics/`, or `doc/tasks/`.
- [ ] The verification table's already-correct pointers remain unchanged, and no wrong pointer
      discovered during implementation is left out of the plan.
- [ ] `git grep -n "docs/"` contains no live pointer into the deleted folder; every remaining hit
      is classified using the explicit history, roadmap, changelog, third-party, or example
      categories above.
- [ ] `git diff --check` passes, no implementation code or tests are changed, and no duplicate
      dashboard entry is added.

## Files Changed

| File or path | Planned change |
|---|---|
| `doc/tasks/US-1380-retire-docs-folder/README.md` | This task document; created before implementation. |
| `docs/index.md` | Delete the retired stub. |
| `docs/api/index.md` | Delete the retired API stub. |
| `docs/examples/**` → `assets/guides/examples/**` | Conditional `git mv` only if a fixture appears before implementation; currently empty. |
| `CONTRIBUTING.md` | Re-point the developer/user documentation split to `/doc/` and shipped `/assets/guides/`. |
| `doc/README.md` | Re-point the user documentation sentence to the canonical in-app shipped corpus. |
| `doc/agents-common.md` | Re-point the `/userdoc` completion wording and remove the obsolete `/docs` Folder Structure entry; retain the already-correct map row. |
| `doc/architecture/folder-structure.md` | Describe `assets/guides/` as the shipped canonical corpus and remove the `docs/` tree line. |
| `assets/board-call-regex/CLAUDE.md` | Replace the deleted-tool guide instruction with the current call path/resource. |
| `.claude/skills/mcp-test-agent/SKILL.md` | Remove only `mcp__persephone__read_guide` from `allowed-tools`. |

### Files verified and intentionally not changed

| File or area | Reason |
|---|---|
| `doc/active-work.md`, `doc/epics/EPIC-095.md` | The US-1380 dashboard/task entries already exist; do not duplicate them. |
| `README.md`, `build/README.txt` | Requested guide links and offline/package paths are already correct. |
| `assets/board-template/CLAUDE.md`, `assets/script-library/autoload/register-all.ts` | Requested guide links are already correct; unrelated av-grid URLs remain third-party references. |
| `doc/standards/release-process.md`, `.claude/commands/release.md` | Release steps already name `assets/guides/whats-new.md`. |
| `.agents/skills/userdoc/SKILL.md`, `.agents/skills/document/SKILL.md` | Their scope sentences already describe the `/assets/guides/` and `/doc/` split correctly. |
| `qa/README.md`, `.claude/skills/mcp-test-agent-call/SKILL.md` | No `docs/` folder residue exists; the call-only skill's `read_guide` wording is intentional test text. |
| `electron-builder.yml`, `.github/`, `package.json`, `tsconfig*.json`, ESLint config, `.gitignore` | No `docs/` reference was found; packaging already copies `assets/`. |
| `assets/guides/**` | The guide corpus and prose are not rewritten by this retirement task. |
| `assets/guides/whats-new.md`, `doc/epics/**`, `doc/tasks/**`, `qa/runs/**` | Historical/changelog records and the task plan retain their historical references. |
| `doc/in-app-guides-roadmap.md` | Its `docs/` mentions are roadmap planning/history and belong to EPIC-095 close-out, not runtime pointers. |
