# US-1530: Single-instance boards — one page for every link a board claims

**Status:** Placeholder — not planned yet
**Epic:** [EPIC-114: The torrent board — a module contributes below the UI](../../epics/EPIC-114.md)

> **This is a placeholder, not an implementation plan.** It exists so the investigation already done
> is not repeated. Before implementing, this needs the normal task-document treatment: deep
> investigation, a step-by-step plan with verified file paths, concerns and acceptance criteria.

## Goal

Let a board declare itself **single-instance**, so every link it claims opens in the one board page
instead of creating a new page per link.

## Why

*(User decision, 2026-09-27: "the board should be singleton. If multiple links is open that all of
them are shown in one torrent page and only one board is provider for all links.")*

Observed live while verifying US-1478: opening two claimed `.torrent` URLs produced **two separate
Torrent Viewer pages**, each listing only the torrent it had resolved, even though a single shared
service already held both.

This is a general capability, not a torrent concern. Any board holding session state — a torrent
list, a database browser, a task dashboard — wants one page rather than one page per link.

## What was established (verified 2026-09-27, do not re-derive)

The platform has two reuse mechanisms today and **neither fits**:

| Mechanism | Scope | Why it does not fit |
|---|---|---|
| `registerWellKnownPage` / `requireWellKnownPage` (`src/renderer/api/pages/well-known-pages.ts`) | App-wide get-or-create by fixed id | The ids are **hardcoded in core** (`mcp-ui-log`, About, Settings). A board cannot register one. |
| `matchesNavigationTarget` / `reuseNavigationTarget` (US-617; `EditorModel.ts:311-325`, `PageNavigator.ts:77-100`) | **Within a single page** | Promotes an existing editor instance back to main on the same page. Two links still open two pages. |

`requireWellKnownPage`'s get-or-create, plus `addPage`'s dedupe-by-page-id
(`PagesLifecycleModel.ts:866-869` — *"a second call with the same fixed id focuses the existing
singleton instead of duplicating it"*), is the **right primitive**. The work is generalizing it from
a core-hardcoded id to a board-scoped one.

## Sketch of the shape (to be confirmed by investigation)

- A manifest declaration, opt-in — a board that wants a page per file (an editor board) must keep
  today's behaviour. This is a different axis from `fileMasks` / `browserUrlMasks`; see D12 on why
  separate claims stay separate.
- On open — claimed download, `torrent://` link, or a plain board open — focus the existing page
  and **deliver the source to it** rather than creating a page. Delivering the source is the part
  that needs design: the board must learn about the new link without a page load.
- Decide what a *second window* means. Well-known pages are per-window; "single instance" may mean
  per-window rather than per-app, and the two differ for a user with two windows open.

## Depends on

**[US-1529](../US-1529-torrent-board-service-snapshot/README.md) should land first.** The board
renders its list from a page-local `sessions` map (`app.js:248`), not from the service snapshot, so
each page lists only what it resolved. Singleton alone would not fix that — it would hide it behind
a single page, and the list would still be lost on board reload. Fixing the source of truth first
keeps this task purely about page routing.

## Open questions for the investigation

- Per-window or per-app?
- What happens to an already-open second page when a board becomes single-instance (an upgrade, or
  a trust change)? Leave it, or fold it in?
- Does a single-instance board still restore correctly from a cold start with no page open (D5)?
- Does this interact with grouped pages, pinning, or the board-secondary panels?
