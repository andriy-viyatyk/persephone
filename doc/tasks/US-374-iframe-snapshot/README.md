# US-374: Accessibility Snapshot — Include Iframes, Detect Overlays/Popups

## Goal

Extend `browser_snapshot` to include content from iframes (nested frames) and detect modal overlays/popups that may be intercepting user interaction. Currently, the snapshot only captures the main frame's accessibility tree — content inside iframes is invisible to the agent.

## Background

### Current implementation

`automation/commands.ts:57-59`:
```typescript
async function snapshot(target: IBrowserTarget, tabId?: string): Promise<string> {
    const tree = await target.cdp(tabId).send("Accessibility.getFullAXTree");
    return formatAccessibilityTree(tree.nodes || []);
}
```

`Accessibility.getFullAXTree` without a `frameId` parameter returns only the **main frame's** accessibility tree. Iframe elements appear as nodes with role `Iframe` but their content is empty.

### Problem discovered during testing

During US-369 Gmail testing, Google's feedback popup (rendered in an iframe) was invisible in the snapshot. The agent couldn't see or interact with the popup content.

### CDP approaches for iframe access (investigated and tested)

**Approach 1: `getFullAXTree({ frameId })` via `Page.getFrameTree`**
- `Page.getFrameTree` returns frame hierarchy, `getFullAXTree({ frameId })` per frame
- **Limitation:** `Page.getFrameTree` only lists frames in the **original HTML**. Dynamically created iframes (React, SPA, `createElement`) are NOT listed.

**Approach 2: `Target.getTargets()` + `Target.attachToTarget` + `sessionId` (VALIDATED)**
- `Target.getTargets()` → lists ALL iframe targets including JS-created ones
- `Target.attachToTarget({ targetId, flatten: true })` → returns `sessionId`
- `Accessibility.getFullAXTree({}, sessionId)` → gets iframe's AX tree through the session
- Also works: `Runtime.evaluate(expr, sessionId)`, `DOM.resolveNode(params, sessionId)`
- **Requires:** `CdpSession.send(method, params, sessionId)` and main process `debugger.sendCommand(method, params, sessionId)` support (added in US-377)

**Tested successfully on:**
- JS-created cross-origin iframe (Wikipedia embedded in example.com via `createElement`)
- Returned 846 AX nodes with full Wikipedia content (search, navigation, buttons)
- `Runtime.evaluate` confirmed `document.title === "Wikipedia"` in iframe context

### Playwright's approach (for reference)

Playwright uses injected JavaScript per frame context. We use CDP's native `getFullAXTree` per session — simpler, no injected scripts needed, same result.

### Playwright has NO explicit overlay detection

Playwright doesn't detect modals/overlays in the snapshot. Instead:
- At interaction time, uses `elementsFromPoint()` to check what's actually on top
- Visibility filtering via aria-hidden/display:none is implicit in the AX tree

We can adopt a similar lightweight approach: detect common overlay patterns (dialog role, modal attribute, fixed/absolute positioning covering viewport) and add a hint at the top of the snapshot.

### Ref collision problem (from US-377 analysis)

`backendDOMNodeId` is **per-frame** — two different frames can have the same ID. Without frame-scoped refs, `DOM.resolveNode` might resolve the wrong element.

**Solution (decided in US-377):** Use frame-scoped ref prefixes: `e123` for main frame, `f1-e456` for first iframe, `f2-e789` for second iframe. The `parseRef()` function in `ref.ts` already supports frame prefixes.

## Implementation Plan

### Step 1: Discover iframe targets via `Target.getTargets()`

```typescript
// In snapshot.ts

interface IframeTarget {
    targetId: string;
    url: string;
    title: string;
}

async function getIframeTargets(cdp: CdpSession): Promise<IframeTarget[]> {
    const { targetInfos } = await cdp.send("Target.getTargets");
    return targetInfos
        .filter((t: any) => t.type === "iframe")
        .map((t: any) => ({ targetId: t.targetId, url: t.url, title: t.title }));
}
```

### Step 2: Attach to iframe targets and get AX tree per session

```typescript
async function getIframeAXTree(cdp: CdpSession, targetId: string): Promise<{ nodes: AXNode[]; sessionId: string } | null> {
    try {
        // Detach first in case already attached from a previous snapshot
        try { await cdp.send("Target.detachFromTarget", { targetId }); } catch {}
        const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
        const tree = await cdp.send("Accessibility.getFullAXTree", {}, sessionId);
        return { nodes: tree.nodes || [], sessionId };
    } catch {
        // Frame may have been navigated away or destroyed
        return null;
    }
}
```

### Step 3: Format with frame-scoped refs

Update `formatAccessibilityTree` to accept a frame index for ref prefixing:

```typescript
// Main frame: ref=e123
// First iframe: ref=f1-e456
// Second iframe: ref=f2-e789

function formatNode(node, indent, map, lines, framePrefix = ""): void {
    // ... existing logic ...
    if (node.backendDOMNodeId) {
        const ref = framePrefix
            ? `${framePrefix}-e${node.backendDOMNodeId}`
            : `e${node.backendDOMNodeId}`;
        line += ` [ref=${ref}]`;
    }
}
```

