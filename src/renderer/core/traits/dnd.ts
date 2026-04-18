import { TraitSet } from "./traits";
import { traitRegistry } from "./TraitRegistry";
import type { TraitTypeId } from "./TraitRegistry";

const MIME_TYPE = "application/persephone-trait";

// ── Serialization ────────────────────────────────────────────────────────────

/** Drag payload shape — serialized into dataTransfer. */
export interface TraitDragPayload {
    typeId: string;
    data: unknown;
}

/** Set trait drag data on a native drag event. */
export function setTraitDragData(
    dataTransfer: DataTransfer,
    typeId: TraitTypeId,
    data: unknown,
): void {
    const payload: TraitDragPayload = { typeId, data };
    dataTransfer.setData(MIME_TYPE, JSON.stringify(payload));
    dataTransfer.effectAllowed = "move";
}

/** Read trait drag data from a native drag event. Returns null if not a trait drag. */
export function getTraitDragData(dataTransfer: DataTransfer): TraitDragPayload | null {
    const raw = dataTransfer.getData(MIME_TYPE);
    if (!raw) return null;
    try {
        return JSON.parse(raw) as TraitDragPayload;
    } catch {
        return null;
    }
}

/** Check if a drag event carries trait data (for dragover/dragenter). */
export function hasTraitDragData(dataTransfer: DataTransfer): boolean {
    // Use Array.prototype.indexOf for compat with both string[] and DOMStringList
    return Array.prototype.indexOf.call(dataTransfer.types, MIME_TYPE) >= 0;
}

/** Resolve TraitSet from registry by typeId. */
export function resolveTraits(typeId: string): TraitSet | undefined {
    return traitRegistry.get(typeId);
}

// ── Visual feedback CSS class helpers ────────────────────────────────────────

/** Prevent default to allow drop. Call from onDragOver and onDragEnter handlers. */
export function allowDrop(e: React.DragEvent): void {
    if (hasTraitDragData(e.dataTransfer)) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
    }
}
