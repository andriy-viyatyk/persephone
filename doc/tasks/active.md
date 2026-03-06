# Active Tasks

Current work in progress and planned tasks.

## In Progress

(none)

## Planned (Next)

| ID | Title | Epic | Notes |
|----|-------|------|-------|
| US-117 | Fix editor switch buttons for structured JSON editors | — | Notebook, Todo, Link editors don't show correct switch buttons when page title lacks proper file extension |

## Completed

See [completed.md](completed.md) for all completed tasks.

## How to Work on Tasks

### Starting a Task

1. Check this file for available tasks
2. Read the task's `README.md` in its folder (if it exists)
3. Update task status to "In Progress"
4. Update this file to move task to "In Progress" section

### During Work

1. Update the task's progress checklist as you complete items
2. Add notes for any decisions or discoveries
3. Commit regularly with task ID in message: `US-001: Fix import in ScriptContext`

### Completing a Task

1. Verify all acceptance criteria are met
2. Run `/project:review` — check code against architecture docs
3. Run `/project:document` — update developer docs in `/doc/`
4. Run `/project:userdoc` — update user docs in `/docs/`
5. Add task to the top of [completed.md](completed.md)
6. **Ask user for confirmation** before deleting the task folder (if one exists)
7. Delete task folder after user confirms

### Creating New Tasks

1. Copy `_template/` folder to `US-XXX-short-name/` (optional for small tasks)
2. Fill in the README.md
3. Add to "Planned" section in this file
4. Use next available US number

### Epic Links

Tasks can optionally be linked to an epic: `(EPIC-XXX)` after the task title.
See [/doc/epics/active.md](../epics/active.md) for active epics.

## Task ID Format

`US-XXX` where XXX is a sequential number.

- US-001 through US-099: Infrastructure/refactoring
- US-100+: Features and enhancements

---

*Last updated: 2026-03*
