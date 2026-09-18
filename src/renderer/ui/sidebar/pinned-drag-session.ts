import type { PinnedRef } from "./pinned-items";

export const PINNED_DRAG_SESSION_EVENT = "persephone:pinned-drag-session";

export type PinnedDragMode = "pin" | "unpin";

export type PinnedDragSessionDetail =
    | { ref: PinnedRef; mode: PinnedDragMode }
    | { ref: null; mode: null };

let dragEndListener: ((event: Event) => void) | undefined;

export function startPinnedDragSession(ref: PinnedRef, mode: PinnedDragMode): void {
    if (dragEndListener) endPinnedDragSession();

    const listener = (): void => {
        dragEndListener = undefined;
        endPinnedDragSession();
    };
    dragEndListener = listener;
    document.addEventListener("dragend", listener, { capture: true, once: true });
    document.dispatchEvent(new CustomEvent<PinnedDragSessionDetail>(PINNED_DRAG_SESSION_EVENT, {
        detail: { ref, mode },
    }));
}

export function endPinnedDragSession(): void {
    const listener = dragEndListener;
    dragEndListener = undefined;
    if (listener) document.removeEventListener("dragend", listener, true);
    document.dispatchEvent(new CustomEvent<PinnedDragSessionDetail>(PINNED_DRAG_SESSION_EVENT, {
        detail: { ref: null, mode: null },
    }));
}
