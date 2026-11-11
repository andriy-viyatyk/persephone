import type { BoardPortInitMsg } from "../ipc/board-bridge/frame-protocol";
import { boardPipePagePath } from "../ipc/board-bridge/origin-routes";
import type { HostFrameChannel } from "./board-host-frame-channel";
import { Listeners, SettledValue } from "./primitives";

export function createHostContentApi(deps: { hostFrame: HostFrameChannel; whenHandshake: () => Promise<void> }) {
    const { hostFrame, whenHandshake } = deps;
    let hostEnabled = false;
    let hostContent = "";
    let hostLanguage: string | undefined;
    const hostContentReady = new SettledValue<void>();
    const hostChangeListeners = new Listeners<[string, string?]>("persephone.host.onContentChange callback error:");
    let pipePageId: string | undefined;
    let pipeUrlEnabled = false;

    hostFrame.on("host.content", (data) => {
        hostContent = data.content;
        hostLanguage = data.language;
        hostContentReady.settle(undefined);
        hostChangeListeners.emit(data.content, data.language);
    });

    return {
        api: {
            host: {
                async streamUrl(): Promise<string> {
                    await whenHandshake();
                    if (!pipeUrlEnabled) throw new Error("persephone.host.streamUrl is unavailable on this board");
                    if (!pipePageId) throw new Error("Persephone did not provide a page id for streamUrl()");
                    return new URL(boardPipePagePath(pipePageId), location.origin).toString();
                },
                async getContent(): Promise<string> {
                    await whenHandshake();
                    if (!hostEnabled) throw new Error("persephone.host is available only for content-host boards");
                    return hostContentReady.get().then(() => hostContent);
                },
                setContent(content: string): void {
                    hostContent = content;
                    hostContentReady.settle(undefined);
                    try { hostFrame.emit("content.set", { content }); } catch { /* parent gone */ }
                },
                onContentChange(cb: (content: string, language?: string) => void): () => void { return hostChangeListeners.add(cb); },
                async getLanguage(): Promise<string | undefined> {
                    await whenHandshake();
                    if (!hostEnabled) throw new Error("persephone.host is available only for content-host boards");
                    return hostContentReady.get().then(() => hostLanguage);
                },
                save(): void {
                    try { hostFrame.emit("content.save", {}); } catch { /* parent gone */ }
                },
            },
        },
        init(data: BoardPortInitMsg): void {
            if (data.contentHost) hostEnabled = true;
            pipePageId = typeof data.pageId === "string" ? data.pageId : undefined;
            pipeUrlEnabled = data.pipeUrlEnabled === true;
        },
    };
}
