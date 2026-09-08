# US-1398: Browser-page shape signal — lazy revalidation and CDP Runtime.addBinding

## Goal

Keep pages[i].editor.app correct when a browser page changes its AiVision model without navigating,
and surface page-authored refresh() / notify() signals through the EPIC-099 event log. Lazy version
revalidation is the correctness floor; the CDP binding is the signal that makes changes visible.

This task is part of [EPIC-099](../../epics/EPIC-099.md). Its I2 section is a verified live spike,
not a hypothesis to re-spike: Runtime.enable plus Runtime.addBinding works in the running app,
bindingCalled preserves the payload, and the binding survives reload.

## Background

### Existing implementation

US-1397 is implemented in the working tree. The relevant facts are:

- src/renderer/editors/browser/BrowserWebviewModel.ts probes from probeAiVisionOnReady() and the
  did-stop-loading branch. probeAiVision() deduplicates by internalTabId:generation. Its current
  AI_VISION_PROBE returns only JSON.stringify(remote.describe()).
- src/renderer/editors/browser/BrowserEditor.ts stores one BrowserAiVisionRegistration per tab in
  aiVisionByTab. It currently stores internalTabId, shape, generation, and token. The existing
  clearAiVisionRegistration* methods are the document/incarnation boundaries.
- src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts builds .app with createRemoteProxy().
  sendAiVision() checks the active tab, generation, and token before remote.handle(), but an old
  proxy has no same-document shape check. Its proxy token also includes aiVisionBindingVersion,
  which must remain separate from the page-side remote version.
- src/renderer/scripting/api-wrapper/BoardEditorFacade.ts refuses an old board incarnation with
  the actionable message: "This board re-registered its AiVision model (a reload, or a second
  expose()). Read pages[i].editor.app again to pick up the new one." Browser errors should follow
  this pattern while naming the concrete pages["<id>"].editor.app path.
- src/renderer/scripting/ai-vision/event-log.ts owns one EventLog({ cap: 200,
  hostOrigin: "persephone" }). It already has board shape events and a reserved
  logRemoteNotify(text, path?) helper that hardcodes origin: "board".

### Installed ai-vision contract

node_modules/ai-vision/dist/core/remote-proxy.d.ts confirms:

~~~ts
export interface IRemoteProxyOptions {
    readonly revalidate?: () => Promise<boolean | string | undefined>;
}
export declare const STALE_REMOTE_SHAPE_MESSAGE =
    "The remote model's shape changed since this reference was built; read its path again to pick up the new one.";
~~~

createRemoteProxy() calls revalidate before every remote request. true/undefined proceeds, false
fails with STALE_REMOTE_SHAPE_MESSAGE, and a non-empty string fails with that string. Browser
version changes need a path-specific string; use the generic constant only for a genuinely generic
fallback.

node_modules/ai-vision/dist/remote/expose.d.ts and expose.js confirm that IAiVisionRemote.version
starts at 1, refresh() rebuilds the shape, increments version, and emits a shape signal. notify()
emits a notify signal. The default transport calls window[hostSignalName] with JSON.stringify().

The package root declarations in node_modules/ai-vision/dist/core/index.d.ts and
core/events.d.ts export these symbols; the host must not import ai-vision/remote:

~~~ts
export type IAiHostSignal =
    | { readonly type: "shape"; readonly version: number; readonly schemaVersion: number }
    | { readonly type: "notify"; readonly text: string };
export declare const AI_VISION_HOST_SIGNAL = "__aiVisionHostSignal";
~~~

### Probe version result and 1.0.x compatibility

Current:

~~~ts
const AI_VISION_PROBE = "(() => {
    const remote = window.__aiVision;
    return remote ? JSON.stringify(remote.describe()) : null;
})()";
~~~

Planned expression result:

~~~ts
const AI_VISION_PROBE = "(() => {
    const remote = window.__aiVision;
    return remote
        ? JSON.stringify({ shape: remote.describe(), version: remote.version })
        : null;
})()";
~~~