### Step 4: Build composite snapshot

Replace the current `snapshot()` function in `commands.ts`:

```typescript
async function snapshot(target: IBrowserTarget, tabId?: string): Promise<string> {
    const cdp = target.cdp(tabId);
    
    // 1. Main frame AX tree
    const mainTree = await cdp.send("Accessibility.getFullAXTree");
    const mainSnapshot = formatAccessibilityTree(mainTree.nodes || [], "");
    
    // 2. Discover iframe targets
    const iframeTargets = await getIframeTargets(cdp);
    if (iframeTargets.length === 0) return mainSnapshot;
    
    // 3. Get AX tree for each iframe via session attachment
    const iframeSnapshots: Array<{ targetId: string; sessionId: string; snapshot: string }> = [];
    for (let i = 0; i < iframeTargets.length; i++) {
        const result = await getIframeAXTree(cdp, iframeTargets[i].targetId);
        if (!result || result.nodes.length <= 2) continue; // Skip empty/minimal iframes
        
        const framePrefix = `f${i + 1}`;
        const frameSnapshot = formatAccessibilityTree(result.nodes, framePrefix);
        if (frameSnapshot.trim()) {
            iframeSnapshots.push({
                targetId: iframeTargets[i].targetId,
                sessionId: result.sessionId,
                snapshot: frameSnapshot,
            });
        }
    }
    
    // 4. Merge: find Iframe placeholder nodes in main snapshot and inject content
    return mergeFrameSnapshots(mainSnapshot, iframeSnapshots, iframeTargets);
}
```

The `mergeFrameSnapshots` function finds lines matching `- Iframe "..." [ref=eN]` in the main snapshot and injects the corresponding iframe content indented below.

### Step 5: Update ref resolution for frame-scoped refs

**Update `ref.ts` `parseRef()` return type:**

```typescript
export interface ParsedRef {
    frameIndex: number | null;  // null = main frame, 1+ = child frame index
    backendNodeId: number;
}

export function parseRef(ref: string): ParsedRef {
    if (ref.includes("-")) {
        const [framePart, nodePart] = ref.split("-");
        const frameIndex = parseInt(framePart.replace(/^f/, ""), 10);
        const backendNodeId = parseInt(nodePart.replace(/^e/, ""), 10);
        if (isNaN(frameIndex) || isNaN(backendNodeId)) {
            throw new Error(`Invalid ref "${ref}". Expected format: f1-e123`);
        }
        return { frameIndex, backendNodeId };
    }
    const backendNodeId = parseInt(ref.replace(/^e/, ""), 10);
    if (isNaN(backendNodeId)) {
        throw new Error(`Invalid ref "${ref}". Expected format: e123`);
    }
    return { frameIndex: null, backendNodeId };
}
```

**Update `resolveRef()` to use sessionId for iframe refs:**

For frame-scoped refs, we need the `sessionId` from snapshot time. Store a map of `frameIndex → sessionId` during snapshot generation. Then `resolveRef()` uses `cdp.send("DOM.resolveNode", { backendNodeId }, sessionId)`.

```typescript
/** Map from frame index to CDP sessionId — populated during snapshot. */
let frameSessionMap = new Map<number, string>();

export function setFrameSessions(map: Map<number, string>): void {
    frameSessionMap = map;
}

export async function resolveRef(cdp: CdpSession, ref: string): Promise<string> {
    const { frameIndex, backendNodeId } = parseRef(ref);
    const sessionId = frameIndex !== null ? frameSessionMap.get(frameIndex) : undefined;
    
    try {
        const { object } = await cdp.send("DOM.resolveNode", { backendNodeId }, sessionId);
        if (!object?.objectId) {
            throw new Error(`Could not resolve ref "${ref}". Re-take the snapshot.`);
        }
        return object.objectId;
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("No node with given id")) {
            throw new Error(`Ref "${ref}" is stale. Re-take the snapshot.`);
        }
        throw err;
    }
}
```

**Update `callOnRef()` to pass sessionId through:**

```typescript
export async function callOnRef(cdp: CdpSession, ref: string, fn: string, returnByValue = false): Promise<any> {
    const { frameIndex } = parseRef(ref);
    const sessionId = frameIndex !== null ? frameSessionMap.get(frameIndex) : undefined;
    const objectId = await resolveRef(cdp, ref);
    
    const result = await cdp.send("Runtime.callFunctionOn", {
        objectId, functionDeclaration: fn, returnByValue, awaitPromise: true,
    }, sessionId);
    // ...
}
```

### Step 6: Detect overlays/popups (lightweight)

Add a hint at the top of the snapshot when a modal/overlay is detected:

