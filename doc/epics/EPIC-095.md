# EPIC-095 — Retire `docs/`

**Status:** Active
**Started:** 2026-09-07
**Roadmap:** [in-app-guides-roadmap.md](../in-app-guides-roadmap.md) — epic 4 of 4, the last
**Follows:** EPIC-092 (guide corpus and the `guides` node), EPIC-093 (About page as guide browser),
EPIC-094 (per-screen guides and layout schemas) — all completed 2026-09-07
([completed.md](completed.md))

## Goal

Delete `docs/` from the repository and leave nothing pointing into it. The corpus that replaced it,
`assets/guides/`, has passed three gates: an agent reaches every page by `call` path
(EPIC-092), a user reaches every page from the About browser and `F1` (EPIC-093), and a fresh Haiku
agent answers "where is X on screen?" from the layout schemas rather than from the DOM (EPIC-094).
Roadmap principle 5 — *retire nothing until its replacement passes the same gate* — is therefore
satisfied, and this epic is the deletion plus the small residue the three predecessors left behind.

## What the predecessors already did

The roadmap's EPIC-095 row (written before EPIC-092 started) lists a re-pointing job that has
largely already happened, because each epic re-pointed what it touched rather than deferring it.
Verified 2026-09-07 by `git grep` over tracked files:

| Roadmap item | State |
|---|---|
| `docs/` itself | **Two stub files left** — `docs/index.md`, `docs/api/index.md`. Everything else moved in EPIC-092 with history (`git mv`) |
| README *Documentation* block | **Already done** — all six entries point at `assets/guides/*`; inline links in the feature sections too |
| `build/README.txt` | **Already done** — `Documentation:` points at `tree/main/assets/guides`, and the stale `read_guide` lines became `resources\assets\guides\*` file paths with a `call("")` instruction |
| `assets/board-template/CLAUDE.md:724` | **Already done** — points at `blob/main/assets/guides/boards.md` |
| `assets/script-library/autoload/register-all.ts:11` | **Already done** — points at `blob/main/assets/guides/scripting/index.md` |
| Release process step 3/4 | **Already done** — `doc/standards/release-process.md` and `.claude/commands/release.md` both name `assets/guides/whats-new.md` (there is no `.claude/skills/release/`; the release entry point is a command, not a skill) |
| `/userdoc` skill | **Already rewritten** in EPIC-094 — `assets/guides/` scope, the page list derived from the corpus by `grep` rather than a hard-coded table, the layout-schema re-check as step 6, `assets/guides/whats-new.md` as step 7 |
| `/document` skill division sentence | **Already correct** — "User-facing app docs in `/assets/guides/` are handled by the `/userdoc` skill separately" |
| The in-app What's New upcoming-section gate | **Already implemented** in EPIC-093 — `AboutGuideBrowserView.ts:340` passes `includeUpcoming: import.meta.env.DEV \|\| showAgentGuides`, exactly the roadmap default |

So the epic's own pointer work is four lines of prose plus two stale `read_guide` mentions, and the
larger part of its value is the two EPIC-094 deferrals and the roadmap close-out.

## What ships

1. `docs/` is gone. No tracked file names a path inside it.
2. Four surviving prose pointers say `assets/guides/` and say which copy is canonical:
   `CONTRIBUTING.md:164` (the `/docs/` vs `/doc/` split), `doc/README.md:15`,
   `doc/agents-common.md:97` (the completion-step wording, and the Documentation Map's *User
   documentation* row), `doc/architecture/folder-structure.md:88` (the tree).
3. Two stale `read_guide` mentions go: `assets/board-call-regex/CLAUDE.md:10` (a board-author
   instruction naming a tool deleted in US-1353) and the `mcp__persephone__read_guide` entry in
   `.claude/skills/mcp-test-agent/SKILL.md`'s `allowed-tools`. Historical `read_guide` mentions in
   `assets/guides/whats-new.md` and under `doc/epics/` are changelog and history and stay.
4. `highlight` can reveal a hover-gated control, so the grid row filter — the subject of EPIC-094's
   gate question A.2 — can be pointed at as well as described.
5. Notebook note tag chips get a `data-name` and an `elements` entry, following the grid filter's
   precedent (explicit `selector`, `highlightOptions: { all: true }`).
6. The roadmap is marked complete, with a closing note carrying the consolidated Needs-user-check
   list for all four epics, and is pointed at from `doc/epics/completed.md` as the transparency
   roadmap once was.

## Decisions