The implementation should retain the actual template-string expression while making this semantic
change. A 1.1.0 page returns a wrapper containing shape and numeric version. A 1.0.x remote has
version undefined, so JSON.stringify omits that property; the host stores version: undefined and
continues to expose the valid shape. The parser must accept the wrapper and a direct
IAiVisionShape fallback, and only store finite numeric versions. The revalidation expression uses
the same one-evaluation version read but wraps it with a presence bit, because a missing remote and
a legacy remote both produce undefined for the bare expression window.__aiVision &&
window.__aiVision.version.

### CDP and browser IPC facts

src/main/cdp-service.ts currently exposes cdpAttach, cdpDetach, and cdpSend through ipcMain.handle.
ensureAttached() attaches wc.debugger at protocol 1.3, tracks the WebContents in a WeakSet, and
only listens for detach. There is no wc.debugger.on("message") path.

src/renderer/automation/CdpSession.ts passes registrationKey to those handlers and forwards an
optional sessionId. src/renderer/editors/browser/BrowserTargetModel.ts constructs browser keys as
model.id/tabId. src/main/browser-service.ts uses the same registrations key
regKey(tabId, internalTabId), and its existing sendEvent() sends BrowserChannel.event
("browser:event") to the owning renderer. BrowserEvent already carries tabId and internalTabId.

EPIC-099 I2 verified that a browser webview is its own WebContents: its bindingCalled sessionId is
"", unlike a board frame's flattened session. ensureAttached() is shared by browser webviews,
board frames, and APP_WINDOW_CDP_KEY, so binding installation must be an explicit browser-only
opt-in. Runtime.consoleAPICalled and Runtime.executionContextCreated emitted by Runtime.enable
must not cross IPC.

There is an intentional install-order race. The binding is installed at probe time, after
did-stop-loading. If a page calls expose() during loading and calls refresh() before the first
probe/binding setup completes, window.__aiVisionHostSignal does not exist yet; expose.ts's
emitSignal() checks for a function and silently does nothing. This is not a defect to move binding
installation earlier: the first probe sees the current shape/version when it runs, and if the
missed signal leaves a cached version stale, layer 1's next-request version evaluation detects it.
The binding is an optimization for visibility, never the source of truth; this race is one reason
both layers ship.

## Implementation Plan

### 1. Record the page-side version at probe time

Change src/renderer/editors/browser/BrowserEditor.ts:

- Add readonly version?: number to BrowserAiVisionRegistration.
- Extend setAiVisionRegistration(internalTabId, generation, shape, version?) and store the value.
- Preserve token generation, touched-tab tracking, and all get/clear/current-generation behavior.

Change src/renderer/editors/browser/BrowserWebviewModel.ts:

- Parse the probe wrapper, validate its shape with isAiVisionShape(), and pass its finite numeric
  version to setAiVisionRegistration(). Accept a direct shape as a legacy/mixed-version fallback.
- Keep the existing 262,144-byte UTF-8 limit, webview/generation race checks, and private-page
  agentMayAccessBrowserPage gate.

Before → after:

~~~ts
// current registration
readonly shape: IAiVisionShape;
readonly generation: number;
readonly token: number;
~~~

~~~ts
// planned registration
readonly shape: IAiVisionShape;
readonly version?: number;
readonly generation: number;
readonly token: number;
~~~

### 2. Add lazy browser-proxy revalidation

Change src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts:

1. Pass revalidate: () => this.revalidateAiVision(registration) to createRemoteProxy().
2. Check agentMayAccessBrowserPage(this.model.state.get()) before CDP work. For a private page,
   return privateBrowserRefusal(state, "call") rather than throwing or evaluating.
3. Check the captured registration's current generation/token and active tab. A stale document
   returns a path-specific refusal.
4. Evaluate once per request with this exact semantic expression:

~~~ts
(() => {
    const remote = window.__aiVision;
    return remote ? { present: true, version: remote.version } : null;
})()
~~~

null means no remote; present true with undefined version is a valid 1.0.x remote. Two undefined
versions proceed. If one side has a version and the values differ, treat the shape as moved.
Catch evaluation failures, including a destroyed webview, and return a clean string.

Use concrete messages such as:

~~~text
The browser page's AiVision model changed; read pages["<id>"].editor.app again to pick up the new one.
The browser page no longer exposes an AiVision model; read pages["<id>"].editor.app again.
The browser page's AiVision document is unavailable; read pages["<id>"].editor.app again.
~~~

