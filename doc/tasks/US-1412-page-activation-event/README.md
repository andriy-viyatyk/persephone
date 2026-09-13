# US-1412: Raise an AiVision event when the active page changes

## Goal

Tell an agent, through the event log, when the page it is working with stops being the visible
one — because a backgrounded page has no layout box, so geometry-dependent reads either fail or,
worse, quietly return wrong answers.

## Background

### The gap

`src/renderer/scripting/ai-vision/event-log.ts` produces seven event kinds today:
`shape-changed` (board and browser), `board-reloaded`, `navigated`, `dialog-answered` (native and
Log View), `remote-notify`, `guide-button`. **Nothing fires when the active page changes.** An
agent blocked in `events.wait()` learns nothing when the user switches tabs; it finds out only
when one of its own calls misbehaves.

### Why it matters — verified, not assumed

An inactive page has no rendered rectangle:

- `waitForPageSlot` (`src/renderer/scripting/ai-vision/page-elements.ts:15-33`) polls until the
  page's `[data-name="page-slot"]` has `width > 0 && height > 0`, rejecting after 120 frames with
  "did not become visible".
- Because of that, every page-scoped `createElements` is wired with
  `beforeHighlight: () => activatePageAndWaitForLayout(host.id)` — `page-editor-switches.ts:68`,
  `page-panels.ts:279` and `:324`, `page-compare.ts:95`. The host silently activates the page
  first; otherwise the callout would be drawn over a zero-sized box.
- `namespaces/window-screen.ts:41` already ends an error with "activate the page with
  `pages.showPage(pageId)`, then retry."

So the current model is *fail, or auto-correct after the fact*. Two failure modes are not
corrected:

- **`elements` visibility is geometry-derived**, so on a backgrounded page every control reports
  not-visible. That is a wrong answer, not an error.
- **`window.screen.snapshot()` renders the app window**, which shows the active page. An agent
  that does not know it was switched away from concludes its content disappeared.

### The precedent for noise control

`navigated` is not raised for every browser navigation: `BrowserWebviewModel.ts:234` logs it only
when `hasAiVisionRegisteredTab(internalTabId)` — a tab the agent has actually touched. This task
follows the same principle for pages.

### Where activation happens

`pagesModel.onShow` is sent from every activation path, which makes it the single subscription
point:

| Path | Site |
|---|---|
| Explicit activation (user click, agent `showPage`, keyboard) | `PagesNavigationModel.ts:19` |
| Closing the active page (another becomes active) | `PagesModel.ts:159` |
| Opening/navigating to a page | `PageNavigator.ts:47` |

`PagesQueryModel.activePage` is the last entry of `ordered` (`PagesQueryModel.ts:32-35`), so
"active page changed" is an identity comparison, not a flag.

## Implementation plan

### 1. `src/renderer/scripting/ai-vision/page-attention.ts` (new)

The set of pages the agent has addressed, and the agent-initiated-navigation suppression flag.

```ts
/** Pages the agent has addressed by identity (not merely listed). */
const attended = new Set<string>();
export function markPageAttended(pageId: string | undefined): void;
export function isPageAttended(pageId: string | undefined): boolean;
/** Drop ids for pages that are no longer open; called before each activation check. */
export function prunePageAttention(liveIds: Iterable<string>): void;
/** Run an activation the AGENT initiated; the activation event is suppressed for it. */
export function withAgentNavigation<T>(fn: () => T): T;
export function isAgentNavigating(): boolean;
```

`withAgentNavigation` sets a module flag for the duration of a **synchronous** call.
`pagesModel.showPage` sends `onShow` synchronously (`PagesNavigationModel.ts:19`), so the flag is
read before it clears. Restore it in a `finally`.

### 2. Mark attention where the agent addresses one page

In `src/renderer/scripting/api-wrapper/PageCollectionWrapper.ts` — addressing a *specific* page,
never merely listing `pages`:

- the descriptor's `index` (line 117) — covers `pages[0]` and `pages["id"]`
- `findPage` (line 186)
- `activePage` (line 178), which also backs the `page` global

Listing (`all`, `aiChildren`) must **not** mark, or every page becomes attended on the first
`call pages`.

### 3. Suppress agent-initiated switches

- `PageCollectionWrapper.showPage` (line 346): wrap the `pagesModel.showPage` call in
  `withAgentNavigation(...)`, and `markPageAttended(pageId)`.
- `activatePageAndWaitForLayout` (`page-elements.ts:37-40`): wrap its `pagesModel.showPage(pageId)`
  the same way — this is the highlight auto-activation, which must never look like a user switch.
