# EPIC-132: Right-pinned pages in a popover

## Status

**Status:** Completed
**Created:** 2026-10-24
**Completed:** 2026-10-24

## Overview

A tab can be **pinned to the right**. Right-pinned tabs sit at the far right of the window header,
next to the window buttons. Clicking one does not activate its page: it opens the page in a
floating, resizable popover over the top-right of the page area, and the current active page
stays active underneath. A click away closes the popover; the page keeps running.

The driving use case is the Claude Agent board (EPIC-131 / persephone-boards BT-046). The agent
chat lives in a right-pinned tab, the user opens it over whatever they are working on and types
"Summarize the page", and the agent reads the active page through the private MCP endpoint, where
`page` / `pages.activePage` already resolve to it. The feature is generic: any page can be
right-pinned.

## Goals

- Right-click a tab and choose **Pin to the right**. The tab moves to a right strip in the header,
  aligned to the far right (after the header spacer, before the window controls). Several
  right-pinned tabs can be reordered among themselves by dragging, like left-pinned tabs.
- Clicking a right-pinned tab toggles a popover showing that page in full: toolbar, footer,
  sidebar with Explorer and so on. It is the regular page view, not a reduced one.
- The popover is anchored to the top-right of the page area. It opens at 50% of the page area's
  width and height, has a resize grip in its **bottom-left** corner, and can be resized up to a
  maximum of 80% of the width and height. It has a sensible minimum size.
- Opening the popover never changes the active page. While it is open, the active page is still
  the one the tab strip highlights, the one MCP's `page` / `pages.activePage` returns, and the one
  that is saved as active.
- A click (or a move of focus) outside the popover closes it.
- Right-pinned pages cannot be grouped, closed, dragged into the main tab strip, or moved to
  another window. To get rid of one, unpin it first; it becomes a normal tab.
- The pin side and the popover size survive a restart.

## Design decisions

**R1 — The popover reuses the page's own slot. Nothing is reparented.**
`AppPageManagerView` keeps one absolutely-positioned slot per page. Slots are deliberately never
moved in the DOM, because moving a `<webview>` or board `<iframe>` reloads it
(`GroupContainer.ts`, `ImperativeSplitter.ts`). The popover is therefore **a style of the existing
slot**: when a right-pinned page's popover is open, its slot is displayed with popover geometry
(anchored top-right, sized, z-indexed above the active page, with border, shadow and grip). When
closed, the slot is `display: none` like any inactive page. Pinning, unpinning, and opening or
closing the popover never reload the page. That is essential for the agent board, whose live
sessions would die on a reload.

Rejected: rendering the page inside the uikit `PopoverView`. That would mean a second
`PageContentView` instance or reparenting, which reloads foreign documents. We reuse the
`PopoverView` behaviours (click-away rules, grip drag) but not its DOM.

**R2 — Pin side replaces the boolean.**
The page gets a pin side: `"left" | "right" | undefined`. `pinned` (boolean) stays as a derived
getter meaning "left" so existing callers and persisted descriptors keep working. The persisted
`PageDescriptor` gains `pinSide`; an old descriptor with `pinned: true` restores as `"left"`.
`pages[]` order is three zones: left-pinned, normal, right-pinned. `moveTabByIndex` compares zones
instead of the boolean, and `pinTab(side)` / `unpinTab` move pages to the zone edge.

**R3 — "Focused page" is a new, derived notion. "Active page" keeps its meaning.**
`pagesModel.query.focusedPage` is the popover page while a popover is open, otherwise the active
page. Code that means "the page the user is interacting with" moves to `focusedPage`; code that
means "the page the user is looking at / working on" stays on `activePage`. Investigation found:

