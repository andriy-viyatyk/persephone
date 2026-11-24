import { BrowserWindow } from "electron";
import { openWindows } from "../../open-windows";
import { windowStates } from "../../window-states";
import { IAiChild, IAiMember, IAiVisible, IAiVisionDescriptor } from "ai-vision";
import { createGuideIndex } from "../../../shared/guides";
import { createMountedGuideSource } from "../../../shared/guides/mounted-source";
import { GuidesNode } from "./guides";
import { MainGuideSource } from "./guide-source";
import { resolveMainBoardGuideMounts } from "./board-guide-mounts";
import { MainNode } from "./main-services";
import { cancelNativeDialogs, getNativeDialogState } from "../../native-dialog-tracker";
import type { NativeDialogKind } from "../../native-dialog-tracker";
import { TestWindowOperations } from "./test-window-operations";
import { desktopAwareness } from "../../desktop-awareness";

/**
 * The main process's half of the AiVision tree.
 *
 * Everything under a window is renderer knowledge; the `windows` collection is main-process
 * knowledge (`openWindows`, `windowStates`). The `call` tool resolves `windows`, `windows[i]` and a
 * window's own members here with the same shared resolver the renderer uses, and forwards anything
 * deeper — `windows[1].pages[0].content` — to that window's renderer as `pages[0].content`.
 *  adds the `main` node beside `windows`.
 */

/** Members of one window that the main process answers itself; anything else is forwarded. */
export const WINDOW_MEMBER_NAMES: readonly string[] = ["index", "windowId", "name", "status", "pageCount", "activePageId", "pages", "open", "focus", "nativeDialog", "desktopVisible"];

const MAIN_ROOT_MEMBERS: readonly IAiMember[] = [
    { name: "windows", kind: "property", node: true, summary: "All windows; windows[i] addresses one." },
    { name: "main", kind: "property", node: true, summary: "Main-process diagnostics and gated scripting." },
    { name: "guides", kind: "property", node: true, summary: "Documentation tree, page text, layouts, and text search; served by the main process." },
];

const WINDOW_MEMBERS: readonly IAiMember[] = [
    { name: "index", kind: "property", summary: "Window index — the value other tools take as windowIndex." },
    { name: "windowId", kind: "property", summary: "Live Electron window identity; absent when this window is closed." },
    { name: "name", kind: "property", writable: true, summary: "Persistent normal-window name; set null to clear." },
    { name: "status", kind: "property", summary: "\"open\" or \"closed\" (a closed window keeps its pages and can be reopened)." },
    { name: "pageCount", kind: "property", summary: "Number of pages the window holds (persisted state)." },
    { name: "activePageId", kind: "property", summary: "Id of the window's active page." },
    { name: "pages", kind: "property", summary: "The window's pages. Open window: the live Pages collection (windows[i].pages[0].content works). Closed window: summaries from persisted state (id, title, type, editor, filePath) — open() it to get the live collection. `type` contains the editor registry ID (`editorId`); on an open window use `editor`, which is the actionable one." },
    { name: "open", kind: "method", signature: "open()", summary: "Open (or reopen) this window with its persisted pages, and focus it." },
    { name: "focus", kind: "method", signature: "focus()", summary: "Bring an open window to the front." },
    { name: "nativeDialog", kind: "property", node: true, summary: "Open native dialog state; dismiss cancels it." },
    { name: "desktopVisible", kind: "property", summary: "Whether this window is shown, not minimized, and the session is unlocked; another virtual desktop is detectable only when a virtual-desktop probe is installed." },
];

const WINDOWS_MEMBERS: readonly IAiMember[] = [
    { name: "count", kind: "property", summary: "Number of windows, open and closed." },
    { name: "createTestWindow", kind: "method", signature: "createTestWindow()", summary: "Web-app test runner: create a ready test window for an attached run." },
    { name: "selectTestWindow", kind: "method", signature: "selectTestWindow(selector)", summary: "Web-app test runner: select one open window by index, exact name:name, or unique title substring; unmatched results contain a count only." },
    { name: "createOrSelectNamedTestWindow", kind: "method", signature: "createOrSelectNamedTestWindow(name)", summary: "Web-app test runner: reuse a live named normal window or create and name one." },
    { name: "disposeTestWindow", kind: "method", signature: "disposeTestWindow(index, windowId)", summary: "Web-app test runner: dispose a window created by createTestWindow when its live identity still matches." },
];

