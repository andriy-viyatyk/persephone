# US-475: UIKit Tag — placeholder

**Epic:** EPIC-025 (Phase 4 — form infrastructure)
**Blocks:** US-432 Phase 4 (EditLinkDialog tags row)
**Status:** **Placeholder — investigation pending**

---

## Goal

Build a UIKit `Tag` primitive that replaces the inline `tag-chip` styled spans currently used in `EditLinkDialog` (and a few other tag-row consumers) with a reusable, themed component.

---

## Background

This document is a placeholder. **Investigation has not been done yet** — see [Implementation plan](#implementation-plan) below. Before implementation begins, this README must be expanded into a full task document (Goal → Background → Implementation Plan → Concerns → Acceptance Criteria → Files Changed) per the [task-docs rule](../../.claude/rules/task-docs.md).

Known consumers (initial audit, not exhaustive):

- `src/renderer/editors/link-editor/EditLinkDialog.tsx` (`.tag-chip` styled span, with a `<CloseIcon />` remove affordance) — primary driver. Tags row also includes a `PathInput` for adding new tags.
- `src/renderer/editors/notebook/NoteItemView.tsx`, `src/renderer/editors/link-editor/LinkTooltip.tsx`, `src/renderer/editors/todo/components/TodoListPanel.tsx` — additional candidate consumers (TBD whether they should adopt `Tag` or keep bespoke styling).

The EPIC-025 naming table maps the legacy `Chip` concept to **`Tag`** (`uikit/CLAUDE.md` § Naming conventions).

---

## Implementation plan

**TBD** — investigation pending.

Areas to settle before drafting the plan:

- API surface — `label`, `onRemove`, `disabled`, `size`, optional `icon`, optional `variant`/color, optional `onClick` for clickable tags.
- Whether a tags row container component is needed (`<TagsRow>` with wrap + gap), or whether `<Panel direction="row" wrap gap="sm">` is sufficient and `Tag` ships standalone.
- Removal affordance — keyboard-accessible remove button, focus management when removed.
- Token usage — background color (currently `color.background.light`), border, font size, padding (`2px 6px 2px 8px` on legacy).
- Accessibility — should `Tag` be a `<span role="button">` when clickable? When non-clickable + non-removable, plain text? Pattern decision.

---

## Concerns / Open questions

**TBD** — investigation pending.

---

## Acceptance criteria

**TBD** — investigation pending.

---

## Files Changed

**TBD** — investigation pending.