| Place | Today | Change |
|-------|-------|--------|
| `KeyboardService` Ctrl+W / Ctrl+F4 | closes `activePage` | targets `focusedPage`; a right-pinned page is not closable, so it does nothing |
| `KeyboardService` F1 | guide for `activePage`'s editor | `focusedPage` |
| `KeyboardService` Ctrl+Tab | cycles from `activePage` | unchanged; it also closes the popover |
| `BrowserEditor` host keys (F5, Ctrl+R, F12, Ctrl+F, Esc) | only when `activePage === this.page` | "is this page focused or visible" check |
| `BoardWebview` `page.visible` | active or grouped with active | also true while shown in the popover |
| `AppPageManagerView.hasBeenActive` | page drawn only once active | opening a popover also counts |
| `pagesModel.onFocus` consumers | focus after `showPage` | opening the popover sends `onFocus` for its page; closing the active page must not steal focus from an open popover |
| ai-vision `page-elements.activatePageAndWaitForLayout` | calls `showPage`, waits for a non-zero slot | for a right-pinned page, opens the popover instead |
| ai-vision `window-screen` privacy block (Tor / incognito) | checks only `activePage` | checks every **visible** page: active, grouped, and popover. This is a privacy requirement, not polish. |
| ai-vision `page-activated` event text | "the previous page is hidden / has no layout box" | not emitted for popover open/close; wording must not claim a popover page is hidden |
| `window-recording` page/editor region | `activePage`'s slot | unchanged (records the active page); revisit if users ask |

Text, Markdown, Monaco, notebook and find-bar shortcuts are wired to the editor's own DOM keydown,
so they already follow DOM focus and need no change.

**R4 — `showPage` on a right-pinned page opens its popover.**
A right-pinned page never becomes the active page. `PagesNavigationModel.showPage(id)` for a
right-pinned page opens the popover instead, so every existing caller (scripts, MCP, links,
"reveal" commands) behaves sensibly without knowing about popovers. `ordered` never ends with a
right-pinned page. On restore, a persisted `activePageId` that points at a right-pinned page falls
back to the last normal page.

**R5 — Restrictions live in the model, not only in the UI.**
`groupTabs` / `group` refuse a right-pinned page; Ctrl+click on a right tab does nothing.
`page.close()` on a right-pinned page is refused unless it comes from an explicit unpin-and-close
path. Window close and app shutdown still dispose pages normally. Cross-window drag, *Open in New
Window*, *Close Others / To the Right* and *Duplicate* (which groups) exclude right-pinned pages.
`movePageIn` never inserts into the right zone. Scripts and MCP get the same refusals as the UI,
with a clear error message.

**R6 — Click-away must cover foreign documents and portals.**
A document `pointerdown` does not fire for clicks inside a board `<iframe>` or a browser
`<webview>` on the page underneath. Click-away is therefore *pointerdown outside the popover* **or**
*focus moving outside the popover* (a `focusin` on an element outside it, or window `blur` with
`document.activeElement` being an iframe or webview outside it). Elements a popover page opens
outside its own subtree must not count as "outside": context menus, dropdowns, dialogs, tooltips,
popovers, and the uikit portal roots. The right-pinned tab itself toggles rather than closing and
reopening, like the quick-settings button (`outsideClickIgnoreSelector`).

**R7 — Escape closes the popover only when the page did not handle it.**
The popover listens to Escape in the bubble phase and skips events that are `defaultPrevented`.
Escape in the agent chat (interrupt), a find bar, or a menu inside the page does not also close
the popover. Escape inside a board iframe or webview does not reach the host and so never closes
it; the user clicks away instead.

**R8 — Geometry.**
The anchor is the top-right corner of `.pages-container`, with a small inset. Default size is 50%
× 50% of the container; maximum is 80% × 80%; minimum is about 360 × 240 px, clamped to the
maximum on small windows. The grip in the bottom-left corner resizes width leftwards and height
downwards. The size is remembered **per page**, as fractions of the container so it scales with
the window, and persisted in the page descriptor. When the window shrinks, the size is clamped to
the maximum at render time.

**R9 — Per window.**
Right-pinned pages belong to their window like any page. They cannot be dragged between windows.
A window whose state holds a right-pinned page is kept on close, the same rule as left-pinned
pages (`open-windows.ts windowOnClose`).

