const OVERLAY_LAYER_ID = "persephone-overlay-layer";

let overlayLayer: HTMLDivElement | undefined;

/**
 * Return the one shared DOM host for global overlays in this renderer document.
 *
 * The host intentionally has no styling. Its children own their positioning and
 * stacking behavior, and the host remains available for future native views.
 */
export function getOverlayLayer(): HTMLDivElement {
    if (
        overlayLayer &&
        overlayLayer.ownerDocument === document &&
        overlayLayer.isConnected
    ) {
        return overlayLayer;
    }

    const existing = document.getElementById(OVERLAY_LAYER_ID);
    if (existing) {
        if (!(existing instanceof HTMLDivElement)) {
            throw new Error(`Overlay layer must be a div: #${OVERLAY_LAYER_ID}`);
        }
        overlayLayer = existing;
        return existing;
    }

    const layer = document.createElement("div");
    layer.id = OVERLAY_LAYER_ID;
    layer.dataset.type = "overlay-layer";
    document.body.appendChild(layer);
    overlayLayer = layer;
    return layer;
}

/**
 * Announce a pointer press this document cannot see, so open overlays dismiss.
 *
 * A press inside a separate frame — the browser editor's `<webview>` guest, a board's
 * cross-origin iframe, or the HTML viewer's sandboxed iframe — fires no `pointerdown` here,
 * so `PopoverView`'s outside-click
 * listener never runs. A menu therefore stayed open over the very content the user was
 * clicking, and in the browser editor the guest covers nearly the whole page, leaving almost
 * nowhere to click to dismiss it. Each frame reports its own presses (the webview preload
 * sends `guest-pointerdown`; the board shim posts `board:interact`; the HTML viewer's
 * injected script posts `html:interact`) and this replays the outside-click those listeners
 * are waiting for.
 *
 * `pointerdown` specifically, and this is the part that rotted: dismissal used to be
 * `mousedown`, so the HTML viewer's ping dispatched one. `PopoverView` moved to `pointerdown`
 * — deliberately, because `mousedown` is a compatibility event a drag gesture may suppress
 * (see the note in `PopoverFloatingView.onMount`) — which left the ping firing an event
 * nothing listens for any more.
 *
 * The pressed frame's own element is the target. It is outside every menu popover, so those
 * dismiss exactly as before; the right-pinned page popover (`PagesView`) also listens on the
 * document and needs the real location, because a press in a frame *inside* that popover must
 * keep it open while one in the work page behind it closes it. `document.body` — the old
 * target — sits outside the app root, which that listener deliberately ignores, so presses in
 * a browser, board, or HTML viewer frame never closed the page popover.
 */
export function dismissOverlays(frame: Element): void {
    frame.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
}
