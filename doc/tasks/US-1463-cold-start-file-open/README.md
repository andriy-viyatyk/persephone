# US-1463 — Cold-start file and URL open

**Status:** Planned · **Epic:** none (deliberately not linked) · **Depends on:** none

## Goal

Confirm and fix the cold-start path in which a file or URL supplied to a new application process
is consumed before the renderer's `openRawLink` subscribers exist. This is a separate task from
the scheme-registry work because it changes startup behavior and is user-visible.

This document is investigation and planning only. It does not implement the fix, alter the
pipeline bootstrap order, or add this task to a dashboard or epic.

## Background

### Diagnosis status

The diagnosis below is from code reading and has **not been confirmed at runtime**. The first
action for the implementer is the exact reproduction in Implementation Plan step 1.

### Verified file-open path

- `src/renderer.ts:16-18` calls `initServices()`, then `initPages()`, then `initEvents()`.
- `src/renderer/api/app.ts:217-220` awaits `pages.init()` inside `initPages()`.
- `src/renderer/api/app.ts:232-242` installs the pipeline subscribers in `initEvents()`; the
  relevant `openRawLink`, `openLink`, and `openContent` registrations are at `:235-241`.
- `src/renderer/api/pages/PagesPersistenceModel.ts:333-350` restores startup inputs. At
  `:340-343`, it calls `getFileToOpen()` and immediately sends `openRawLink` for the returned
  file path. This occurs while `pages.init()` is still running, before `initEvents()`.
- `src/ipc/main/window-handlers.ts:9-17` stores the startup arguments. `getFileToOpen()` at
  `:25-32` reads `argFile` at `:26`, sets it to `undefined` at `:27`, and then returns the path
  only when it passes the existing validity check. The argument is therefore consumed before a
  later subscriber could retry it.
- `src/renderer/api/events/EventChannel.ts:67-73` dispatches `sendAsync()` only to listeners
  present at that time; it has no replay or queue.

Taken together, the source shows a cold-start file event can be sent before any pipeline listener,
while the main-process value has already been cleared. Whether the renderer's surrounding startup
behavior masks this in practice is unverified until the reproduction is run.

### Verified URL-open path

- `getUrlToOpen()` at `src/ipc/main/window-handlers.ts:34-37` reads `argUrl` at `:35`, clears it
  at `:36`, and returns the URL at `:37`.
- `PagesPersistenceModel.ts:345-348` calls `getUrlToOpen()` during the same early restore and
  passes the result to `handleExternalUrl()`.
- `src/renderer/api/pages/PagesLifecycleModel.ts:767-777` implements `handleExternalUrl()` as
  the `openRawLink` path; at `:770-773` it creates link data and calls
  `app.events.openRawLink.sendAsync(data)`.
- `src/renderer/index.ts:19` reaches `windowReady` only after the application initialization
  sequence, so it is not evidence that the early event was queued.

The URL path has the same one-shot argument consumption and no-listener event-dispatch risk as the
file path. It must be reproduced separately; a URL that is handled by another existing-instance
path is not proof that the cold-start path works.

## Implementation Plan

### 1. Confirm the diagnosis before choosing a fix

With no application instance running, cold-start the app with a local file path argument and
observe whether the file opens. Repeat as a separate run with a URL argument and observe whether
the URL opens. Record the exact command-line form, platform behavior, and whether each input opens
once, opens late, or disappears. This runtime confirmation is mandatory because the current
diagnosis is code-reading-only.

### 2. Choose a startup-intent handoff after reproduction

Investigate the smallest fix that preserves existing-instance behavior and one-shot semantics. The
options are:

- **Queue the startup intents until pipeline initialization.** Keep the file and URL values in a
  pending startup-intent queue owned by the process/window handoff, then deliver them after
  `initEvents()` has installed the subscribers. Preserve input ordering and clear each value only
  after delivery is acknowledged.
