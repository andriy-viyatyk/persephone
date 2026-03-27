# US-260: EventChannel LIFO

## Status

**Status:** Planned
**Priority:** High
**Epic:** EPIC-012
**Started:** —
**Completed:** —

## Summary

Change `EventChannel.sendAsync()` to execute handlers in LIFO order (newest subscriber runs first) and remove `subscribeDefault()`. This enables the link pipeline's handler priority model: app registers general handlers first during bootstrap, scripts subscribe later and run first.

## Why

- The new link pipeline (EPIC-012) needs LIFO: app registers fallback handlers at bootstrap, scripts subscribe later and override with `event.handled = true`
- `subscribeDefault()` becomes unnecessary — the first-registered handler is naturally the last to run in LIFO order
- Current FIFO order makes scripts run last, which prevents interception

## Background

### Current implementation

[EventChannel.ts](../../../src/renderer/api/events/EventChannel.ts):

- `handlers: EventHandler[]` — array, `subscribe()` pushes to end
- `defaultHandler: EventHandler | null` — single slot via `subscribeDefault()`
- `send(event)` — sync, freezes event, iterates all handlers + defaultHandler in FIFO order
- `sendAsync(event)` — async, iterates handlers in FIFO order, then defaultHandler; short-circuits on `event.handled === true`

### Current sendAsync callers (2 channels)

1. **`fileExplorer.itemContextMenu`** — `FileExplorerModel.tsx:508`. Handlers add menu items to `event.items`. No handler sets `handled`. Order of item addition doesn't matter functionally.
2. **`browser.onBookmark`** — `BrowserBookmarksUIModel.ts:261`. Handlers modify bookmark properties before dialog. No handler sets `handled`. Modification order doesn't matter (last writer wins on each field — same in both FIFO and LIFO).

### Current subscribeDefault callers

**None.** `subscribeDefault` is implemented and exposed in the API but no channel currently uses it. It's wrapped in `AppWrapper.ts` for script cleanup tracking.

### Script API types

[events.d.ts](../../../src/renderer/api/types/events.d.ts) — `IEventChannel<T>` interface exposes both `subscribe()` and `subscribeDefault()` to scripts.

## Acceptance Criteria

- [ ] `sendAsync()` iterates handlers in LIFO order (newest → oldest)
- [ ] `send()` remains FIFO (unchanged) — observe-only events don't need priority
- [ ] `subscribeDefault()` removed from `EventChannel` class
- [ ] `subscribeDefault` removed from `IEventChannel<T>` type definition
- [ ] `subscribeDefault` wrapper removed from `AppWrapper.ts`
- [ ] Existing `itemContextMenu` and `onBookmark` channels work correctly (no behavioral regression)
- [ ] No regressions in existing functionality

## Implementation Plan

### Step 1: Change `sendAsync()` to LIFO

File: `src/renderer/api/events/EventChannel.ts`

Change line 106 from:
```typescript
for (const handler of [...this.handlers]) {
```
to iterate in reverse:
```typescript
for (let i = this.handlers.length - 1; i >= 0; i--) {
    const handler = this.handlers[i];
```

The spread copy `[...this.handlers]` was needed to avoid mutation during iteration. With reverse index iteration, we still need to handle the case where a handler unsubscribes during iteration. Use a snapshot:
```typescript
const snapshot = [...this.handlers];
for (let i = snapshot.length - 1; i >= 0; i--) {
    const handler = snapshot[i];
```

### Step 2: Remove `subscribeDefault()`

File: `src/renderer/api/events/EventChannel.ts`

- Remove `defaultHandler` field (line 28)
- Remove `subscribeDefault` method (lines 65-74)
- Remove `defaultHandler` usage in `send()` (lines 89-95)
- Remove `defaultHandler` usage in `sendAsync()` (lines 119-128)
- Remove `defaultHandler` from `hasSubscribers` getter (line 41)

### Step 3: Update script-facing type definition

File: `src/renderer/api/types/events.d.ts`

Remove from `IEventChannel<T>` interface (line 103):
```typescript
subscribeDefault(handler: (event: T) => void | Promise<void>): ISubscriptionObject;
```

### Step 4: Update AppWrapper

File: `src/renderer/scripting/api-wrapper/AppWrapper.ts`

Remove `subscribeDefault` from `wrapEventChannel()` function (lines 15-19):
```typescript
subscribeDefault(handler: any) {
    const sub = channel.subscribeDefault(handler);
    releaseList.push(() => sub.unsubscribe());
    return sub;
},
```

### Step 5: Update JSDoc comments

File: `src/renderer/api/events/EventChannel.ts`

Update class JSDoc (lines 16-25) to reflect LIFO for sendAsync and removal of subscribeDefault:
```typescript
/**
 * A typed event channel that supports both fire-and-forget and async pipeline patterns.
 *
 * - `send(event)` — sync, freezes the event, all subscribers run in FIFO order (observe-only)
 * - `sendAsync(event)` — async pipeline, subscribers run in LIFO order (newest first),
 *   subscribers can modify the event, short-circuits on `event.handled === true`
 * - `subscribe(handler)` — register a handler (sync or async)
 */
```

## Files to Modify

| File | Change |
|------|--------|
| `src/renderer/api/events/EventChannel.ts` | LIFO for `sendAsync()`, remove `subscribeDefault()`, update JSDoc |
| `src/renderer/api/types/events.d.ts` | Remove `subscribeDefault` from `IEventChannel<T>` |
| `src/renderer/scripting/api-wrapper/AppWrapper.ts` | Remove `subscribeDefault` wrapper |

## Impact Analysis

### No behavioral change for existing channels

Both existing `sendAsync` channels (`itemContextMenu`, `onBookmark`) have handlers that:
- Do NOT set `event.handled` (no short-circuiting)
- Modify event data independently (add menu items, set bookmark fields)
- Order of execution doesn't affect the outcome

Reversing execution order is safe.

### `send()` unchanged

`send()` (fire-and-forget, observe-only) remains FIFO. All handlers run regardless of `handled`. This is correct — observe-only events have no priority concept.

## Related

- Epic: [EPIC-012](../../epics/EPIC-012.md)
- Next task: US-261 (Interfaces & types) — uses EventChannel for link pipeline channels
- Architecture: [EventChannel Enhancement](../../epics/EPIC-012.md#eventchannel-enhancement)