- `navigatePageTo` marks attention (the agent is working with that page) but needs no suppression.

### 4. `logPageActivated` in `event-log.ts`

```ts
/** Record the active page changing under an agent that was working with one of the two. */
export function logPageActivated(previousPageId: string, activePageId: string): void {
    const hidden = pagePath(previousPageId, "");
    eventLog.push({
        kind: "page-activated",
        path: hidden,
        text: `The user switched the active page to ${pagePath(activePageId, "")}; ${hidden} is `
            + `now hidden, so its elements report not visible and window.screen.snapshot() shows `
            + `the active page. Re-activate it with pages.showPage(${JSON.stringify(previousPageId)}) `
            + `before geometry-dependent reads.`,
    });
}
```

Keep it one line, like every other event.

### 5. Install the watcher

New `installPageActivationEvents()` (co-located with the logger) subscribing to
`pagesModel.onShow`:

1. Read the current active page id; if it equals the remembered one, return (`onShow` can fire
   without a change).
2. `prunePageAttention(live page ids)`.
3. Remember the new id **always** — including when suppressed, or the next genuine switch would
   report a stale "previous" page.
4. Log only when `!isAgentNavigating()` **and** (`isPageAttended(previous)` or
   `isPageAttended(next)`), and only when there was a previous id.

Call it from `src/renderer/index.ts` `mount()`, and dispose the subscription in the teardown
closure it returns, alongside the other views.

### 6. Help text

Add `page-activated` to the events node help (`namespaces/events.ts`) in the same style as the
other kinds, with the one-clause reason: a backgrounded page's geometry-dependent reads are
unreliable.

## Concerns

- **Suppression is per synchronous activation.** If an agent path activates a page
  asynchronously, the flag has cleared by the time `onShow` fires. `openFile`, `addEditorPage` and
  the other page-creating members are exactly that, and they activate the new page.
  **Resolved during implementation** by making the event text attribute nothing: it reports that
  the active page changed and what that costs, never that "the user switched". Saying the user did
  it would be wrong whenever the agent opened a page itself, and the agent needs the consequence
  rather than the culprit. Synchronous agent paths are still suppressed, which removes the
  pointless self-echo from `showPage`, `showNext`/`showPrevious` and highlight auto-activation.
- **`showNext` / `showPrevious` reach `pagesModel.showPage` by another route** and are agent-callable,
  so they need `withAgentNavigation` of their own — found in review, not in the original plan.
- **A closed page is pruned before the check**, so closing an attended page raises an event only if
  the page that becomes active is itself attended. Page closure is a different event class and is
  out of scope here.
- **The attention set is a heuristic**, deliberately. The alternative — logging every switch —
  floods a 200-entry ring when the user clicks through tabs, and echoes the agent's own
  navigation back at it.
- **Grouped pages**: a grouped page shares the active slot with its partner. The event reports the
  `ordered` active page, which is what `pages.activePage` already reports; no special case.
- **Window scope**: `eventLog` is per renderer window and so is `pagesModel`. Switching windows is
  a separate concern and out of scope.

## Acceptance criteria

1. With the agent having read `pages[i]` for page A while A is active, a user switch to page B logs
   one `page-activated` event naming A as hidden and B as active.
2. `pages.showPage(...)` called by the agent logs **no** event, and a subsequent user switch still
   reports the correct previous page.
3. A highlight on a backgrounded page (which auto-activates) logs no event.
4. Switching between two pages the agent has never addressed logs nothing.
5. Closing the active page, when the agent had addressed it or the page that becomes active, logs
   one event.
6. `events.wait()` returns when a qualifying switch happens.
7. `npm run typecheck`, `npm run lint`, `npm run build-prod` pass.

## Files changed

| File | Change |
|---|---|
| `src/renderer/scripting/ai-vision/page-attention.ts` | New: attention set + agent-navigation suppression |
| `src/renderer/scripting/ai-vision/event-log.ts` | `logPageActivated`, kind `page-activated` |
| `src/renderer/scripting/ai-vision/page-activation.ts` | New: `installPageActivationEvents()` watcher |
| `src/renderer/scripting/api-wrapper/PageCollectionWrapper.ts` | Mark attention on `index`/`findPage`/`activePage`/`navigatePageTo`; suppress in `showPage` |
| `src/renderer/scripting/ai-vision/page-elements.ts` | Suppress in `activatePageAndWaitForLayout` |
| `src/renderer/scripting/ai-vision/namespaces/events.ts` | Help text for the new kind |
| `src/renderer/index.ts` | Install and dispose the watcher |