- **Defer renderer consumption.** Keep the main-process getters from consuming the value until the
  renderer is ready, or move the getter/handling call from `PagesPersistenceModel.init()` to a
  point after `initEvents()`. Verify that this does not cause a second-instance request to be
  delivered twice.
- **Register pipeline listeners earlier.** This would make the early `openRawLink` send observable,
  but it changes bootstrap ordering and is not part of the scheme-registry task. Consider it only
  if the first two options cannot preserve the existing lifecycle.
- **Use an explicit acknowledgement/retry handoff.** The main process can retain the argument until
  the renderer signals readiness and retry delivery once, with a clear exactly-once rule. This is
  more coordination but may fit existing multi-instance routing better.

Do not introduce a provider-missing placeholder, change `createPipeFromDescriptor()`, or fold this
fix into US-1458/US-1459.

### 3. Verify the selected fix through the app

Repeat both cold-start reproductions and verify each input opens exactly once. Also check a startup
with no argument, an invalid or missing file, an already-running instance, and a URL that uses the
existing external-link handling. Confirm that normal page restoration still occurs and that no
duplicate open is produced by a retry, queue, or readiness signal.

## Concerns

1. **The runtime symptom is not yet verified.** The call order, one-shot getters, and non-replaying
   event channel are established by source inspection, but the first implementation action must
   capture the actual cold-start result before changing code.
2. **File and URL arguments are separate paths.** A fix that preserves one may still lose the other;
   both must have an explicit ownership and delivery point.
3. **Argument ownership is one-shot.** Clearing `argFile` or `argUrl` before delivery prevents a
   later retry unless the handoff retains a pending value or has an acknowledgement protocol.
4. **Existing-instance behavior may differ.** The selected fix must not duplicate an argument when
   the application forwards it to an existing window or instance.
5. **Startup-order changes have a wider blast radius.** Moving pipeline installation is a possible
   option only after reproduction and explicit review; it is not an incidental part of the
   registry migration.

## Acceptance Criteria

These are observations someone can make by using the app, consistent with EPIC-105 D8:

- The implementer first records the two cold-start reproductions: one with a local file path and
  one with a URL, with no existing application instance.
- After the selected fix, a cold-start file argument opens the requested file exactly once.
- After the selected fix, a cold-start URL argument reaches the existing external-link behavior
  exactly once.
- A startup with no argument is unchanged, and invalid or missing file arguments retain their
  existing user-visible handling.
- An argument sent while another instance is running is not opened twice and still follows the
  existing instance-routing behavior.
- Normal persisted-page restoration remains intact, and no provider-missing placeholder or
  changed descriptor-construction behavior appears as part of this fix.

## Files that need no changes

- `src/renderer/content/registry.ts`, `src/renderer/content/parsers.ts`, and
  `src/renderer/content/resolvers.ts` — scheme registration and pipeline migration are separate
  work; this task must not use them to hide the startup event loss.
- `doc/active-work.md` and `doc/epics/EPIC-105.md` — explicitly excluded and deliberately not
  linked by this task document.

## Files Changed Summary

| File | Planned implementation change | Changed by this planning task |
|---|---|---|
| `src/ipc/main/window-handlers.ts` | Possible retained-argument or acknowledgement handoff; exact option follows runtime confirmation | No |
| `src/renderer/api/pages/PagesPersistenceModel.ts` | Possible deferred startup delivery or pending-intent consumption | No |
| `src/renderer/api/pages/PagesLifecycleModel.ts` | Possible URL-delivery adjustment only if selected fix requires it | No |
| `src/renderer/api/app.ts` | Only if an explicitly reviewed readiness/initialization handoff needs it; do not move order implicitly | No |
| `src/renderer/api/events/EventChannel.ts` | Possible queue/replay capability only if selected fix requires it | No |
| `src/renderer.ts` | Evidence only; no change is currently prescribed | No |
| `doc/tasks/US-1463-cold-start-file-open/README.md` | This investigation and implementation plan | Yes |
| `doc/active-work.md` | Explicitly excluded | No |
| `doc/epics/EPIC-105.md` | Explicitly excluded | No |