Build the path with JSON.stringify(pageId), as the existing sendAiVision() timeout path does.
Only when page identity is unavailable may STALE_REMOTE_SHAPE_MESSAGE be used as a generic
fallback. Use errMessage for any caught diagnostic; never hand-roll error stringification.

When the numeric version moved, refuse the current request immediately and start a background
re-probe. Do not eagerly rebuild the proxy or await describe(). The agent's re-read gets a new
proxy after the new registration is accepted. Add a generation/token-aware seam on
BrowserWebviewModel, for example reprobeAiVision(internalTabId, generation, token), which verifies
the captured registration, calls clearAiVisionRegistrationIfCurrent(), and launches the existing
probeAiVision() for the new generation. The same seam handles a binding signal.

Decision: use strict revalidation, one small Runtime.evaluate per remote request, with no
staleness window. It preserves the correctness floor and avoids choosing a hidden 100–250 ms
stale interval. The normal path must not full-probe or describe the remote.

Require a short comment immediately above/in revalidateAiVision() in the implementation recording
that this deliberate extra Runtime.evaluate is one CDP round trip on every remote request, that a
bounded staleness window was considered and rejected because correctness must not depend on a
signal arriving, and that the binding is only an optimization on top of this source-of-truth
check. A future reader seeing two CDP round trips for a .app call must not remove the check as
accidental duplication.

Before → after:

~~~ts
// current
const value = createRemoteProxy(
    labelPageShape(registration.shape),
    (request) => this.sendAiVision(request, registration),
    { originNote: PAGE_ORIGIN_NOTE },
);
~~~

~~~ts
// planned
const value = createRemoteProxy(
    labelPageShape(registration.shape),
    (request) => this.sendAiVision(request, registration),
    {
        originNote: PAGE_ORIGIN_NOTE,
        revalidate: () => this.revalidateAiVision(registration),
    },
);
~~~

Missing window.__aiVision, privacy refusal, and destroyed webviews must become rejected proxy
requests with clean strings, not throws from revalidation and not calls to remote.handle().

### 3. Install the binding only for an access-gated browser probe

Change src/renderer/automation/CdpSession.ts and src/ipc/browser-ipc.ts to pass a narrow
aiVisionBinding option through the existing cdpAttach invoke. No new command channel is needed.
The only call site is the already-gated browser probe:

~~~ts
const cdp = this.model.target.cdp(internalTabId);
if (!await cdp.attach({ aiVisionBinding: true })) return;
await ensureTargetReady(this.model.target, internalTabId);
serialized = await cdp.evaluate(AI_VISION_PROBE);
~~~

The attach ordering is verified from src/renderer/automation/operations.ts and the browser target:
ensureTargetReady() only calls target.ensureReady?.(tabId), and BrowserTargetModel does not
implement ensureReady(), so it is a no-op for browser tabs. evaluateInTarget() calls
target.cdp(tabId).evaluate(), whose CdpSession.send() reaches cdpSend; cdp-service auto-attaches
there if needed. The new explicit cdp.attach({ aiVisionBinding: true }) therefore does not
double-attach: cdp-service's already-attached check is the no-op fast path, while the binding
option still runs. It must be before the existing no-op readiness call and evaluate so the probe
installs the subscription/binding before any page signal can be emitted after the probe starts.

In src/main/cdp-service.ts, extend cdpAttach to accept that option. Browser keys are the keys not
equal to APP_WINDOW_CDP_KEY and not in boardRegistrations. For an opted-in browser key, call
ensureAttached() and then ensureAiVisionBinding(). The already-attached fast path must also run
ensureAiVisionBinding(), so a prior generic cdpSend auto-attach cannot prevent setup. App and
board paths ignore the option.

ensureAiVisionBinding() must:

- Install wc.debugger.on("message", ...) before Runtime.enable, but only for the opted-in browser
  WebContents.
- Filter in main before any callback or IPC:

~~~ts
if (method !== "Runtime.bindingCalled") return;
if (!params || params.name !== AI_VISION_HOST_SIGNAL) return;
if (typeof params.payload !== "string") return;
onAiVisionSignal(wc, params.payload);
~~~