const WINDOWS_HELP = `
Persephone can have several windows. windows[i] is one window; set its writable name to give a
normal window a persistent selector, or set it to null to clear it. Names cannot be assigned to
boards or closed windows. windows.selectTestWindow("name:<name>") selects an exact live name;
windows.createOrSelectNamedTestWindow(name) reuses a live named window or creates one. Its own
members (status, open(),
focus(), nativeDialog, persisted pages) are answered by the main process. nativeDialog reports
owned native dialogs and dismiss() cancels them without choosing or confirming a path. Anything deeper is answered by that
window itself: prefix any path with "windows[i]." — windows[1].pages, windows[1].page.content,
windows[1].helpSearch(...). A path without the prefix targets the main (first open) window.
`;

interface IPersistedPageState {
    title?: string;
    editor?: string;
    language?: string;
    filePath?: string;
    profileName?: string;
    isIncognito?: boolean;
    isTor?: boolean;
}

export class WindowNode implements IAiVisible {
    constructor(readonly index: number) {}

    private get data() {
        return openWindows.findWindowDataByIndex(this.index);
    }

    get nativeDialog(): NativeDialogNode {
        return new NativeDialogNode(this.data?.window?.window);
    }

    get desktopVisible(): boolean {
        return desktopAwareness.isDesktopVisibleForIndex(this.index);
    }

    get status(): "open" | "closed" | "missing" {
        const data = this.data;
        if (!data) return "missing";
        return data.window ? "open" : "closed";
    }

    get windowId(): number | undefined {
        const window = this.data?.window?.window;
        return window && !window.isDestroyed() ? window.id : undefined;
    }

    get name(): string | undefined { return this.data?.name; }
    set name(value: string | null | undefined) { openWindows.setWindowName(this.index, value); }

    get pageCount(): number {
        return windowStates.getState(this.index)?.pages?.length ?? 0;
    }

    get activePageId(): string | undefined {
        return windowStates.getState(this.index)?.activePageId;
    }

    get pages() {
        const pages = windowStates.getState(this.index)?.pages ?? [];
        return pages.map(p => {
            const main = p.editors.find(e => e.id === p.mainEditorId);
            const state = (main?.state ?? {}) as IPersistedPageState;
            return {
                id: p.id,
                title: state.title ?? "Empty",
                type: main?.editorId,
                editor: state.editor,
                language: state.language,
                filePath: state.filePath,
                modified: p.modified,
                pinSide: p.pinSide ?? (p.pinned ? "left" : undefined),
                pinned: p.pinSide ? p.pinSide === "left" : p.pinned,
                // Browser pages: identity only, never the url — the same rule as window descriptors.
                ...(state.editor === "browser-view" ? { profileName: state.profileName ?? "", isIncognito: !!state.isIncognito, isTor: !!state.isTor } : {}),
            };
        });
    }

    async open(): Promise<{ windowIndex: number; status: string }> {
        const data = this.data;
        if (!data) throw new Error(`Window ${this.index} does not exist`);
        if (data.window) {
            data.window.focus();
            return { windowIndex: this.index, status: "open" };
        }
        if (data.boardRoot) openWindows.openBoardWindow(data.boardRoot);
        else openWindows.createWindow(this.index);
        if (data.whenReady) await data.whenReady;
        return { windowIndex: this.index, status: "open" };
    }

    focus(): { windowIndex: number; status: string } {
        const data = this.data;
        if (!data?.window) throw new Error(`Window ${this.index} is not open — call windows[${this.index}].open() first.`);
        data.window.focus();
        return { windowIndex: this.index, status: "open" };
    }

    get aiVision(): IAiVisionDescriptor {
        return {
            kind: "Window",
            summary: "One Persephone window, its pages, visibility, and any native dialog it owns.",
            members: WINDOW_MEMBERS,
            children: () => [
                ...(this.status === "open"
                    ? [{ segment: ".pages", kind: "Pages", summary: this.pageCount + " page(s), answered by the window" }]
                    : []),
                { segment: ".nativeDialog", kind: "NativeDialog", summary: "Owned native dialog state and cancellation." },
            ],
            summarize: () => ({ kind: "Window", index: this.index, name: this.name ?? null, status: this.status, pageCount: this.pageCount, activePageId: this.activePageId ?? null }),
        };
    }
}

