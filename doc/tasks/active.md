# Active Tasks

Current work in progress and planned tasks.

> **Long-running migration in progress.** When there are no active tasks here, check
> [/doc/future-architecture/migration/README.md](../future-architecture/migration/README.md)
> for the next migration phase/task to pick up. Remove this notice when migration is complete.

## In Progress

(none)

## Planned (Next)

(none — check [migration doc](../future-architecture/migration/9.content-view-models.md) for next tasks: NotebookViewModel, TodoViewModel, etc.)

## Completed

See [completed.md](completed.md) for all completed tasks.

## How to Work on Tasks

### Starting a Task

1. Check this file for available tasks
2. Read the task's `README.md` in its folder
3. Update task status to "In Progress"
4. Update this file to move task to "In Progress" section

### During Work

1. Update the task's progress checklist as you complete items
2. Add notes for any decisions or discoveries
3. Commit regularly with task ID in message: `US-001: Fix import in ScriptContext`

### Completing a Task

1. Verify all acceptance criteria are met
2. Run the documentation checklist:
   - [ ] Update architecture docs (if structure changed)
   - [ ] Update standards docs (if new patterns established)
   - [ ] Review and update user guidance docs in `/docs/` — check all pages that describe affected features, update text/screenshots to match the new behavior
   - [ ] Update CLAUDE.md (if significant patterns or key files changed)
   - [ ] Update `/docs/whats-new.md` (for notable features/changes)
3. Add task to the top of [completed.md](completed.md)
4. **Ask user for confirmation** before deleting the task folder
5. Delete task folder after user confirms

## Creating New Tasks

1. Copy `_template/` folder to `US-XXX-short-name/`
2. Fill in the README.md
3. Add to "Planned" section in this file
4. Use next available US number

## Task ID Format

`US-XXX` where XXX is a sequential number.

- US-001 through US-099: Infrastructure/refactoring
- US-100+: Features and enhancements

---

*Last updated: 2026-03*
