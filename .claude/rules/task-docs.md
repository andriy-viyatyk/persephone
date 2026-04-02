---
paths:
  - "doc/tasks/**"
  - "doc/epics/**"
---

When creating or editing task documents:

- Follow the structure: Goal → Background → Implementation Plan → Concerns → Acceptance Criteria
- Implementation plan must have exact file paths and enough detail to implement after context compaction
- Resolve all "TBD" and "open question" items before implementation begins
- Include a Files Changed summary table at the bottom
- Replace vague references with exact file paths and method names
- Include before → after code snippets for changes
- List files that need NO changes (so the agent doesn't waste time investigating)
- Remove conversational artifacts ("Wait —", "Actually...", "Hmm") that confuse a fresh reader
- Link tasks to active epics when applicable