```typescript
async function detectOverlay(cdp: CdpSession): Promise<string | null> {
    return await cdp.evaluate(`(() => {
        // Check for modal dialogs
        const dialog = document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]');
        if (dialog) return 'Modal dialog detected: ' + (dialog.getAttribute('aria-label') || 'unnamed');
        
        // Check for elements covering most of the viewport with high z-index
        const viewport = { w: window.innerWidth, h: window.innerHeight };
        const center = document.elementFromPoint(viewport.w / 2, viewport.h / 2);
        if (center) {
            const style = getComputedStyle(center);
            const pos = style.position;
            if ((pos === 'fixed' || pos === 'absolute') && parseInt(style.zIndex) > 1000) {
                const rect = center.getBoundingClientRect();
                if (rect.width > viewport.w * 0.5 && rect.height > viewport.h * 0.5) {
                    return 'Overlay detected: ' + (center.getAttribute('aria-label') || center.className.split(' ')[0] || 'unnamed');
                }
            }
        }
        return null;
    })()`);
}
```

If detected, prepend to snapshot:
```
# Note: Modal dialog detected — interaction may be blocked by overlay
- dialog "Feedback" [ref=e500]:
  - ...
```

## Concerns / Open Questions

### Resolved

1. ~~**Cross-origin iframes**~~ — **Resolved.** `Target.attachToTarget` + `getFullAXTree({}, sessionId)` works for cross-origin iframes. Tested: Wikipedia iframe inside example.com returned 846 AX nodes.

2. ~~**JS-created iframes**~~ — **Resolved.** `Page.getFrameTree` misses them, but `Target.getTargets()` finds all iframe targets including dynamically created ones.

3. ~~**CDP sessionId support**~~ — **Resolved.** Electron's `debugger.sendCommand(method, params, sessionId)` supports session targeting. Added in US-377 (`cdp-service.ts` and `CdpSession.send()`).

### Open

4. **Performance**: Each iframe requires `attachToTarget` + `getFullAXTree` — 2 CDP calls. Most pages have 0-3 iframes. Ad-heavy pages (BBC had 12 frames) could be slow. Consider skipping `about:blank` and minimal (≤2 node) iframes.

5. **Iframe placeholder matching**: Main frame AX tree shows `Iframe` role nodes. Need to match these to iframe targets to inject content at the correct indentation. Matching strategy: compare `Iframe` node's `backendDOMNodeId` with iframe `<iframe>` elements' `targetId` from `Target.getTargets()`.

6. **`parseRef()` backward compatibility**: Return type changes from `number` to `ParsedRef`. Update `resolveRef()` and `callOnRef()` simultaneously. Also update `input.ts` `focusElementByRef()` and `fillInput()` which call `parseRef()` indirectly via `callOnRef()`.

7. **Session lifecycle**: `Target.attachToTarget` sessions must be managed — detach when done, or reuse across operations. Stale sessions (after iframe navigation) need cleanup.

8. **`webview.insertText()` in iframe context**: For `browser_type` on iframe elements, `webview.insertText()` inserts at the focused element. If the iframe element is focused (via CDP `Runtime.callFunctionOn` with sessionId), `insertText()` should work — but needs testing.

## Acceptance Criteria

- [ ] `browser_snapshot` includes content from iframes (indented under iframe placeholder)
- [ ] Iframe refs use frame-scoped prefixes (`f1-e123`)
- [ ] `browser_click(ref="f1-e123")` works — resolves in correct frame context
- [ ] `browser_type(ref="f1-e123")` works on iframe elements
- [ ] Cross-origin iframes included (tested: Wikipedia, Google Maps)
- [ ] JS-created iframes included (tested: `createElement` + `appendChild`)
- [ ] Empty/minimal iframes (about:blank, ≤2 nodes) skipped for performance
- [ ] Overlay/popup detection adds a hint line when modal is detected
- [ ] Main-frame-only snapshots (no iframes) still work unchanged
- [ ] Build succeeds

## Files Changed Summary

| File | Change |
|------|--------|
| `src/renderer/automation/snapshot.ts` | Add `getIframeTargets()`, `getIframeAXTree()`, frame-scoped ref prefixes, `mergeFrameSnapshots()` |
| `src/renderer/automation/commands.ts` | Update `snapshot()` to build composite snapshot, add `detectOverlay()` |
| `src/renderer/automation/ref.ts` | Update `parseRef()` → `ParsedRef`, `resolveRef()` uses sessionId, `callOnRef()` passes sessionId, `frameSessionMap` |
| `src/main/cdp-service.ts` | Already updated — `sendCommand(method, params, sessionId)` (done in US-377) |
| `src/renderer/automation/CdpSession.ts` | Already updated — `send(method, params?, sessionId?)` (done in US-377) |

### Files NOT changed

| File | Why |
|------|-----|
| `automation/input.ts` | Uses `callOnRef()` from `ref.ts` — sessionId handled transparently |
| `automation/types.ts` | IBrowserTarget interface unchanged |
| `editors/browser/BrowserTargetModel.ts` | No frame-specific logic needed |
| `main/mcp-http-server.ts` | Tool schemas unchanged |
