# US-371: Browser Accessibility Snapshot

## Goal

Add a `snapshot()` method to the browser scripting API that returns a clean YAML accessibility tree of the page — identical in format to Playwright MCP's `browser_snapshot` tool output. This enables AI agents trained on Playwright MCP to interact with Persephone's browser using the same structured snapshot format, without reading Persephone-specific documentation.

## Background

### CDP Accessibility API

`Accessibility.getFullAXTree` returns the complete accessibility tree as a flat array of nodes. Each node has:
- `nodeId` — unique ID within the tree
- `backendDOMNodeId` — maps back to a DOM node (used as `ref=eN`)
- `role.value` — semantic role (`button`, `textbox`, `heading`, `link`, etc.)
- `name.value` — accessible name (label text, aria-label, etc.)
- `ignored` — whether the node is semantically irrelevant
- `childIds` — child node references for tree reconstruction
- `properties` — additional properties (value, checked, expanded, etc.)

Confirmed working via `CdpSession.send("Accessibility.getFullAXTree")` — returns 400+ nodes for a typical page.

### Playwright MCP `browser_snapshot` output format

Playwright's snapshot returns a YAML-like tree:
```yaml
- heading "Patient Details" [level=2] [ref=e40]
- textbox "Patient Name" [ref=e52]: "John Smith"
- combobox "Status" [ref=e65]: "Active"
- button "Save" [ref=e78]
- button "Cancel" [ref=e82]
- navigation "Main" [ref=e155]
  - link "Home" [ref=e161]
  - link "About" [ref=e165]
- main [ref=e218]
  - paragraph [ref=e206]
  - link "GET STARTED" [ref=e212]
```

Key formatting rules:
- Each line: `{indent}- {role} "{name}" [ref=e{backendDOMNodeId}]`
- Optional value suffix: `: "value"` (for inputs, selects, textareas)
- Optional properties: `[level=2]`, `[checked]`, `[expanded]`, etc.
- Indentation (2 spaces) shows parent-child relationships
- Noise nodes filtered out: `ignored`, `none`, `generic`, `StaticText` (unless standalone)
- `ref=eN` is the element reference used by interaction methods

### Why match Playwright format

AI agents (Claude, Copilot, Cursor) are already trained on Playwright MCP's snapshot format. By producing identical output, Persephone's `browser_snapshot` MCP tool (US-369) works with any AI agent out of the box — zero learning curve. The agent reads the snapshot, identifies `ref=e78` for "Save" button, and sends `browser_click(ref="e78")`.

### Interaction with refs

The `ref=eN` values correspond to `backendDOMNodeId` from CDP. To interact with a ref, we resolve it back to a DOM element:

```typescript
// Resolve backendDOMNodeId → nodeId via DOM.describeNode
const desc = await cdp.send("DOM.describeNode", { backendNodeId: refId });
// Then use DOM.focus, DOM.setAttributeValue, or resolve to a JS object via
// Runtime.evaluate with DOM.resolveNode
```

Alternatively, simpler approach — inject JS that uses `document.querySelector` based on a data attribute or unique path. Or use `DOM.pushNodesByBackendIdsToFrontend` + `DOM.resolveNode` to get a `RemoteObjectId` usable with `Runtime.callFunctionOn`.

For this task, we only build the snapshot. Ref-based interaction (e.g., `click({ ref: "e78" })`) can be added to existing methods in a follow-up.

## Implementation Plan

### Step 1: Add snapshot method to BrowserEditorFacade

**File: `src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts`**

```typescript
/**
 * Get an accessibility snapshot of the page as a YAML-like tree.
 * Format matches Playwright MCP's browser_snapshot output.
 * Each interactive element has a ref (e.g., ref=e52) usable for targeting.
 */
async snapshot(): Promise<string> {
    const cdp = this.cdp();
    const tree = await cdp.send("Accessibility.getFullAXTree");
    return formatAccessibilityTree(tree.nodes || []);
}
```

### Step 2: Implement the tree formatter

**File: `src/renderer/editors/browser/accessibility-snapshot.ts`** (new file)

Converts the flat CDP node array into indented YAML:

```typescript
interface AXNode {
    nodeId: string;
    backendDOMNodeId?: number;
    parentId?: string;
    childIds?: string[];
    ignored?: boolean;
    role?: { value: string };
    name?: { value: string };
    properties?: Array<{ name: string; value: { value: unknown } }>;
}

/** Roles to skip in the snapshot output. */
const SKIP_ROLES = new Set(["none", "generic", "InlineTextBox", "LineBreak"]);

/**
 * Format CDP accessibility tree nodes into a Playwright-compatible
 * YAML snapshot string.
 */
export function formatAccessibilityTree(nodes: AXNode[]): string {
    const map = new Map<string, AXNode>();
    for (const n of nodes) map.set(n.nodeId, n);

    const root = nodes[0];
    if (!root) return "";

    const lines: string[] = [];
    formatNode(root, 0, map, lines);
    return lines.join("\n");
}

function formatNode(
    node: AXNode,
    indent: number,
    map: Map<string, AXNode>,
    lines: string[],
): void {
    if (!node || node.ignored) return;

    const role = node.role?.value || "";

    // Skip non-semantic wrapper nodes — process children at same indent
    if (SKIP_ROLES.has(role) || role === "RootWebArea") {
        for (const id of node.childIds || []) {
            const child = map.get(id);
            if (child) formatNode(child, indent, map, lines);
        }
        return;
    }

    // Skip StaticText if it's a child of a named element (redundant)
    // Keep standalone StaticText (e.g., text not inside a link/button)
    if (role === "StaticText") {
        const parent = node.parentId ? map.get(node.parentId) : undefined;
        if (parent && parent.name?.value) return; // parent already has the text
    }

    // Build the line
    let line = " ".repeat(indent) + "- " + role;

    const name = node.name?.value;
    if (name) line += ` "${name}"`;

    // Add useful properties
    const props = node.properties || [];
    for (const p of props) {
        if (p.name === "level" && p.value.value != null) {
            line += ` [level=${p.value.value}]`;
        }
        if (p.name === "checked" && p.value.value === true) {
            line += " [checked]";
        }
        if (p.name === "expanded" && p.value.value != null) {
            line += p.value.value ? " [expanded]" : " [collapsed]";
        }
        if (p.name === "required" && p.value.value === true) {
            line += " [required]";
        }
        if (p.name === "disabled" && p.value.value === true) {
            line += " [disabled]";
        }
    }

    // Add ref
    if (node.backendDOMNodeId) {
        line += ` [ref=e${node.backendDOMNodeId}]`;
    }

    // Add value (for inputs, selects, textareas)
    const valueProp = props.find(p => p.name === "value");
    if (valueProp?.value?.value != null && String(valueProp.value.value)) {
        line += `: "${valueProp.value.value}"`;
    }

    lines.push(line);

    // Process children with increased indent
    for (const id of node.childIds || []) {
        const child = map.get(id);
        if (child) formatNode(child, indent + 2, map, lines);
    }
}
```

### Step 3: Update type definitions

**File: `src/renderer/api/types/browser-editor.d.ts`** (and `assets/editor-types/browser-editor.d.ts`)

```typescript
/**
 * Get an accessibility snapshot of the page as a YAML-like tree.
 * Format matches Playwright MCP's browser_snapshot output.
 * Each interactive element has a ref (e.g., ref=e52) usable for targeting.
 *
 * @example
 * const snapshot = await browser.snapshot();
 * // Returns:
 * // - heading "Page Title" [level=1] [ref=e40]
 * // - textbox "Search" [ref=e52]
 * // - button "Submit" [ref=e65]
 */
snapshot(): Promise<string>;
```

## Edge Cases

- **Empty page:** Returns empty string.
- **Huge pages (1000+ nodes):** Filtering removes noise nodes significantly. Most pages reduce from 400+ to 50-100 meaningful lines.
- **StaticText deduplication:** Static text nodes whose parent already carries the same text in its `name` are skipped (avoids `- link "Home"\n  - StaticText "Home"` duplication).
- **Iframes:** `Accessibility.getFullAXTree` includes iframe content in the same tree (Chromium merges accessibility trees across frames).
- **Hidden elements:** Chromium's accessibility tree may include or exclude hidden elements depending on `aria-hidden`. We follow whatever CDP returns.

## Files Changed

| File | Change |
|------|--------|
| `src/renderer/editors/browser/accessibility-snapshot.ts` | **New file** — `formatAccessibilityTree()` |
| `src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts` | Add `snapshot()` method |
| `src/renderer/api/types/browser-editor.d.ts` | Add `snapshot()` signature |
| `assets/editor-types/browser-editor.d.ts` | Mirror copy |

## Acceptance Criteria

- [ ] `browser.snapshot()` returns a YAML-like accessibility tree string
- [ ] Output format matches Playwright MCP's `browser_snapshot` style
- [ ] Each interactive element has `[ref=eN]` for future targeting
- [ ] Noise nodes (generic, none, ignored) are filtered out
- [ ] Static text deduplication (no redundant child text when parent has same name)
- [ ] Properties shown: level, checked, expanded, required, disabled
- [ ] Input values shown as `: "value"` suffix
- [ ] Indentation reflects tree hierarchy (2 spaces per level)
- [ ] Works on pages with 400+ accessibility nodes (verified via CDP)
- [ ] Type definitions updated in both source and assets
