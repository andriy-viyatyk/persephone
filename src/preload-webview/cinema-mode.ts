type CinemaKind = "video" | "iframe";
type CinemaMessageType = "enter" | "exit";

interface CinemaMessage {
    namespace: "persephone:cinema";
    version: 1;
    type: CinemaMessageType;
    sessionId: string;
}

interface SavedElementStyle {
    element: HTMLElement;
    cssText: string;
}

interface SavedSiblingVisibility {
    element: HTMLElement;
    visibility: string;
    priority: string;
}

interface CinemaState {
    target: HTMLVideoElement | HTMLIFrameElement;
    kind: CinemaKind;
    sessionId: string;
    originalOverflow: string;
    originalOverflowPriority: string;
    originalActiveMarker: string | undefined;
    expandedElements: SavedElementStyle[];
    hiddenSiblings: SavedSiblingVisibility[];
    backdrop: HTMLElement;
    button: HTMLElement | null;
    childFrame: HTMLIFrameElement | null;
    childWindow: Window | null;
    childSessionId: string | null;
    controlsObserver: MutationObserver | null;
    originalControls: boolean | null;
    videoResizeHandler: (() => void) | null;
    videoFillTimer: ReturnType<typeof setTimeout> | null;
    /** The video's inline style before the fill fallback restyled it; null when untouched. */
    originalVideoStyle: string | null;
    /** A video inside a same-origin child frame that runs no runtime of its own (see
     *  assistedVideoAtPoint), expanded by this frame on the child's behalf. */
    assistedVideo: HTMLVideoElement | null;
    assistedKeyHandler: ((event: KeyboardEvent) => void) | null;
    styleObserver: MutationObserver | null;
    lifecycleObserver: MutationObserver | null;
    childLoadHandler: (() => void) | null;
    writingStyles: boolean;
}

const MESSAGE_NAMESPACE = "persephone:cinema";
const MAX_SESSION_ID_LENGTH = 128;
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const VIEWPORT_STYLE: ReadonlyArray<readonly [string, string]> = [
    ["position", "fixed"],
    ["top", "0"],
    ["left", "0"],
    ["width", "100vw"],
    ["height", "100vh"],
    ["max-width", "none"],
    ["max-height", "none"],
    ["margin", "0"],
    ["padding", "0"],
    ["border-style", "none"],
    ["z-index", "2147483646"],
    ["overflow", "visible"],
];

/** Wait for the site's own resize handling before deciding the video needs filling. */
const VIDEO_FILL_CHECK_DELAY_MS = 300;
/** A video already spanning this share of the viewport width or height counts as filled. */
const VIDEO_FILL_RATIO = 0.9;
const VIDEO_FILL_STYLE: ReadonlyArray<readonly [string, string]> = [
    ["position", "fixed"],
    ["top", "0"],
    ["left", "0"],
    ["width", "100vw"],
    ["height", "100vh"],
    ["max-width", "none"],
    ["max-height", "none"],
    ["margin", "0"],
    ["object-fit", "contain"],
    ["background", "black"],
    ["z-index", "2147483647"],
];
/** Set on <html> once this runtime manages a document; a parent frame looks for it. */
const RUNTIME_MARKER = "data-persephone-cinema";

let activeState: CinemaState | null = null;
let cinemaButton: HTMLElement | null = null;
let cinemaButtonTarget: HTMLVideoElement | null = null;
let cinemaButtonFrame: HTMLIFrameElement | null = null;
const attachedVideos = new Set<HTMLVideoElement>();
let cinemaButtonScrollHandler: (() => void) | null = null;
let installed = false;

const EXPAND_PATH = "M3 3h7v2H5v5H3V3zm11 0h7v7h-2V5h-5V3zM3 14h2v5h5v2H3v-7zm18 0v7h-7v-2h5v-5h2z";
const COLLAPSE_PATH = "M10 3v4H5v2h7V3h-2zm4 0v6h7V7h-5V3h-2zM5 15h5v6h-2v-4H5v-2zm14 0h-5v6h2v-4h5v-2z";