const NATIVE_DIALOG_MEMBERS: readonly IAiMember[] = [
    { name: "open", kind: "property", summary: "Whether this window owns an open native dialog." },
    { name: "kind", kind: "property", summary: "Native dialog kind: file, folder, or messageBox." },
    { name: "title", kind: "property", summary: "Title of the owned native dialog when available." },
    { name: "dismiss", kind: "method", signature: "dismiss()", summary: "Cancel native dialogs owned by this window." },
];

class NativeDialogNode implements IAiVisible {
    constructor(private readonly browserWindow: BrowserWindow | undefined) {}

    private state() {
        return getNativeDialogState(this.browserWindow);
    }

    get open(): Promise<boolean> { return this.state().then(state => state.open); }
    get kind(): Promise<NativeDialogKind | undefined> { return this.state().then(state => state.kind); }
    get title(): Promise<string | undefined> { return this.state().then(state => state.title); }

    dismiss() {
        return this.browserWindow
            ? cancelNativeDialogs(this.browserWindow)
            : Promise.resolve({ cancelled: 0, titles: [] });
    }

    get aiVision(): IAiVisionDescriptor {
        return {
            kind: "NativeDialog",
            summary: "Native dialogs owned by one Persephone window; agents may cancel but cannot choose or confirm paths.",
            members: NATIVE_DIALOG_MEMBERS,
            help: "Use dismiss() to cancel an owned file picker. This cannot enter a path or confirm Save/Open.",
            summarize: async () => ({ kind: "NativeDialog", ...(await this.state()) }),
        };
    }
}

export class WindowsNode implements IAiVisible {
    constructor(private readonly testWindowOperations = new TestWindowOperations()) {}

    get count(): number {
        return openWindows.allWindowData().length;
    }

    createTestWindow() { return this.testWindowOperations.createTestWindow(); }
    selectTestWindow(selector: string) { return this.testWindowOperations.selectTestWindow(selector); }
    createOrSelectNamedTestWindow(name: string) { return this.testWindowOperations.createOrSelectNamedTestWindow(name); }
    disposeTestWindow(index: number, windowId: number): void { this.testWindowOperations.disposeTestWindow(index, windowId); }

    get aiVision(): IAiVisionDescriptor {
        return {
            kind: "Windows",
            summary: "All Persephone windows, open and closed.",
            members: WINDOWS_MEMBERS,
            help: WINDOWS_HELP,
            children: () => this.children(),
            index: (key) => {
                const index = typeof key === "number" ? key : Number(key);
                return openWindows.findWindowDataByIndex(index) ? new WindowNode(index) : undefined;
            },
            summarize: () => ({ kind: "Windows", count: this.count, open: openWindows.allWindowData().filter(w => w.window).map(w => w.index) }),
        };
    }

    private children(): IAiChild[] {
        return openWindows.allWindowData().map(w => {
            const node = new WindowNode(w.index);
            const state = windowStates.getState(w.index);
            return {
                segment: `[${w.index}]`,
                kind: "Window",
                summary: `${node.status}, ${state?.pages?.length ?? 0} page(s)`,
            };
        });
    }
}

/** The root the main process resolves against: only what the main process owns. */
export class MainAiRoot implements IAiVisible {
    readonly windows = new WindowsNode();
    readonly main = new MainNode(this.windows);
    readonly guides: GuidesNode;

    constructor(onGuideRead?: (path: string) => void) {
        // The app's own corpus plus one mount per trusted board shipping a `guides` folder.
        const source = createMountedGuideSource(new MainGuideSource(), resolveMainBoardGuideMounts);
        this.guides = new GuidesNode(createGuideIndex(source), source, onGuideRead);
    }

    get aiVision(): IAiVisionDescriptor {
        return {
            kind: "PersephoneMain",
            summary: "Main-process part of the object model.",
            members: MAIN_ROOT_MEMBERS,
        };
    }
}
