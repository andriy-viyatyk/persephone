import { tryParseJson } from "../utils/parse-utils";
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

// ── Host-drag nonce ──────────────────────────────────────────────────────────
// Any drag can carry the trait MIME type: a web page in a browser tab can set it in its own
// `dragstart`, and Chromium hands that drag to the app window when it leaves the page. A trait
// payload is only honoured when this document started the drag: `setTraitDragData` (only ever
// called from a host `dragstart`) stamps a fresh nonce that lives in this document's memory until
// the drag ends. Trait drags therefore work only inside the window where they started; OS file
// drops reach trait targets through the event expando below, not through the MIME type.

let activeDragNonce: string | undefined;
let nonceListenersInstalled = false;
let clearHostDragSource: (() => void) | undefined;

/** Register cleanup for optional host-only drag metadata without importing app components here. */
export function registerHostDragCleanup(cleanup: () => void): void {
    clearHostDragSource = cleanup;
}

function endHostDrag(expectedNonce?: string): void {
    if (expectedNonce && activeDragNonce !== expectedNonce) return;
    activeDragNonce = undefined;
    clearHostDragSource?.();
}

function installNonceListeners(): void {
    if (nonceListenersInstalled) return;
    nonceListenersInstalled = true;
    // Capture phase on the document, so a handler that stops propagation cannot keep the nonce
    // alive. A drop ends it after the drop handlers have run; `pointerdown` ends one whose
    // `dragend` never reached the document (its source element was removed during the drag).
    document.addEventListener("dragend", () => {
        const nonce = activeDragNonce;
        if (nonce) endHostDrag(nonce);
    }, true);
    document.addEventListener("drop", () => {
        const nonce = activeDragNonce;
        if (nonce) setTimeout(() => endHostDrag(nonce), 0);
    }, true);
    document.addEventListener("pointerdown", () => endHostDrag(), true);
}

/** Set trait drag data on a native drag event. Call only from this document's `dragstart`. */
export function setTraitDragData(
    dataTransfer: DataTransfer,
    typeId: TraitTypeId,
    data: unknown,
    effectAllowed: DataTransfer["effectAllowed"] = "move",
): void {
    installNonceListeners();
    activeDragNonce = crypto.randomUUID();
    const payload: TraitDragPayload & { nonce: string } = { typeId, data, nonce: activeDragNonce };
    dataTransfer.setData(MIME_TYPE, JSON.stringify(payload));
    dataTransfer.effectAllowed = effectAllowed;
}

/** Read trait drag data from a native drag event. Returns null if not a trait drag, or if the drag
 *  was not started by this document (see "Host-drag nonce"). */
export function getTraitDragData(dataTransfer: DataTransfer): TraitDragPayload | null {
    if (!activeDragNonce) return null;
    const raw = dataTransfer.getData(MIME_TYPE);
    if (!raw) return null;
    const parsed = tryParseJson<(TraitDragPayload & { nonce?: unknown }) | null>(raw, null);
    if (!parsed || parsed.nonce !== activeDragNonce) return null;
    return { typeId: parsed.typeId, data: parsed.data };
}

/** Check if a drag event carries trait data (for dragover/dragenter): the trait MIME type on a drag
 *  this document started. */
export function hasTraitDragData(dataTransfer: DataTransfer): boolean {
    // Use Array.prototype.indexOf for compat with both string[] and DOMStringList
    return !!activeDragNonce && Array.prototype.indexOf.call(dataTransfer.types, MIME_TYPE) >= 0;
}

/** Resolve TraitSet from registry by typeId. */
export function resolveTraits(typeId: string): TraitSet | undefined {
    return traitRegistry.get(typeId);
}

// ── Visual feedback CSS class helpers ────────────────────────────────────────

/** Prevent default to allow drop. Call from onDragOver and onDragEnter handlers. */
export function allowDrop(e: DragEvent): void {
    // Native drag events carry a data transfer.
    if (hasTraitDragData(e.dataTransfer!)) {
        e.preventDefault();
        e.dataTransfer!.dropEffect = "move";
    }
}

// ── OS file drags + event-expando transport  ──────────────────────────

/** True if the drag carries OS files. During `dragover` only the type is visible
 *  (the file list/paths become readable at `drop`). */
export function isFileDrag(dataTransfer: DataTransfer | null): dataTransfer is DataTransfer {
    if (!dataTransfer) return false;
    return Array.prototype.indexOf.call(dataTransfer.types, "Files") >= 0;
}

/** Droppable as a link/file — an internal trait drag OR an OS file drag. Use from
 *  dragenter/dragover so consumers never read `files` themselves. */
export function isLinkDroppable(dataTransfer: DataTransfer | null): boolean {
    return !!dataTransfer && (hasTraitDragData(dataTransfer) || isFileDrag(dataTransfer));
}

/** Expando key carrying a trait descriptor on the native drop event. Used when the
 *  descriptor can't ride `dataTransfer` (setData is illegal during `drop`, and an
 *  OS-originated drag has no `dragstart`). Safe because a transient DOM event is never
 *  spread, serialized, or Immer-copied — unlike data objects, for which symbol
 *  auto-discovery was rejected (see doc/architecture/trait-system.md). */
const LINK_DROP_DESCRIPTOR = Symbol("persephone-link-drop");

/** Attach a trait descriptor to the native drop event (read back via
 *  getTraitDragDataFromEvent). Carries the same serializable `{ typeId, data }`
 *  payload as the dataTransfer MIME. */
export function setEventTraitDragData(e: DragEvent, payload: TraitDragPayload): void {
    (e as DragEvent & { [LINK_DROP_DESCRIPTOR]?: TraitDragPayload })[LINK_DROP_DESCRIPTOR] = payload;
}

/** Read the trait descriptor from a drop event — the event expando first (set by the
 *  global capture handler for OS files), then the `dataTransfer` MIME. Accepts internal and OS drag events.
 *  The one accessor every drop target uses, so internal trait drags and OS file drags read identically. */
export function getTraitDragDataFromEvent(e: DragEvent): TraitDragPayload | null {
    const fromEvent = (e as { [LINK_DROP_DESCRIPTOR]?: TraitDragPayload })[LINK_DROP_DESCRIPTOR];
    // Native drag events carry a data transfer.
    return fromEvent ?? getTraitDragData(e.dataTransfer!);
}