function composedParent(element: HTMLElement): HTMLElement | null {
    if (element.parentElement) return element.parentElement;
    const root = element.getRootNode();
    return root instanceof ShadowRoot && root.host instanceof HTMLElement ? root.host : null;
}

function makeMessage(type: CinemaMessageType, sessionId: string): CinemaMessage {
    return { namespace: MESSAGE_NAMESPACE, version: 1, type, sessionId };
}

function parseMessage(value: unknown): CinemaMessage | null {
    if (!value || typeof value !== "object") return null;
    const message = value as Partial<CinemaMessage>;
    if (message.namespace !== MESSAGE_NAMESPACE || message.version !== 1) return null;
    if (message.type !== "enter" && message.type !== "exit") return null;
    if (typeof message.sessionId !== "string" || message.sessionId.length === 0 || message.sessionId.length > MAX_SESSION_ID_LENGTH) return null;
    return message as CinemaMessage;
}

function createSessionId(): string {
    if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function sendToParent(message: CinemaMessage): void {
    if (window.parent !== window) window.parent.postMessage(message, "*");
}

function sendToChild(state: CinemaState, type: CinemaMessageType): void {
    if (state.childWindow && state.childSessionId) {
        state.childWindow.postMessage(makeMessage(type, state.childSessionId), "*");
    }
}

function createSvgIcon(pathData: string): SVGSVGElement {
    const svg = document.createElementNS(SVG_NAMESPACE, "svg");
    svg.setAttribute("width", "18");
    svg.setAttribute("height", "18");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "white");
    const path = document.createElementNS(SVG_NAMESPACE, "path");
    path.setAttribute("d", pathData);
    svg.appendChild(path);
    return svg;
}

function isDecorativeVideo(video: HTMLVideoElement): boolean {
    const rect = video.getBoundingClientRect();
    return rect.width < 100 || rect.height < 50 || (video.autoplay && video.muted && video.loop);
}

function setViewportStyles(state: CinemaState, elements: HTMLElement[]): void {
    state.writingStyles = true;
    for (const element of elements) {
        for (const [property, value] of VIEWPORT_STYLE) {
            if (element.style.getPropertyValue(property) !== value || element.style.getPropertyPriority(property) !== "important") {
                element.style.setProperty(property, value, "important");
            }
        }
    }
    state.styleObserver?.takeRecords();
    state.writingStyles = false;
}

function expandLocalTarget(target: HTMLVideoElement | HTMLIFrameElement, kind: CinemaKind, sessionId: string): CinemaState {
    const expandedElements: SavedElementStyle[] = [];
    const elementsToExpand: HTMLElement[] = [];
    if (kind === "iframe") elementsToExpand.push(target);
    let ancestor = composedParent(target);
    while (ancestor && ancestor !== document.documentElement) {
        elementsToExpand.push(ancestor);
        ancestor = composedParent(ancestor);
    }

    for (const element of elementsToExpand) expandedElements.push({ element, cssText: element.style.cssText });
    const hiddenSiblings: SavedSiblingVisibility[] = [];
    let current: HTMLElement | null = target;
    while (current && current !== document.documentElement) {
        const parent = current.parentNode;
        if (parent) {
            for (const child of Array.from(parent.childNodes)) {
                if (child === current || !(child instanceof HTMLElement) || child === cinemaButton) continue;
                hiddenSiblings.push({ element: child, visibility: child.style.getPropertyValue("visibility"), priority: child.style.getPropertyPriority("visibility") });
                child.style.setProperty("visibility", "hidden", "important");
            }
        }
        current = composedParent(current);
    }

    const root = document.documentElement;
    const state: CinemaState = {
        target,
        kind,
        sessionId,
        originalOverflow: root.style.getPropertyValue("overflow"),
        originalOverflowPriority: root.style.getPropertyPriority("overflow"),
        originalActiveMarker: root.getAttribute("data-cinema-active") ?? undefined,
        expandedElements,
        hiddenSiblings,
        backdrop: document.createElement("div"),
        button: null,
        childFrame: null,
        childWindow: null,
        childSessionId: null,
        controlsObserver: null,
        originalControls: null,
        videoResizeHandler: null,
        videoFillTimer: null,
        originalVideoStyle: null,
        assistedVideo: null,
        assistedKeyHandler: null,
        styleObserver: null,
        lifecycleObserver: null,
        childLoadHandler: null,
        writingStyles: false,
    };
    activeState = state;
    setViewportStyles(state, elementsToExpand);

    if (kind === "iframe") {
        state.styleObserver = new MutationObserver(() => {
            if (!state.writingStyles && activeState === state) setViewportStyles(state, elementsToExpand);
        });
        for (const element of elementsToExpand) state.styleObserver.observe(element, { attributes: true, attributeFilter: ["style"] });
    }

    state.backdrop.style.cssText = "position:fixed;top:0;left:0;width:100vw;height:100vh;background:black;z-index:2147483645;";
    // Outside <body>: the expanded body is its own stacking context, so a backdrop inside it
    // would cover a video that sits directly in <body> without positioning.
    document.documentElement.appendChild(state.backdrop);
    root.dataset.cinemaActive = "1";
    root.style.setProperty("overflow", "hidden");
    window.dispatchEvent(new Event("resize"));
    return state;
}

