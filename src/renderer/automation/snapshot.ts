/** Accessibility snapshots for browser automation. */
import type { CdpSession } from "./CdpSession";
import { getRefSessionId, parseRef, setFrameSessions } from "./ref";

interface AXNode {
    nodeId: string;
    backendDOMNodeId?: number;
    parentId?: string;
    childIds?: string[];
    ignored?: boolean;
    role?: { value: string };
    name?: { value: string };
    /** A control's current value (an input's text, a slider's number) — a top-level AXNode
     *  field, not one of `properties`. */
    value?: { value?: unknown };
    properties?: Array<{ name: string; value: { value: unknown } }>;
}

interface TargetInfo {
    targetId: string;
    parentId?: string;
    type?: string;
    url?: string;
}

export interface SnapshotOptions {
    root?: string | { ref: string };
    interactive?: boolean;
    maxNodes?: number;
    maxChars?: number;
    host?: "browser" | "app" | "board";
    prefix?: string;
}

interface RenderedLine {
    text: string;
    node: AXNode;
    depth: number;
    rootable: boolean;
    ref?: string;
}

const DEFAULT_MAX_CHARS = 18_000;
// LayoutTable*: Chromium's roles for presentational (layout-only) tables — wrappers, like generic.
const SKIP_ROLES = new Set([
    "none", "generic", "InlineTextBox", "LineBreak", "RootWebArea", "LayoutTable", "LayoutTableRow", "LayoutTableCell",
]);
const LANDMARK_ROLES = new Set([
    "banner", "complementary", "contentinfo", "main", "navigation", "region", "search", "form",
]);
const ROOTABLE_ROLES = new Set(["dialog", "alertdialog", ...LANDMARK_ROLES]);
const INTERACTIVE_ROLES = new Set([
    "button", "link", "checkbox", "radio", "switch", "textbox", "searchbox", "combobox",
    "option", "slider", "spinbutton", "menuitem", "menuitemcheckbox", "menuitemradio", "tab",
    "treeitem",
]);
const CONTEXT_ROLES = new Set([
    "heading", ...LANDMARK_ROLES, "dialog", "alertdialog", "menu", "menubar", "tablist", "toolbar", "listbox", "Iframe",
]);
// Most often a ref from an older snapshot: apps re-render containers (Gmail swaps the compose
// dialog node when its title changes), so say that first.
const SNAPSHOT_ROOT_HAS_NO_AX_NODE = "snapshot root is not in the current accessibility tree — the element was probably re-rendered; take a new snapshot() and use its fresh ref (or pass a selector for a semantic element)";

