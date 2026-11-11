import type { BoardOpenRawLinkOptions } from "../ipc/board-bridge/port-protocol";
import { installBoardContextMenu } from "./board-context-menu";
import { installBoardDiagnostics } from "./board-console-mirror";
import type { HostFrameChannel } from "./board-host-frame-channel";
import type { MainPortChannel } from "./main-port-channel";
import type { HostText } from "./i18n-api";

export function installFrameBehaviours(deps: {
    hostFrame: HostFrameChannel;
    mainPort: MainPortChannel;
    hostText: HostText;
    openRawLink: (href: string, options?: BoardOpenRawLinkOptions) => Promise<void>;
}): void {
    const { hostFrame, mainPort, hostText, openRawLink } = deps;
    window.addEventListener("keydown", (event: KeyboardEvent) => {
        if ((event.ctrlKey || event.metaKey) && (event.key === "s" || event.key === "S")) {
            if (event.defaultPrevented) return;
            event.preventDefault();
            try { hostFrame.emit("content.save", {}); } catch { /* parent gone */ }
        }
    });
    window.addEventListener("keydown", (event: KeyboardEvent) => {
        if (!event.ctrlKey || !event.altKey) return;
        if (event.code !== "BracketRight" && event.code !== "BracketLeft") return;
        if (event.defaultPrevented) return;
        event.preventDefault();
        try { hostFrame.emit("theme.cycle", { direction: event.code === "BracketRight" ? 1 : -1 }); } catch { /* parent gone */ }
    });
    function routeExternalLinkClick(event: MouseEvent): void {
        if (event.defaultPrevented) return;
        const target = event.target as Element | null;
        const anchor = target && target.closest ? target.closest("a[href]") : null;
        if (!(anchor instanceof HTMLAnchorElement)) return;
        const href = anchor.href;
        if (!href || href.startsWith("board://") || href.startsWith("javascript:")) return;
        event.preventDefault();
        void openRawLink(href);
    }
    window.addEventListener("click", routeExternalLinkClick);
    window.addEventListener("auxclick", (event: MouseEvent) => {
        if (event.button === 1) routeExternalLinkClick(event);
    });
    installBoardContextMenu({
        fire: (_method, payload) => mainPort.fire("notify", [payload.message, payload.type, payload.persistent]),
        rpc: (method, ...args) => mainPort.rpc(method, ...args),
        hostText,
    });
    window.addEventListener("pointerdown", () => hostFrame.emit("interact", {}), true);
    installBoardDiagnostics((name, payload) => hostFrame.emit(name, payload));
}