function cleanupButtonScroll(): void {
    if (!cinemaButtonScrollHandler) return;
    window.removeEventListener("scroll", cinemaButtonScrollHandler, true);
    cinemaButtonScrollHandler = null;
}

function restoreLocalState(state: CinemaState): void {
    state.lifecycleObserver?.disconnect();
    state.lifecycleObserver = null;
    if (state.childFrame && state.childLoadHandler) state.childFrame.removeEventListener("load", state.childLoadHandler);
    state.childLoadHandler = null;
    state.styleObserver?.disconnect();
    state.styleObserver = null;
    state.controlsObserver?.disconnect();
    state.controlsObserver = null;
    if (state.videoResizeHandler) window.removeEventListener("resize", state.videoResizeHandler);
    state.videoResizeHandler = null;
    if (state.videoFillTimer) clearTimeout(state.videoFillTimer);
    state.videoFillTimer = null;
    if (state.kind === "video" && state.target instanceof HTMLVideoElement && state.originalControls !== null) {
        state.target.controls = state.originalControls;
    }
    if (state.assistedVideo) {
        if (state.originalVideoStyle !== null) state.assistedVideo.style.cssText = state.originalVideoStyle;
        if (state.originalControls !== null) state.assistedVideo.controls = state.originalControls;
        if (state.assistedKeyHandler) state.assistedVideo.ownerDocument.removeEventListener("keydown", state.assistedKeyHandler, true);
        state.assistedKeyHandler = null;
    } else if (state.originalVideoStyle !== null) state.target.style.cssText = state.originalVideoStyle;

    for (let index = state.expandedElements.length - 1; index >= 0; index--) {
        const saved = state.expandedElements[index];
        saved.element.style.cssText = saved.cssText;
    }
    for (let index = state.hiddenSiblings.length - 1; index >= 0; index--) {
        const saved = state.hiddenSiblings[index];
        if (saved.visibility) saved.element.style.setProperty("visibility", saved.visibility, saved.priority);
        else saved.element.style.removeProperty("visibility");
    }
    state.backdrop.remove();
    if (state.button) state.button.remove();
    if (cinemaButton === state.button) {
        cinemaButton = null;
        cinemaButtonTarget = null;
        cinemaButtonFrame = null;
    }
    cleanupButtonScroll();

    const root = document.documentElement;
    if (state.originalActiveMarker === undefined) root.removeAttribute("data-cinema-active");
    else root.setAttribute("data-cinema-active", state.originalActiveMarker);
    if (state.originalOverflow) root.style.setProperty("overflow", state.originalOverflow, state.originalOverflowPriority);
    else root.style.removeProperty("overflow");
    if (activeState === state) activeState = null;
    window.dispatchEvent(new Event("resize"));
}

