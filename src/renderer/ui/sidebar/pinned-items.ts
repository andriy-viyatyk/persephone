import { settings } from "../../api/settings";
import { DEFAULT_PINNED_EDITORS } from "./tools-editors-registry";

/**
 * Unified pinned-item model for the "Tools & Editors" sidebar and the header
 * "add new page" dropdown. A pinned entry is either a built-in editor/tool or a
 * trusted Board — both live in **one ordered list** so they interleave and
 * reorder freely.
 *
 * Persistence reuses the existing `pinned-editors` settings key (`string[]`),
 * overloading its entries — no migration:
 *   - editor → the bare `CreatableItem.id`, e.g. `"script-js"`.
 *   - board  → `"board:" + absoluteRoot`, e.g. `"board:D:\\boards\\dev-clock"`.
 * Editor ids never contain `":"`, so the `board:` prefix is unambiguous.
 */
export type PinnedRef =
    | { kind: "editor"; id: string }
    | { kind: "board"; root: string };

export type PinnedDragData =
    | { kind: "reorder"; index: number; ref: PinnedRef }
    | { kind: "source"; ref: PinnedRef };

const BOARD_PREFIX = "board:";

/** Encode a ref to its stored string in the `pinned-editors` array. */
export function encodePin(ref: PinnedRef): string {
    return ref.kind === "board" ? BOARD_PREFIX + ref.root : ref.id;
}

/** Decode a stored string back into a ref. */
export function decodePin(stored: string): PinnedRef {
    return stored.startsWith(BOARD_PREFIX)
        ? { kind: "board", root: stored.slice(BOARD_PREFIX.length) }
        : { kind: "editor", id: stored };
}

/** Current raw pinned-items array (editor ids + `board:<root>` entries). */
export function getPinnedStrings(): string[] {
    return settings.get("pinned-editors") ?? DEFAULT_PINNED_EDITORS;
}

function setPinnedStrings(items: string[]): void {
    settings.set("pinned-editors", items);
}

/** True iff the ref is currently pinned. */
export function isPinned(ref: PinnedRef): boolean {
    return getPinnedStrings().includes(encodePin(ref));
}

/** Runtime guard for refs carried in serialized drag payloads. */
export function isPinnedRef(value: unknown): value is PinnedRef {
    if (!value || typeof value !== "object") return false;
    const ref = value as { kind?: unknown; id?: unknown; root?: unknown };
    if (ref.kind === "editor") return typeof ref.id === "string" && ref.id.length > 0;
    if (ref.kind === "board") return typeof ref.root === "string" && ref.root.length > 0;
    return false;
}

/** Append a ref to the pinned list if not already present. */
export function addPin(ref: PinnedRef): void {
    const s = encodePin(ref);
    const cur = getPinnedStrings();
    if (!cur.includes(s)) setPinnedStrings([...cur, s]);
}

/** Insert a ref at an indexed position, moving it when it is already pinned. */
export function insertPin(ref: PinnedRef, index: number): void {
    const encoded = encodePin(ref);
    const original = getPinnedStrings();
    const current = [...original];
    const existingIndex = current.indexOf(encoded);

    for (let i = current.length - 1; i >= 0; i--) {
        if (current[i] === encoded) current.splice(i, 1);
    }

    const adjustedIndex = existingIndex >= 0 && existingIndex < index ? index - 1 : index;
    const boundedIndex = Math.max(0, Math.min(adjustedIndex, current.length));
    current.splice(boundedIndex, 0, encoded);
    if (current.length !== original.length || current.some((item, i) => item !== original[i])) {
        setPinnedStrings(current);
    }
}

/** Remove a ref from the pinned list (idempotent). */
export function removePin(ref: PinnedRef): void {
    const s = encodePin(ref);
    setPinnedStrings(getPinnedStrings().filter((x) => x !== s));
}

/** Reorder: move the entry at `dragIndex` to `hoverIndex`. */
export function movePin(dragIndex: number, hoverIndex: number): void {
    const cur = [...getPinnedStrings()];
    const [removed] = cur.splice(dragIndex, 1);
    cur.splice(hoverIndex, 0, removed);
    setPinnedStrings(cur);
}