/** Build an accessibility snapshot and refresh the frame-ref map for this host. */
export async function buildSnapshot(cdp: CdpSession, options: SnapshotOptions = {}): Promise<string> {
    const host = options.host ?? "browser";
    const requestedMaxChars = options.maxChars;
    const maxChars = Number.isFinite(requestedMaxChars)
        ? Math.max(1, Math.floor(requestedMaxChars as number))
        : DEFAULT_MAX_CHARS;
    let rootSessionId: string | undefined;
    let rootBackendNodeId: number | undefined;
    let rootFramePrefix = "";

    if (options.root !== undefined) {
        if (typeof options.root === "object") {
            const parsed = parseRef(options.root.ref);
            rootBackendNodeId = parsed.backendNodeId;
            rootFramePrefix = parsed.frameIndex === null ? "" : `f${parsed.frameIndex}-`;
            rootSessionId = getRefSessionId(cdp, options.root.ref);
        } else {
            rootBackendNodeId = await resolveSelectorRoot(cdp, options.root);
        }
    }

    const mainTree = await cdp.send("Accessibility.getFullAXTree", {}, rootSessionId);
    const mainNodes = (mainTree.nodes || []) as AXNode[];
    const mainRoot = rootBackendNodeId === undefined
        ? mainNodes[0]
        : mainNodes.find(node => node.backendDOMNodeId === rootBackendNodeId);
    if (rootBackendNodeId !== undefined && !mainRoot) throw new Error(SNAPSHOT_ROOT_HAS_NO_AX_NODE);

    const sessionMap = new Map<number, string>();
    const targetTrees = new Map<string, { target: TargetInfo; sessionId: string; nodes: AXNode[] }>();
    let ownTargetId: string | undefined;
    if (host !== "board" && rootSessionId === undefined && mainRoot) {
        const { ownId, targets } = await getOwnedIframeTargets(cdp, host);
        ownTargetId = ownId;
        for (const target of targets) {
            const attached = await getIframeAXTree(cdp, target.targetId);
            if (!attached) continue;
            targetTrees.set(target.targetId, { target, ...attached });
        }

        const childByParentAndOwner = new Map<string, Map<number, string>>();
        for (const [targetId, tree] of targetTrees) {
            const parentSessionId = tree.target.parentId === ownTargetId
                ? undefined
                : tree.target.parentId ? targetTrees.get(tree.target.parentId)?.sessionId : undefined;
            if (tree.target.parentId !== ownTargetId && !parentSessionId) continue;
            try {
                const frameTree = await cdp.send("Page.getFrameTree", {}, tree.sessionId);
                const childFrameId = frameTree.frameTree?.frame?.id;
                if (!childFrameId) continue;
                // DOM.getDocument must run first to initialize the parent's DOM domain.
                await cdp.send("DOM.getDocument", { depth: 0 }, parentSessionId);
                const owner = await cdp.send("DOM.getFrameOwner", { frameId: childFrameId }, parentSessionId);
                if (owner.backendNodeId) {
                    const parentKey = tree.target.parentId || ownTargetId || "";
                    const owners = childByParentAndOwner.get(parentKey) ?? new Map<number, string>();
                    owners.set(owner.backendNodeId, targetId);
                    childByParentAndOwner.set(parentKey, owners);
                }
            } catch {
                // A detached or unsupported frame is omitted; other owned frames remain usable.
            }
        }
        let frameIndex = 0;
        const buildLines = async (
            nodes: AXNode[], prefix: string, parentKey: string, sessionId?: string, root: AXNode | undefined = nodes[0],
        ): Promise<RenderedLine[]> => {
            if (!root) return [];
            const treeLines: RenderedLine[] = [];
            const pointerIds = await getPointerBackendNodeIds(cdp, nodes, sessionId);
            collectLines(root, nodes, prefix, 0, options.interactive === true, pointerIds, treeLines);
            const owners = childByParentAndOwner.get(parentKey);
            if (!owners) return treeLines;
            for (let lineIndex = 0; lineIndex < treeLines.length; lineIndex++) {
                const line = treeLines[lineIndex];
                if (line.node.role?.value !== "Iframe" || !line.node.backendDOMNodeId) continue;
                const childTargetId = owners.get(line.node.backendDOMNodeId);
                const child = childTargetId ? targetTrees.get(childTargetId) : undefined;
                if (!child || !childTargetId) continue;
                frameIndex++;
                sessionMap.set(frameIndex, child.sessionId);
                const childLines = await buildLines(child.nodes, `f${frameIndex}-`, childTargetId, child.sessionId);
                treeLines.splice(lineIndex + 1, 0, ...childLines.map(childLine => ({
                    ...childLine,
                    depth: childLine.depth + line.depth + 1,
                })));
                lineIndex += childLines.length;
            }
            return treeLines;
        };
        // A scoped snapshot starts at the resolved root, not the document root.
        const lines = await buildLines(mainNodes, "", ownTargetId || "", undefined, mainRoot);
        setFrameSessions(cdp.registrationKey, sessionMap);
        const prefixText = options.prefix ? `${options.prefix}\n` : "";
        return fitSnapshot(lines, prefixText, maxChars, options.maxNodes);
    }
    setFrameSessions(cdp.registrationKey, sessionMap);

    const pointerIds = await getPointerBackendNodeIds(cdp, mainNodes, rootSessionId);
    const mainPrefix = rootFramePrefix;
    const lines: RenderedLine[] = [];
    if (mainRoot) {
        collectLines(mainRoot, mainNodes, mainPrefix, 0, options.interactive === true, pointerIds, lines);
    }

    const prefixText = options.prefix ? `${options.prefix}\n` : "";
    return fitSnapshot(lines, prefixText, maxChars, options.maxNodes);
}