function exitLocalState(state: CinemaState, sendDown: boolean, sendUp: boolean): void {
    if (activeState !== state) return;
    if (sendDown) sendToChild(state, "exit");
    restoreLocalState(state);
    if (sendUp) sendToParent(makeMessage("exit", state.sessionId));
}

/** The video's rect in this frame's coordinates; `frame` is the same-origin child frame that
 *  holds an assisted video. */
function videoRect(target: HTMLVideoElement, frame: HTMLIFrameElement | null): { top: number; right: number } {
    const rect = target.getBoundingClientRect();
    if (!frame) return { top: rect.top, right: rect.right };
    const frameRect = frame.getBoundingClientRect();
    return { top: rect.top + frameRect.top + frame.clientTop, right: rect.right + frameRect.left + frame.clientLeft };
}

function placeButton(button: HTMLElement, target: HTMLVideoElement, frame: HTMLIFrameElement | null): void {
    const rect = videoRect(target, frame);
    button.style.top = `${rect.top + 8}px`;
    button.style.left = `${Math.min(rect.right, window.innerWidth) - 40}px`;
}

function createCinemaButton(target: HTMLVideoElement, expanded: boolean, frame: HTMLIFrameElement | null = null): HTMLElement {
    const button = document.createElement("div");
    button.style.cssText = "position:fixed;width:32px;height:32px;background:rgba(0,0,0,0.6);border:none;border-radius:4px;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:2147483647;pointer-events:auto;";
    button.appendChild(createSvgIcon(expanded ? COLLAPSE_PATH : EXPAND_PATH));
    button.title = expanded ? "Exit Cinema Mode" : "Cinema Mode";
    if (expanded) {
        button.style.top = "8px";
        button.style.right = "8px";
    } else placeButton(button, target, frame);
    button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (activeState && (activeState.target === target || activeState.assistedVideo === target)) exitLocalState(activeState, true, true);
        else if (frame) enterAssistedVideo(frame, target);
        else enterVideo(target);
    });
    return button;
}

function showCinemaButton(target: HTMLVideoElement, frame: HTMLIFrameElement | null = null): void {
    if (cinemaButton || activeState) return;
    const button = createCinemaButton(target, false, frame);
    cinemaButton = button;
    cinemaButtonTarget = target;
    cinemaButtonFrame = frame;
    document.body.appendChild(button);
    // Leaving the button back onto the video re-shows it on the next pointer move.
    button.addEventListener("mouseleave", removeCinemaButton);
    cinemaButtonScrollHandler = () => {
        if (cinemaButton === button && !activeState) placeButton(button, target, frame);
    };
    window.addEventListener("scroll", cinemaButtonScrollHandler, true);
}

function removeCinemaButton(): void {
    if (!cinemaButton || cinemaButton.matches(":hover") || activeState) return;
    cleanupButtonScroll();
    cinemaButton.remove();
    cinemaButton = null;
    cinemaButtonTarget = null;
    cinemaButtonFrame = null;
}

function enterVideo(target: HTMLVideoElement): void {
    const previous = activeState;
    if (previous) exitLocalState(previous, true, true);
    const state = expandLocalTarget(target, "video", createSessionId());
    state.originalControls = target.controls;
    target.controls = true;
    state.controlsObserver = new MutationObserver(() => {
        if (activeState === state && !target.controls) target.controls = true;
    });
    state.controlsObserver.observe(target, { attributes: true, attributeFilter: ["controls"] });
    if (cinemaButton) cinemaButton.remove();
    state.button = createCinemaButton(target, true);
    cinemaButton = state.button;
    cinemaButtonTarget = target;
    cinemaButtonFrame = null;
    document.body.appendChild(state.button);
    sendToParent(makeMessage("enter", state.sessionId));
    // In an iframe the viewport grows only after the parent frames expand, so check again on resize.
    const checkFill = (): void => {
        state.videoFillTimer = null;
        if (activeState !== state) return;
        fillViewportIfSmall(state);
    };
    const onResize = (): void => {
        if (state.videoFillTimer) clearTimeout(state.videoFillTimer);
        state.videoFillTimer = setTimeout(checkFill, VIDEO_FILL_CHECK_DELAY_MS);
    };
    state.videoResizeHandler = onResize;
    window.addEventListener("resize", onResize);
    state.videoFillTimer = setTimeout(checkFill, VIDEO_FILL_CHECK_DELAY_MS);
}