- Send Runtime.enable, then Runtime.addBinding({ name: AI_VISION_HOST_SIGNAL }). Use WeakSet /
  WeakMap state keyed by WebContents for the handler and in-flight/completed installation, so
  reloads and re-registration do not repeat the work. Re-adding is harmless.
- On debugger detach, remove the message listener and clear installation state so a later attach
  can reinstall. Preserve the existing attachedDebuggers cleanup.

Binding setup is best-effort: an install failure must not remove the lazy version correctness path
or prevent ordinary Runtime.evaluate. Import AI_VISION_HOST_SIGNAL from the ai-vision package root,
not ai-vision/remote.

### 4. Forward the filtered signal through existing BrowserEvent routing

Change src/ipc/browser-ipc.ts:

- Add BrowserEventType "ai-vision-signal".
- Add registrationKey? and payload? to BrowserEventData; payload is page-authored JSON text.

Change src/main/browser-service.ts to pass an onAiVisionSignal(webContents, payload) callback to
initCdpHandlers(). It finds the current registrations entry by exact WebContents identity and uses
the established sendEvent() helper:

~~~ts
sendEvent(
    registration.senderWebContents,
    registration.tabId,
    registration.internalTabId,
    "ai-vision-signal",
    { registrationKey: key, payload },
);
~~~

If the webview is destroyed or no current registration owns it, drop the signal. The renderer
also checks registrationKey equals model.id/internalTabId. This is one existing
BrowserChannel.event event, not a new IPC channel; tabId/internalTabId remain the real route and
the explicit key verifies the CDP registration identity.

### 5. Handle shape and notify signals in the renderer

Change src/renderer/editors/browser/BrowserWebviewModel.ts:

1. Add an ai-vision-signal case. First apply agentMayAccessBrowserPage(), then validate the key,
   current registration, webview, tab, and payload type.
2. Parse page-authored text with tryParseJson<unknown>(payload, undefined) and a type guard for
   IAiHostSignal. Ignore malformed JSON, unknown types, non-finite versions, invalid schema
   versions, and invalid text without throwing.
3. For shape, ignore a version equal to the registration's observed numeric version. For a moved
   version, use the generation/token-safe reprobe seam and log one page-originated
   shape-changed event at the host-computed pages["<id>"].editor.app path. Re-probe in background.
4. For notify, collapse whitespace to one line, trim, ignore empty text, retain at most 512
   characters (first 509 plus ...), and call logRemoteNotify(text, path, "page").

Use an aggregate limiter on BrowserWebviewModel of at most 5 accepted page notifications per
rolling 60,000 ms. It is per renderer window, not per tab, because the EventLog is shared. Five
events per minute bounds a burst to 2.5% of the 200-entry ring and prevents rapid eviction of
host/board/dialog events; ignored notifications do not generate a drop event.

Change src/renderer/scripting/ai-vision/event-log.ts:

- Add a browser/page shape helper, while keeping board shape text and origin: "board".
- Change logRemoteNotify(text, path?) to an origin-aware form with origin: "board" | "page" =
  "board". Preserve whitespace collapsing in the helper and keep the browser length/rate policy
  at the page-signal boundary.

~~~ts
// planned
export function logRemoteNotify(
    text: string,
    path?: string,
    origin: "board" | "page" = "board",
): void;
~~~

The existing US-1399 board producer keeps the default board origin. EventLog then adds its existing
origin attribution suffix to page-authored text.

## Concerns

- A 1.0.x remote has no version and no host callback; undefined/undefined must remain usable, while
  same-document detection is unavailable until that page upgrades.
- Generation, registration token, current webview identity, and tab membership must guard both
  asynchronous probes and late binding signals.
- The binding is per browser WebContents, not document generation: reload keeps it, while detach
  removes its listener and permits reinstall.
- ensureAttached() is shared by browsers, boards, and the app window; only the explicit browser
  probe option may install the binding or forward Runtime events.
- Private pages are gated at probe, binding request, signal handling, and revalidation. Page text
  is untrusted and is bounded, attributed, parsed defensively, and rate-limited.