/** Format one AX tree without composite iframe discovery or a result budget. */
export function formatAccessibilityTree(nodes: AXNode[], framePrefix = ""): string {
    const root = nodes[0];
    if (!root) return "";
    const lines: RenderedLine[] = [];
    collectLines(root, nodes, framePrefix, 0, false, new Set(), lines);
    return lines.map(line => line.text).join("\n");
}

async function resolveSelectorRoot(cdp: CdpSession, selector: string): Promise<number> {
    const { root } = await cdp.send("DOM.getDocument", { depth: 0 });
    const { nodeIds } = await cdp.send("DOM.querySelectorAll", { nodeId: root.nodeId, selector });
    const count = (nodeIds || []).length;
    if (count === 0) throw new Error(`snapshot root selector matched no elements: ${selector}`);
    if (count > 1) throw new Error(`snapshot root selector matched ${count} elements: ${selector}`);
    const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector });
    const { node } = await cdp.send("DOM.describeNode", { nodeId });
    if (!node.backendNodeId) throw new Error(`Could not resolve snapshot root selector: ${selector}`);
    return node.backendNodeId;
}

async function getOwnedIframeTargets(
    cdp: CdpSession,
    host: "browser" | "app",
): Promise<{ ownId?: string; targets: TargetInfo[] }> {
    let ownTargetId: string | undefined;
    let targetInfos: TargetInfo[] = [];
    try {
        const current = await cdp.send("Target.getTargetInfo");
        const info = current.targetInfo as TargetInfo | undefined;
        const expectedType = host === "browser" ? "webview" : "page";
        if (info?.targetId && info.type === expectedType) {
            ownTargetId = info.targetId;
        }
    } catch {
        // A host can expose target discovery without identifying its current target.
    }
    try {
        const result = await cdp.send("Target.getTargets");
        targetInfos = (result.targetInfos || []) as TargetInfo[];
        if (!ownTargetId) {
            // Resolve only an unambiguous page matching the URL of this attached host session.
            // Never treat the global target list as the current host when multiple candidates exist.
            const sessionUrl = await cdp.evaluate("document.location.href");
            const expectedType = host === "browser" ? "webview" : "page";
            const candidates = targetInfos.filter(target => target.type === expectedType && target.url === sessionUrl);
            if (candidates.length === 1) ownTargetId = candidates[0].targetId;
        }
        if (!ownTargetId) return { targets: [] };
        const byId = new Map<string, TargetInfo>(targetInfos.map(target => [target.targetId, target]));
        const isOwned = (target: TargetInfo): boolean => {
            let parentId = target.parentId;
            const visited = new Set<string>();
            while (parentId && !visited.has(parentId)) {
                if (parentId === ownTargetId) return true;
                visited.add(parentId);
                const parent = byId.get(parentId);
                if (!parent || (host === "app" && parent.type === "webview")) return false;
                parentId = parent.parentId;
            }
            return false;
        };
        return { ownId: ownTargetId, targets: targetInfos.filter(target => target.type === "iframe" && isOwned(target)) };
    } catch {
        return { ownId: ownTargetId, targets: [] };
    }
}

async function getIframeAXTree(
    cdp: CdpSession,
    targetId: string,
): Promise<{ nodes: AXNode[]; sessionId: string } | null> {
    try {
        try { await cdp.send("Target.detachFromTarget", { targetId }); } catch { /* no previous attachment */ }
        const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
        const tree = await cdp.send("Accessibility.getFullAXTree", {}, sessionId);
        return { nodes: (tree.nodes || []) as AXNode[], sessionId };
    } catch {
        return null;
    }
}