/** Site players resize their <video> to the expanded container on their own. A plain
 *  <video> with fixed width/height does not, so it is sized to the viewport directly. */
function fillViewportIfSmall(state: CinemaState): void {
    if (activeState !== state || state.originalVideoStyle !== null || !(state.target instanceof HTMLVideoElement)) return;
    const rect = state.target.getBoundingClientRect();
    const filled = VIDEO_FILL_RATIO;
    if (rect.width >= window.innerWidth * filled || rect.height >= window.innerHeight * filled) return;
    state.originalVideoStyle = state.target.style.cssText;
    for (const [property, value] of VIDEO_FILL_STYLE) state.target.style.setProperty(property, value, "important");
}

/** Expands a same-origin child frame that runs no runtime of its own, and sizes its video to
 *  that frame's viewport from here: the parent can reach the child's DOM directly. */
function enterAssistedVideo(frame: HTMLIFrameElement, video: HTMLVideoElement): void {
    const previous = activeState;
    if (previous) exitLocalState(previous, true, true);
    const state = expandLocalTarget(frame, "iframe", createSessionId());
    state.childFrame = frame;
    state.assistedVideo = video;
    state.originalVideoStyle = video.style.cssText;
    for (const [property, value] of VIDEO_FILL_STYLE) video.style.setProperty(property, value, "important");
    state.originalControls = video.controls;
    video.controls = true;
    state.controlsObserver = new MutationObserver(() => {
        if (activeState === state && !video.controls) video.controls = true;
    });
    state.controlsObserver.observe(video, { attributes: true, attributeFilter: ["controls"] });
    // The child has no Escape listener of its own while focus is inside it.
    state.assistedKeyHandler = (event: KeyboardEvent) => {
        if (event.key !== "Escape" || activeState !== state) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        exitLocalState(state, false, true);
    };
    video.ownerDocument.addEventListener("keydown", state.assistedKeyHandler, true);
    beginChildLifecycleTracking(state);
    if (cinemaButton) cinemaButton.remove();
    state.button = createCinemaButton(video, true, frame);
    cinemaButton = state.button;
    cinemaButtonTarget = video;
    cinemaButtonFrame = frame;
    document.body.appendChild(state.button);
    sendToParent(makeMessage("enter", state.sessionId));
}

function findDirectChildFrame(source: MessageEventSource | null): HTMLIFrameElement | null {
    if (!source) return null;
    const searchRoot = (root: ParentNode): HTMLIFrameElement | null => {
        for (const iframe of Array.from(root.querySelectorAll("iframe"))) {
            if (iframe.contentWindow === source) return iframe;
        }
        for (const element of Array.from(root.querySelectorAll<HTMLElement>("*"))) {
            if (!element.shadowRoot) continue;
            const iframe = searchRoot(element.shadowRoot);
            if (iframe) return iframe;
        }
        return null;
    };
    const iframe = searchRoot(document);
    if (iframe) {
        return iframe;
    }
    return null;
}

function closeIfChildFrameChanged(state: CinemaState): void {
    if (activeState === state && state.childFrame && !state.childFrame.isConnected) exitLocalState(state, true, true);
}

function beginChildLifecycleTracking(state: CinemaState): void {
    const childFrame = state.childFrame;
    if (!childFrame) return;
    state.childLoadHandler = () => {
        if (activeState === state) exitLocalState(state, true, true);
    };
    childFrame.addEventListener("load", state.childLoadHandler);
    state.lifecycleObserver = new MutationObserver(() => closeIfChildFrameChanged(state));
    state.lifecycleObserver.observe(document.documentElement, { subtree: true, childList: true });
    const root = childFrame.getRootNode();
    if (root instanceof ShadowRoot) state.lifecycleObserver.observe(root, { subtree: true, childList: true });
}

