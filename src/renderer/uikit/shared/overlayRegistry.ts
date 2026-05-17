// =============================================================================
// Overlay registry — coordinates Tooltip suppression while modal-ish overlays
// (context menus, popovers, dialogs) are open.
// =============================================================================
//
// Anyone rendering an overlay that should suppress page-level tooltips registers
// the overlay's DOM root with the registry on mount and unregisters on unmount.
//
// Tooltips check `isSuppressed(triggerEl)`:
//   - When no overlay is registered → not suppressed (normal behaviour).
//   - When one or more overlays are registered → suppressed unless the trigger
//     is contained in at least one of them. This automatically opts-in tooltips
//     that live inside the overlay's own DOM tree (e.g. tooltips on context-menu
//     items), and opts-out everything else on the page.

type Subscriber = () => void;

const overlays = new Set<HTMLElement>();
const subscribers = new Set<Subscriber>();
let version = 0;

function notify() {
    version++;
    subscribers.forEach((cb) => cb());
}

export const overlayRegistry = {
    /** Register an overlay's DOM root. Tooltips outside this subtree will be suppressed. */
    register(el: HTMLElement): void {
        overlays.add(el);
        notify();
    },

    /** Remove a previously-registered overlay. */
    unregister(el: HTMLElement): void {
        if (overlays.delete(el)) notify();
    },

    /**
     * True iff `trigger` is suppressed by a registered overlay — i.e. at least one
     * overlay is open AND `trigger` is not contained in any of them.
     * Returns `false` (not suppressed) when no overlays are registered.
     */
    isSuppressed(trigger: Element | null | undefined): boolean {
        if (overlays.size === 0) return false;
        if (!trigger) return true;
        for (const overlay of overlays) {
            if (overlay.contains(trigger)) return false;
        }
        return true;
    },

    /** Subscribe to registry changes — returns an unsubscribe function. */
    subscribe(cb: Subscriber): () => void {
        subscribers.add(cb);
        return () => { subscribers.delete(cb); };
    },

    /** Snapshot for `useSyncExternalStore` — monotonic version that changes on every notify. */
    getVersion(): number {
        return version;
    },
};