/**
 * Backend ids of the AX tree's nodes whose computed `cursor` is `pointer`. Two batch calls, never
 * one per node: `cursor` is inherited, so a large app has thousands of matching elements. The
 * outermost-only rule is applied by `collectLines` over the AX ancestry.
 */
async function getPointerBackendNodeIds(
    cdp: CdpSession,
    nodes: AXNode[],
    sessionId?: string,
): Promise<Set<number>> {
    const result = new Set<number>();
    const backendIds = nodes
        .map(node => node.backendDOMNodeId)
        .filter((id): id is number => id !== undefined);
    if (!backendIds.length) return result;
    try {
        const { root: documentRoot } = await cdp.send("DOM.getDocument", { depth: 0 }, sessionId);
        await cdp.send("CSS.enable", {}, sessionId);
        const { nodeIds } = await cdp.send("DOM.getNodesForSubtreeByStyle", {
            nodeId: documentRoot.nodeId,
            computedStyles: [{ name: "cursor", value: "pointer" }],
        }, sessionId);
        const pointerNodeIds = new Set<number>(nodeIds || []);
        if (!pointerNodeIds.size) return result;
        const { nodeIds: candidateNodeIds } = await cdp.send("DOM.pushNodesByBackendIdsToFrontend", {
            backendNodeIds: backendIds,
        }, sessionId);
        (candidateNodeIds as number[] || []).forEach((nodeId, index) => {
            if (nodeId && pointerNodeIds.has(nodeId)) result.add(backendIds[index]);
        });
    } catch {
        // The experimental query is optional; snapshots remain useful without pointer markers.
    }
    return result;
}

function collectLines(
    root: AXNode,
    nodes: AXNode[],
    framePrefix: string,
    depth: number,
    interactive: boolean,
    pointerIds: Set<number>,
    lines: RenderedLine[],
): boolean {
    const map = new Map(nodes.map(node => [node.nodeId, node]));
    const included = new Set<string>();
    if (interactive) {
        const includeAncestors = (node: AXNode): void => {
            let current: AXNode | undefined = node;
            while (current) {
                included.add(current.nodeId);
                current = current.parentId ? map.get(current.parentId) : undefined;
            }
        };
        for (const node of nodes) {
            const role = node.role?.value || "";
            const focusable = node.properties?.some(property => property.name === "focusable" && property.value.value === true);
            const pointer = node.backendDOMNodeId !== undefined && pointerIds.has(node.backendDOMNodeId);
            if (focusable || INTERACTIVE_ROLES.has(role) || CONTEXT_ROLES.has(role) || pointer) includeAncestors(node);
        }
    }

    // `underPointer`: inside a [cursor=pointer] line, whose name already carries the text.
    const visit = (node: AXNode, currentDepth: number, underPointer = false): boolean => {
        const role = node.role?.value || "";
        const pointerCandidate = node.backendDOMNodeId !== undefined
            && pointerIds.has(node.backendDOMNodeId)
            && !hasPointerAncestor(node, map, pointerIds)
            && !hasSemanticInteractiveAncestor(node, map);
        const isPointer = pointerCandidate && role === "generic";
        const focusable = node.properties?.some(property => property.name === "focusable" && property.value.value === true);
        // Wrapper roles pass through to their children BEFORE the ignored check: Chromium marks
        // wrappers such as <html>/<body> ignored, and their subtrees hold the whole page.
        if (SKIP_ROLES.has(role) && !(role === "generic" && isPointer)) {
            let kept = false;
            for (const childId of node.childIds || []) {
                const child = map.get(childId);
                if (child) kept = visit(child, currentDepth, underPointer) || kept;
            }
            return kept;
        }
        if (node.ignored || (interactive && !included.has(node.nodeId))) return false;
        if (interactive && (role === "gridcell" || role === "row") && !focusable && !pointerCandidate) return false;
        if (role === "StaticText" && (underPointer || hasNamedSemanticAncestor(node, map))) return false;
        const line = formatNode(node, currentDepth, framePrefix, isPointer, map);
        const record: RenderedLine = {
            text: line,
            node,
            depth: currentDepth,
            rootable: ROOTABLE_ROLES.has(role),
            ref: node.backendDOMNodeId ? `${framePrefix}e${node.backendDOMNodeId}` : undefined,
        };
        const previousLength = lines.length;
        lines.push(record);
        let childKept = false;
        for (const childId of node.childIds || []) {
            const child = map.get(childId);
            if (child) childKept = visit(child, currentDepth + 1, underPointer || isPointer) || childKept;
        }
        if (interactive && !childKept && !focusable && !INTERACTIVE_ROLES.has(role)
            && !CONTEXT_ROLES.has(role) && !isPointer) {
            lines.splice(previousLength, lines.length - previousLength);
            return false;
        }
        return true;
    };
    return visit(root, depth);
}