function handleChildEnter(frame: HTMLIFrameElement, message: CinemaMessage, source: Window): void {
    let state = activeState;
    if (state && state.sessionId === message.sessionId && state.childFrame === frame && state.childWindow === source) return;
    if (state) exitLocalState(state, true, true);
    state = expandLocalTarget(frame, "iframe", message.sessionId);
    state.childFrame = frame;
    state.childWindow = source;
    state.childSessionId = message.sessionId;
    beginChildLifecycleTracking(state);
    sendToParent(message);
}

function handleMessage(event: MessageEvent): void {
    const message = parseMessage(event.data);
    if (!message) return;
    if (event.source === window.parent && activeState && message.type === "exit" && message.sessionId === activeState.sessionId) {
        exitLocalState(activeState, true, false);
        return;
    }
    const frame = findDirectChildFrame(event.source);
    if (!frame || !event.source || typeof (event.source as Window).postMessage !== "function") return;
    const source = event.source as Window;
    if (message.type === "enter") {
        handleChildEnter(frame, message, source);
        return;
    }
    const state = activeState;
    if (!state || state.kind !== "iframe" || state.childFrame !== frame || state.childWindow !== source || state.childSessionId !== message.sessionId || state.sessionId !== message.sessionId) return;
    exitLocalState(state, false, true);
}

function attachVideoListeners(video: HTMLVideoElement): void {
    if (video.dataset.cinemaReady) return;
    video.dataset.cinemaReady = "1";
    const tryAttach = (): void => {
        if (video.dataset.cinemaAttached || isDecorativeVideo(video)) return;
        video.dataset.cinemaAttached = "1";
        attachedVideos.add(video);
    };
    // Players such as YouTube keep the element 0x0 until playback starts, after the timed retries.
    video.addEventListener("playing", tryAttach);
    video.addEventListener("resize", tryAttach);
    if (video.readyState < 1) {
        video.addEventListener("loadedmetadata", tryAttach, { once: true });
        setTimeout(tryAttach, 1000);
        setTimeout(tryAttach, 3000);
    } else if (video.getBoundingClientRect().width > 0 && video.getBoundingClientRect().height > 0) tryAttach();
    else {
        setTimeout(tryAttach, 1000);
        setTimeout(tryAttach, 3000);
    }
}

/** The largest attached video under the pointer. Hit-testing by position, not by
 *  mouseenter, because players cover their <video> with sibling overlay layers. */
function videoAtPoint(x: number, y: number): HTMLVideoElement | null {
    let best: HTMLVideoElement | null = null;
    let bestArea = 0;
    for (const video of attachedVideos) {
        if (!video.isConnected) { attachedVideos.delete(video); continue; }
        const rect = video.getBoundingClientRect();
        if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue;
        const area = rect.width * rect.height;
        if (area > bestArea) { best = video; bestArea = area; }
    }
    return best;
}

/** A video under the pointer inside a same-origin child frame that runs no runtime.
 *  Electron does not always run the preload in a same-origin iframe of a webview's first page,
 *  so such frames would otherwise get no cinema button at all. */
function assistedVideoAtPoint(x: number, y: number): { video: HTMLVideoElement; frame: HTMLIFrameElement } | null {
    for (const frame of Array.from(document.querySelectorAll("iframe"))) {
        const frameRect = frame.getBoundingClientRect();
        if (x < frameRect.left || x > frameRect.right || y < frameRect.top || y > frameRect.bottom) continue;
        let childDocument: Document | null = null;
        try { childDocument = frame.contentDocument; } catch { /* cross-origin */ }
        if (!childDocument?.documentElement || childDocument.documentElement.hasAttribute(RUNTIME_MARKER)) continue;
        const childX = x - frameRect.left - frame.clientLeft;
        const childY = y - frameRect.top - frame.clientTop;
        let best: HTMLVideoElement | null = null;
        let bestArea = 0;
        for (const video of Array.from(childDocument.querySelectorAll("video"))) {
            if (isDecorativeVideo(video)) continue;
            const rect = video.getBoundingClientRect();
            if (childX < rect.left || childX > rect.right || childY < rect.top || childY > rect.bottom) continue;
            const area = rect.width * rect.height;
            if (area > bestArea) { best = video; bestArea = area; }
        }
        if (best) return { video: best, frame };
    }
    return null;
}

