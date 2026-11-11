import type { BoardToHostEvents } from "../ipc/board-bridge/frame-protocol";
import type { BoardToolbarControlType } from "../ipc/board-bridge/ui-catalog";
import type { HostFrameChannel } from "./board-host-frame-channel";
import { Listeners } from "./primitives";

interface PersephoneNavigationReturnEvent {
    readonly url: string;
    readonly query: Readonly<Record<string, readonly string[]>>;
    readonly hash: Readonly<Record<string, readonly string[]>>;
}
interface PersephoneToolbarActionEvent {
    readonly id: string;
    readonly type: BoardToolbarControlType;
    readonly value?: boolean | string;
}

export function createChromeApi(deps: { hostFrame: HostFrameChannel; view: string }) {
    const { hostFrame, view } = deps;
    const navigationReturnListeners = new Listeners<[PersephoneNavigationReturnEvent]>("persephone.navigation.onReturn callback error:");
    const toolbarActionListeners = new Listeners<[PersephoneToolbarActionEvent]>("persephone.toolbar.onAction callback error:");
    const statusBarActionListeners = new Listeners<[{ id: string }]>("persephone.statusBar.onAction callback error:");
    hostFrame.on("navigation.return", (data) => {
        if (typeof data.url !== "string" || !data.query || !data.hash) return;
        navigationReturnListeners.emit({ url: data.url, query: data.query, hash: data.hash });
    });
    hostFrame.on("toolbar.control", (data) => {
        if (typeof data.id !== "string" || !data.id
            || (data.type !== "button" && data.type !== "toggle" && data.type !== "menu"
                && data.type !== "select" && data.type !== "segmented" && data.type !== "input" && data.type !== "breadcrumb")
            || (data.value !== undefined && typeof data.value !== "boolean" && typeof data.value !== "string")) return;
        const value = data.type === "button" ? undefined : data.value;
        toolbarActionListeners.emit({ id: data.id, type: data.type, ...(value !== undefined ? { value } : {}) });
    });
    hostFrame.on("statusBar.action", (data) => {
        if (typeof data.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(data.id)) return;
        statusBarActionListeners.emit({ id: data.id });
    });
    function navigationReturnUrlRpc(): Promise<string> {
        return hostFrame.request("navigation.createReturnUrl", {}).then((url) => {
            if (typeof url === "string") return url;
            throw new Error("Malformed navigation return URL response.");
        });
    }
    return {
        api: {
            view,
            toolbar: {
                set(controls: BoardToHostEvents["toolbar.set"]["controls"]): void {
                    hostFrame.emit("toolbar.set", { controls: Array.isArray(controls) ? controls as BoardToHostEvents["toolbar.set"]["controls"] : [] });
                },
                update(partial: BoardToHostEvents["toolbar.update"]["controls"]): void {
                    hostFrame.emit("toolbar.update", { controls: Array.isArray(partial) ? partial as BoardToHostEvents["toolbar.update"]["controls"] : [] });
                },
                setText(text: string): void { hostFrame.emit("toolbar.setText", { toolbarText: typeof text === "string" ? text : String(text ?? "") }); },
                onAction: (callback: (event: PersephoneToolbarActionEvent) => void) => toolbarActionListeners.add(callback),
            },
            statusBar: {
                set(items: BoardToHostEvents["statusBar.set"]["items"]): void { hostFrame.emit("statusBar.set", { items: Array.isArray(items) ? items : [] }); },
                update(id: string, patch: Omit<BoardToHostEvents["statusBar.update"]["items"][number], "id">): void { hostFrame.emit("statusBar.update", { items: [{ id, ...patch }] }); },
                onAction: (callback: (event: { id: string }) => void) => statusBarActionListeners.add(callback),
            },
            setStatusText(text: string): void {
                try { hostFrame.emit("statusText.set", { statusText: typeof text === "string" ? text : String(text ?? "") }); } catch { /* parent gone */ }
            },
            setSecondaryViews(views: Array<{ id: string; html?: string; title?: string }>): void {
                try { hostFrame.emit("secondaryViews.set", { views: Array.isArray(views) ? views : [] }); } catch { /* parent gone */ }
            },
            navigation: {
                createReturnUrl: navigationReturnUrlRpc,
                onReturn: (callback: (event: PersephoneNavigationReturnEvent) => void) => navigationReturnListeners.add(callback),
            },
        },
    };
}