function hasSemanticInteractiveAncestor(node: AXNode, map: Map<string, AXNode>): boolean {
    let parent = node.parentId ? map.get(node.parentId) : undefined;
    while (parent) {
        if (INTERACTIVE_ROLES.has(parent.role?.value || "")) return true;
        parent = parent.parentId ? map.get(parent.parentId) : undefined;
    }
    return false;
}

function hasPointerAncestor(node: AXNode, map: Map<string, AXNode>, pointerIds: Set<number>): boolean {
    let parent = node.parentId ? map.get(node.parentId) : undefined;
    while (parent) {
        if (parent.backendDOMNodeId !== undefined && pointerIds.has(parent.backendDOMNodeId)) return true;
        parent = parent.parentId ? map.get(parent.parentId) : undefined;
    }
    return false;
}

function hasValue(node: AXNode): boolean {
    const value = node.value?.value;
    return value != null && String(value) !== "";
}

function hasNamedSemanticAncestor(node: AXNode, map: Map<string, AXNode>): boolean {
    let parent = node.parentId ? map.get(node.parentId) : undefined;
    while (parent) {
        const role = parent.role?.value || "";
        // A field's value already carries its text (a textbox's inner StaticText repeats it).
        if (!SKIP_ROLES.has(role) && !parent.ignored) return Boolean(parent.name?.value) || hasValue(parent);
        parent = parent.parentId ? map.get(parent.parentId) : undefined;
    }
    return false;
}

function formatNode(
    node: AXNode,
    depth: number,
    framePrefix: string,
    pointer: boolean,
    map: Map<string, AXNode>,
): string {
    const role = node.role?.value || "generic";
    const name = pointer ? descendantStaticText(node, map) || node.name?.value : node.name?.value;
    let line = `${"  ".repeat(depth)}- ${role}`;
    if (name) line += ` ${JSON.stringify(pointer ? name.slice(0, 80) : name)}`;
    for (const property of node.properties || []) {
        const value = property.value?.value;
        if (property.name === "level" && value != null) line += ` [level=${escapeInline(String(value))}]`;
        if (property.name === "checked" && value === true) line += " [checked]";
        if (property.name === "expanded" && value != null) line += value ? " [expanded]" : " [collapsed]";
        if (property.name === "required" && value === true) line += " [required]";
        if (property.name === "disabled" && value === true) line += " [disabled]";
    }
    if (pointer) line += " [cursor=pointer]";
    if (node.backendDOMNodeId) line += ` [ref=${framePrefix}e${node.backendDOMNodeId}]`;
    const value = node.value?.value ?? node.properties?.find(property => property.name === "value")?.value?.value;
    if (value != null && String(value)) line += `: ${JSON.stringify(String(value))}`;
    return line;
}

