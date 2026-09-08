# US-1401: Git Tree — the Commit and Diff panels stay empty when a commit is selected

**Type:** user-reported bug (visual defect). **Status:** queued behind EPIC-099.
**Reported:** 2026-09-08.

## Goal

Selecting a commit in the Git Tree grid shows that commit's message in the **Commit** tab and its
changed files in the **Diff** tab of the bottom panel. Today both tabs are always empty.

## Report (verbatim intent)

> When I select commit in GitTree grid the bottom panel does not show commit message and changed
> files in the commit. Those two tabs "Commit" and "Diff" on bottom GitTree panel are always empty.

## Background

Editor folder: `src/renderer/editors/git-tree/` — `GitTreeEditorModel.ts`, `GitTreeEditorView.ts`,
`CommitInfoPanel.ts` (the Commit tab), `CommitDiffPanel.ts` (the Diff tab), `GitChangesView.ts`,
`GitRefsView.ts`, `GitPanelSecondaryView.ts`. The Git Tree page also has an AiVision facade (see the
facade table in `doc/architecture/scripting.md`) that can read the selected commit — useful to tell
whether selection state is updating while the panels are not.

Likely shapes of the defect, to be confirmed by investigation, not assumed:
- the panels subscribe to a selection state that the grid no longer writes (a state or `bind`
  target renamed or replaced during a refactor);
- the panels bind before mount, or were converted to a `SubtreeSwap` whose key never changes;
- the git command that loads commit details fails silently (check with the page's `ui.log` /
  console and the process API).

Recent history to check: `git log --oneline -- src/renderer/editors/git-tree` for the commit that
introduced the regression, then `git bisect`-style reading rather than guessing.

## Implementation plan

1. Reproduce on the dev app: open a Git Tree page on this repository, select a commit, confirm both
   tabs are empty; read the selected commit through `call` (`pages[i].editor`) to see whether the
   model has it.
2. Find the break (state wiring vs. data loading) in the files above; fix at the cause.
3. Verify: Commit tab shows author, date, message; Diff tab lists changed files and opens a file diff
   on click, as before. Check both a fresh page and a page restored after restart.
4. Add a Bug Fixes entry under `## Version 5.0.1 (Upcoming)` in `assets/guides/whats-new.md`.
5. Completion: `/review`, `/document`, `/userdoc`; record in `doc/tasks/completed.md`.

## Acceptance criteria

- [ ] Selecting a commit fills the Commit tab (message, author, date) and the Diff tab (changed files).
- [ ] Changing the selection updates both tabs; a restored page behaves the same as a fresh one.
- [ ] No console errors on selection; `tsc` and `lint` clean.
- [ ] What's New entry present.