**R10 — Agent context.**
Persephone needs no agent-specific API: MCP `page` / `pages.activePage` already mean "what the
user is looking at" once R3 and R4 hold. The page listing (`PageCollectionWrapper`) marks the
popover page, and `pages[i]` exposes its pin side and an `openPopover()` / `closePopover()` pair.
The Claude Agent board's default instructions (persephone-boards `service.mjs`) currently say the
chat page "is usually the active one … check the page grouped beside this one first". These must be
rewritten for the popover case. Optionally, the board could prefix each prompt with the active
page's title. That needs a board-bridge read of the active page, which the bridge does not offer
today (`PersephonePageApi` only has `visible`), so it is out of scope unless a task adds it with a
`BOARD_BRIDGE_VERSION` bump.

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| [US-1717](../tasks/US-1717-pin-side-model/README.md) | Pin side model: zones, persistence, and right-pin restrictions (R2, R4, R5, R9) | Done |
| [US-1718](../tasks/US-1718-right-tab-strip/README.md) | Right tab strip: header placement, context menu, reorder, toggle click | Done |
| [US-1719](../tasks/US-1719-popover-host/README.md) | Popover host: slot geometry, grip resize, size persistence, click-away, Escape (R1, R6–R8) | Done |
| [US-1720](../tasks/US-1720-focused-page/README.md) | Focused page: retarget keyboard, browser keys, board visibility, privacy block, ai-vision activation (R3) | Done |
| [US-1721](../tasks/US-1721-scripting-mcp-surface/README.md) | Scripting / MCP surface and docs for right-pinned pages (R10) | Done |
| BT-046 (persephone-boards) | Claude Agent board instructions for the popover case (`scripts/service.mjs` DEFAULT_INSTRUCTIONS) | Done |

Order: US-1717 → US-1718 and US-1719 (these two can run in parallel) → US-1720 → US-1721 → board
task. US-1720 must ship in the same release as US-1719, because the popover is unsafe without the
privacy and Ctrl+W retargeting.

## Concerns

- **Click-away completeness (R6).** The iframe/webview focus heuristic is the riskiest part. A
  click on a non-focusable area inside a foreign document may neither fire a host `pointerdown`
  nor move focus. Verify live with a board page, a browser page and a Monaco page underneath. A
  transparent catch-all layer under the popover would fix it but would swallow the first click,
  so it is rejected unless the heuristic proves insufficient.
- **Portals (R6).** Every uikit overlay that a popover page can open must be recognised as "inside".
  Prefer one shared marker (a data attribute on portal roots) over a growing selector list.
- **Hidden-page assumptions beyond the table in R3.** Some code may branch on "active" without
  being found yet. US-1720 should grep `activePage` across `src/renderer` once more and classify
  each use.
- **Left-pinned "Pin Tab" / "Unpin Tab" labels are hard-coded, not translated.** Fix this in
  US-1718 together with the new items.
- **Keyboard shortcut to toggle the last popover** (for example Ctrl+`) is deliberately out of
  scope. Add it as a follow-up if wanted.

## Notes

### 2026-10-24 — implementation
- All five tasks and the board instruction change implemented autonomously (Codex implementation, Claude plan review and live checks). Typecheck, lint and build-prod pass.
- Live-verified in dev Persephone: pin to the right / unpin through the tab menu; right tab toggles the popover without changing the active page; popover opens top-right at 50%, focus moves in; bottom-left grip resizes leftward/downward, clamped at 80%; Escape, a click outside, and focus moving into the board iframe underneath all close it; a click inside keeps it; the page view is not rebuilt between opens; Ctrl+W in the popover closes the popover, not the page underneath; MCP `pages.popoverPage` / `openPopover` / `closePopover` work.
- Fixes during verification: the page-manager root had zero height (popover geometry measured from it never applied) — it now spans the page area; right tabs showed a close icon; the popover edge was too faint over a same-coloured page (halo + deeper shadow added).
- Click-away into a foreign document uses host `focusin` plus an animation-frame `document.activeElement` re-check (no board/webview messages were needed for the iframe case tested). Not yet verified: a browser `<webview>` page underneath.
- Board-side change was folded into BT-046 rather than a new BT task (one paragraph of default instructions).

### 2026-10-24
- Epic created from the investigation of the current tab and page architecture. The user approved
  the plan: one epic, separate from EPIC-131, with a small board-side task in persephone-boards.