1. **`docs/` is deleted outright, stubs included.** EPIC-092 shipped the two stubs precisely so
   nothing 404ed *between* then and now; that window closes here. An external bookmark to
   `github.com/.../docs/index.md` will 404, which is the accepted cost recorded in EPIC-092
   decision 3 — a repository folder is not an API, GitHub serves no redirects for one, and the
   alternative (keeping two files forever to serve a link nobody has been observed following) is
   exactly the duplication this roadmap exists to end. README, `build/README.txt` and the six
   documentation links all point at the new location already, so the discoverable paths are correct
   before the old ones disappear.

2. **The API reference stays.** Roadmap default, audience `user`, and EPIC-092's Needs-user-check
   item 2 deferred the keep-or-drop question to "after EPIC-095 with usage in mind". The answer is
   keep, for two reasons this epic can verify rather than assume. The 16 pages are the only prose
   that documents the `app.*` surface for a *human* — `assets/editor-types/*.d.ts` gives a scripter
   signatures and JSDoc in an editor, not an explainable page, and `$help` gives an agent a
   descriptor, not a worked example — and `guides.search` now searches them, so they carry their
   weight for the agent as well. Deleting them would be a content decision dressed as cleanup, and
   nothing in the three gates argued for it. **The open question stays open**: nobody has measured
   whether they are read. The instrument the roadmap suggested (the About page counting guide opens
   locally) is not built and is not built here — it is a feature with a privacy shape, and it would
   be the wrong thing to add silently inside a deletion epic. Recorded under Needs user check.

3. **`docs/examples/` is empty and there is nothing to rescue.** `docs/examples/greek-gods.fg.json`
   moved to `assets/guides/examples/` in EPIC-092 (decision 6) with its referrer re-pointed. The
   task verifies the folder holds nothing else before deleting; if anything is found it is **moved,
   not deleted**, per the standing fixture rule, and recorded here.

4. **`highlight` reveals rather than fails.** EPIC-094 left this as "a question about `highlight`,
   not about the corpus", and the answer is that a pointing tool which cannot point at a control the
   guide just described is not finished. The implementation follows the existing overlay
   (`assets/agent/ui-highlight.js`, `app.ui.highlightElement`) rather than introducing a second
   mechanism, and the shape is chosen in the task document from what the running DOM supports. It
   must not leave the app in a changed state: whatever reveals the control is undone when the
   highlight is dismissed, and a control that is genuinely absent must still report `found: false`
   rather than being conjured. That last clause is the one to hold the plan to — a reveal step that
   force-shows anything matching a selector would turn a true negative into a false positive, which
   is worse than the gap it fixes.

5. **The per-toolbar "?" button is declined, not deferred again.** EPIC-094 shipped a Menu Bar
   *Guide for this page* item, which answers the same need for every screen from one place, and its
   own review found that some editors supply their own toolbar with neither a switch nor a
   page-nav affordance — so "consistent across editors" is not achievable without touching editor
   toolbars one by one. A per-toolbar button would add 30-odd insertion points, each a place for the
   Menu Bar item and the button to disagree, in exchange for one saved click on a path that already
   has `F1`. Declined with that reason recorded, so the next epic does not re-inherit it.

## Non-goals

- Rewriting any guide prose. The corpus is what EPIC-092..094 left; this epic changes pointers,
  deletes a folder, and closes two element-contract gaps.
- Splitting, merging or deleting API reference pages (decision 2).
- Building guide-open telemetry (decision 2).
- Screenshots in the guides (EPIC-094 decision 1, unchanged).
- Any change to `guides.*` paths, the `persephone://guides/*` URIs, or the About browser.

## Tasks

| Task | Title | State |
|------|-------|-------|
| US-1380 | [Delete `docs/` and re-point the last references](../tasks/US-1380-retire-docs-folder/README.md) | Planned |
| US-1381 | [`highlight` reveals hover-gated controls; notebook tag chips get `data-name`](../tasks/US-1381-highlight-reveal-and-tag-chips/README.md) | Planned |

Epic close is not a task: the gate run, the roadmap close-out and the completion skills are the
epic's own closing steps.

## The gate

`docs/` is deleted only when both hold:

1. `git grep -n "docs/"` over tracked files returns no live pointer into the folder — only history
   (`doc/epics/`, `doc/tasks/`, `qa/runs/`), changelog (`assets/guides/whats-new.md`), unrelated
   third-party URLs (`developer.mozilla.org/.../docs/`, av-grid's `docs/api.md`) and example strings
   that merely look like paths (`"C:/docs/notes.txt"` in two `.d.ts` files).
2. A `mcp-test-agent-call` run (Haiku, `call` only, no prior knowledge) answers a mixed set — a
   guide question, a where-is-X question, and a what's-new question — from `guides.*` alone, after
   the deletion. Logged under `qa/runs/`.

Plus a live check in the running window that About, `F1`, `guides.whatsNew` and
`persephone://guides/notebook` still serve.

## Concerns

- **The deletion is the easy half; the residue is the risk.** A `git grep` for `docs/` returns
  hundreds of hits that are all legitimately history or third-party URLs, and the four that matter
  are prose sentences a naive sweep would either miss or mangle. The task document must name the
  four by file and line and leave the rest alone — an over-eager rewrite of `doc/epics/EPIC-013.md`
  would falsify the record of what that epic actually did.
- **`highlight`'s reveal step touches a live user surface.** The overlay runs in the renderer
  against the real DOM; a reveal that survives dismissal, or that fires on a control the user is
  interacting with, is a visible defect rather than a documentation gap. Decision 4's two clauses
  are the acceptance test.
- **The notebook chip is repeated per-note content**, which is why EPIC-094 recorded it rather than
  adding it. The grid filter established the pattern, so this is now a precedent-following change —
  but if the chips turn out to need a `data-name` on a React-rendered node or on a node the note
  editor recreates per keystroke, that is a reason to stop and record, not to force it.
- **The roadmap's own numbers are stale in three places** ("31 files, ~11k lines", "17 API pages",
  the `CONTRIBUTING.md:164` / `assets/board-template/CLAUDE.md:724` line cites). The close-out note
  says so rather than silently correcting the table, because the table is a record of what was
  planned.

## Needs user check

Recorded rather than blocking; work proceeds on the defaults above.

1. **The API reference's long-term fate stays open** (decision 2). Kept, audience `user`, and no
   usage evidence exists because the instrument was deliberately not built. If the user wants the
   question actually settled, guide-open counting is a small feature with a privacy shape and
   belongs in its own task.
2. **External links to `docs/` will 404** (decision 1). Accepted; if the user knows of a published
   link into `docs/` — a forum post, a README elsewhere, a bookmark they use — say so and the two
   stubs can come back as one-line redirect pages.
3. **The per-toolbar "?" button is declined** (decision 5), reversing EPIC-094's "deferred". If the
   user wants it anyway, it is additive over finished pages, not a rework.

### Carried forward from the whole roadmap

Consolidated here because EPIC-095 closes the roadmap and these otherwise stay buried in three
completed epic documents. None is blocking; all are one user sentence away from being settled.

- **Root name `guides` vs `userGuide`** (EPIC-092 #1). Shipped as `guides`, now wired into the
  About browser, the MCP resource URIs and the `persephone-guide://` scheme — a rename is no longer
  the one-descriptor change it was, so this is effectively settled by shipping.
- **Front matter in the GitHub preview** (EPIC-092 #4). A `---` block renders as a table or as
  literal text depending on the viewer. Accepted because the in-app copy is canonical, but the user
  may dislike how `assets/guides/index.md` looks on GitHub — which matters more now that the README
  sends readers there.
- **`persephone-guide://` scheme name** (EPIC-093 #1). Shipped; consistent with
  `persephone-board://` and `persephone-toolset://`.
- **Whether *Show agent guides* should be sticky** (EPIC-093 #2). Currently browser state that
  resets when About is re-opened. A persisted `app.settings` entry is a small follow-up.
- **Whether the guide browser needs its own search box** (EPIC-093 #3). `guides.search` serves the
  agent; the user-facing equivalent was deferred so the pane could prove itself first. It has.
- **`pages` and `pages.closePage` do not see folder pages** (EPIC-093 #4). A real gap, sized in that
  epic and deliberately not fixed: `PageCollectionWrapper.all` filters on `mainEditor`, and
  admitting an editor-less page raises the question of what `pages[i].editor` should be for a folder
  tab. Unrelated to the guides; wants its own task.
- **Screenshots in the guides** (EPIC-094 #1). Stay out; additive if wanted.
- **`editors/index.md` shrank from 935 lines to a table** (EPIC-094 #4). The prose is not lost, but
  a bookmark to the long catalogue now lands on something different.
- **`PathSyntaxError` does not suggest bracket syntax for a hyphenated segment** (EPIC-092 gate).
  Fixing it at the parser fixes hyphenated paths at every root rather than per tree; it touches a
  surface every tree shares and wants its own task.

## Notes

### 2026-09-07 — what the sweep actually found

The roadmap's EPIC-095 row named six pointer sites. Five were already correct; the survivors are
four prose sentences and two stale `read_guide` mentions. That is not a sign the row was wrong — it
is what happens when each epic re-points what it touches instead of writing it down for later, and
it is worth recording as the reason this epic is two tasks rather than six.