function trackPointer(): void {
    let pending: { x: number; y: number } | null = null;
    const onPointer = (x: number, y: number): void => {
        if (activeState) return;
        const scheduled = pending !== null;
        pending = { x, y };
        if (scheduled) return;
        requestAnimationFrame(() => {
            const point = pending;
            pending = null;
            if (!point || activeState) return;
            const video = videoAtPoint(point.x, point.y);
            const assisted = video ? null : assistedVideoAtPoint(point.x, point.y);
            const target = video ?? assisted?.video ?? null;
            if (target && target === cinemaButtonTarget) return;
            removeCinemaButton();
            if (target) showCinemaButton(target, assisted?.frame ?? null);
        });
    };
    document.addEventListener("mousemove", (event) => onPointer(event.clientX, event.clientY), { capture: true, passive: true });
    document.documentElement.addEventListener("mouseleave", () => {
        // Entering a child frame also "leaves" this document; the child's own listeners
        // below take over for an assisted video.
        if (cinemaButtonFrame) return;
        setTimeout(removeCinemaButton, 100);
    });

    // Pointer moves inside a child frame reach only that frame's document. For a same-origin
    // child with no runtime, listen there too and translate to this frame's coordinates.
    const watchedDocuments = new WeakSet<Document>();
    const watchFrame = (frame: HTMLIFrameElement): void => {
        let childDocument: Document | null = null;
        try { childDocument = frame.contentDocument; } catch { /* cross-origin */ }
        if (!childDocument?.documentElement || childDocument.documentElement.hasAttribute(RUNTIME_MARKER) || watchedDocuments.has(childDocument)) return;
        watchedDocuments.add(childDocument);
        childDocument.addEventListener("mousemove", (event) => {
            const frameRect = frame.getBoundingClientRect();
            onPointer(event.clientX + frameRect.left + frame.clientLeft, event.clientY + frameRect.top + frame.clientTop);
        }, { capture: true, passive: true });
        childDocument.documentElement.addEventListener("mouseleave", () => {
            setTimeout(removeCinemaButton, 100);
        });
    };
    const watchAllFrames = (): void => document.querySelectorAll("iframe").forEach(watchFrame);
    watchAllFrames();
    document.addEventListener("load", (event) => {
        if (event.target instanceof HTMLIFrameElement) watchFrame(event.target);
    }, true);
    window.addEventListener("load", watchAllFrames);
}

function initializeCinemaMode(): void {
    document.documentElement.setAttribute(RUNTIME_MARKER, "");
    trackPointer();
    const processVideo = (video: HTMLVideoElement): void => attachVideoListeners(video);
    document.querySelectorAll<HTMLVideoElement>("video").forEach(processVideo);
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node instanceof HTMLVideoElement) processVideo(node);
                else if (node instanceof HTMLElement) node.querySelectorAll<HTMLVideoElement>("video").forEach(processVideo);
            }
        }
    });
    if (document.body) observer.observe(document.body, { childList: true, subtree: true });
    else document.addEventListener("DOMContentLoaded", () => observer.observe(document.body, { childList: true, subtree: true }), { once: true });
}

export function exitCinemaFromEscape(): boolean {
    if (!activeState) return false;
    exitLocalState(activeState, true, true);
    return true;
}

export function installCinemaMode(): void {
    if (installed) return;
    installed = true;
    window.addEventListener("message", handleMessage);
    if (!process.isMainFrame) {
        document.addEventListener("keydown", (event) => {
            if (event.key !== "Escape" || !exitCinemaFromEscape()) return;
            event.preventDefault();
            event.stopImmediatePropagation();
        }, true);
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initializeCinemaMode, { once: true });
    else initializeCinemaMode();
}