- Refusing plus background re-probing makes the first stale access deterministic and the agent's
  subsequent re-read successful without waiting for a busy/destroyed page.
- No tests or test harnesses are to be added. Follow direct-import, errMessage, color, and
  file-path standards; this task adds no color or path operations.

## Acceptance Criteria

- [ ] The probe stores a numeric 1.1.0 version with its shape; 1.0.x's omitted version still
      registers and remains usable.
- [ ] Every browser .app request revalidates with one CDP version evaluation and no windowed
      staleness policy.
- [ ] A moved version returns a path-specific pages["<id>"].editor.app error, refuses the request,
      and starts a generation-safe background re-probe; re-read obtains the new proxy.
- [ ] Missing remote, destroyed webview, and private page fail cleanly without a revalidation throw
      or privacy leak.
- [ ] The access-gated browser attach path sends Runtime.enable and Runtime.addBinding with
      "__aiVisionHostSignal" once per WebContents; reload/re-registration do not duplicate setup,
      detach cleans up, and board/app attachments never install it.
- [ ] The implementation comment at revalidateAiVision() records the per-request extra evaluate
      cost, the rejected staleness-window alternative, and that the binding is only an optimization
      rather than the correctness source.
- [ ] The main filter in src/main/cdp-service.ts forwards only Runtime.bindingCalled for the exact
      binding and a string payload; console/context/other CDP events never cross IPC.
- [ ] Existing BrowserChannel.event carries ai-vision-signal with the verified registration key
      and raw payload; stale registrations are dropped.
- [ ] Shape signals re-probe and emit one page-originated shape-changed event at the canonical app
      path. Notify signals emit page-originated remote-notify text, one line, max 512 characters,
      at most 5 accepted messages per rolling minute per renderer.
- [ ] AI_VISION_HOST_SIGNAL and IAiHostSignal come from the ai-vision package root, not remote.
- [ ] No tests, dependency changes, unrelated channels, dashboard changes, or commits are added.

## Files Changed

| File | Planned change |
|---|---|
| src/renderer/editors/browser/BrowserWebviewModel.ts | Version-bearing probe, binding opt-in, safe re-probe seam, signal parsing, shape event, notify bounds/rate limit, and privacy gate. |
| src/renderer/editors/browser/BrowserEditor.ts | Optional observed page version in BrowserAiVisionRegistration and setter. |
| src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts | Browser .app revalidate, version evaluation, path-specific errors, and background re-probe. |
| src/renderer/scripting/ai-vision/event-log.ts | Page shape helper and origin-aware logRemoteNotify with board default. |
| src/renderer/automation/CdpSession.ts | Explicit aiVisionBinding cdpAttach option. |
| src/ipc/browser-ipc.ts | Attach option documentation and ai-vision-signal BrowserEvent fields. |
| src/main/cdp-service.ts | Browser-only Runtime binding, once-per-WebContents tracking, main-side message filter, detach cleanup. |
| src/main/browser-service.ts | Current-WebContents lookup and BrowserChannel.event forwarding callback. |

### Files that need NO changes

| File/area | Reason |
|---|---|
| src/renderer/automation/operations.ts | CdpSession is sufficient; the probe can attach/evaluate directly. |
| src/renderer/editors/browser/BrowserEditorModel.ts | It only re-exports BrowserEditor; registration lives in BrowserEditor.ts. |
| src/renderer/automation/commands.ts | Existing browser-tools privacy routing remains unchanged. |
| src/main/mcp/tools/call-tools.ts | US-1397 already delivers and prefixes the event block. |
| src/renderer/scripting/ai-vision/namespaces/events.ts | US-1397 already exposes event reads and wait. |
| src/main/mcp/renderer-bridge.ts | No bridge timeout change is needed. |
| package.json, package-lock.json | ai-vision ^1.1.0 is already installed. |
| src/renderer/api/events/ | Unrelated EventChannel system. |
| Board registration/CDP shim files | Board refresh/notify remain separate task work; board CDP must not receive this binding. |
| Tests/test harnesses | Explicitly out of scope. |
| doc/active-work.md and doc/epics/EPIC-099.md | Existing dashboard row and epic task table already link US-1398. |