function descendantStaticText(node: AXNode, nodes: Map<string, AXNode>): string {
    const texts: string[] = [];
    const walk = (current: AXNode): void => {
        if (current.role?.value === "StaticText" && current.name?.value) texts.push(current.name.value);
        for (const childId of current.childIds || []) {
            const child = nodes.get(childId);
            if (child) walk(child);
        }
    };
    walk(node);
    return texts.join(" ").trim() || node.name?.value || "";
}

function escapeInline(value: string): string {
    return JSON.stringify(value).slice(1, -1);
}

function fitSnapshot(
    lines: RenderedLine[],
    prefix: string,
    maxChars: number,
    maxNodes?: number,
): string {
    // Track the body length incrementally: re-joining every line per step is quadratic, and a
    // large app (Gmail) renders thousands of lines.
    const nodeLimit = maxNodes == null ? Number.POSITIVE_INFINITY : Math.max(0, maxNodes);
    let count = 0;
    let bodyLength = 0;
    let truncatedBy: "chars" | "nodes" | undefined;
    for (; count < lines.length; count++) {
        if (count >= nodeLimit) { truncatedBy = "nodes"; break; }
        const next = bodyLength + (count ? 1 : 0) + lines[count].text.length;
        if (prefix.length + next > maxChars) { truncatedBy = "chars"; break; }
        bodyLength = next;
    }
    if (!truncatedBy) return prefix + lines.map(line => line.text).join("\n");

    // Shortened: drop lines from the end until the hint (which lists the omitted rootable
    // containers, so it grows as lines are dropped) fits after the body.
    const hintFor = (kept: number) => makeHint(maxChars, truncatedBy as "chars" | "nodes",
        collectOmittedRootables(lines.slice(kept), lines.slice(0, kept)), maxNodes);
    let hint = hintFor(count);
    while (count > 0 && prefix.length + bodyLength + 1 + hint.length > maxChars) {
        count--;
        bodyLength -= lines[count].text.length + (count ? 1 : 0);
        hint = hintFor(count);
    }
    const body = lines.slice(0, count).map(line => line.text).join("\n");
    return `${prefix}${body}${body ? "\n" : ""}${hint}`.slice(0, maxChars);
}

function collectOmittedRootables(lines: RenderedLine[], selected: RenderedLine[]): string[] {
    const selectedIds = new Set(selected.map(line => line.node.nodeId));
    return lines.filter(line => line.rootable && !selectedIds.has(line.node.nodeId))
        .slice(0, 10)
        .map(line => {
            const role = line.node.role?.value || "";
            const name = line.node.name?.value?.slice(0, 80);
            const ref = line.ref ? ` [ref=${line.ref}]` : "";
            return `${role}${name ? ` ${JSON.stringify(name)}` : ""}${ref}`;
        });
}

function makeHint(maxChars: number, reason: "chars" | "nodes", omitted: string[], maxNodes?: number): string {
    const limit = reason === "nodes" ? `node limit ${maxNodes}` : `${maxChars} chars`;
    const roots = omitted.length ? ` Not shown: ${omitted.join(", ")}.` : "";
    return `# Shortened at ${limit}.${roots} Pass root: { ref } or interactive: true.`;
}

/** Detect modal overlays/popups that may block interaction. */
export async function detectOverlay(cdp: CdpSession): Promise<string | null> {
    return await cdp.evaluate(`(() => {
        const dialog = document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]');
        if (dialog) return 'Modal dialog detected: ' + (dialog.getAttribute('aria-label') || 'unnamed');
        const vw = window.innerWidth, vh = window.innerHeight;
        const center = document.elementFromPoint(vw / 2, vh / 2);
        if (center) {
            const s = getComputedStyle(center);
            if ((s.position === 'fixed' || s.position === 'absolute') && parseInt(s.zIndex) > 1000) {
                const r = center.getBoundingClientRect();
                if (r.width > vw * 0.5 && r.height > vh * 0.5) {
                    return 'Overlay detected: ' + (center.getAttribute('aria-label') || center.className?.split(' ')[0] || 'unnamed');
                }
            }
        }
        return null;
    })()`);
}
