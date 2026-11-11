import type { BoardPortInitMsg } from "../ipc/board-bridge/frame-protocol";
import type { BoardSourceContext } from "../shared/board-source-context";
import type { HostFrameChannel } from "./board-host-frame-channel";
import { Listeners, SettledValue } from "./primitives";

interface PersephoneSourceOpenEvent {
    readonly url: string;
    readonly sourceUrl: string;
    readonly privateSession?: boolean;
    readonly context?: BoardSourceContext;
}

export function createSourceApi(deps: { hostFrame: HostFrameChannel; whenHandshake: () => Promise<void> }) {
    const { hostFrame, whenHandshake } = deps;
    const filePath = new SettledValue<string | undefined>();
    const sourceUrl = new SettledValue<string | undefined>();
    let initialSourcePrivateSession = false;
    let initialSourceContext: BoardSourceContext | undefined;
    const sourceOpenListeners = new Listeners<[PersephoneSourceOpenEvent]>("persephone.source.onOpen callback error:");
    const pendingSourceOpenEvents: Array<{ sourceUrl: string; privateSession?: boolean; context?: BoardSourceContext }> = [];
    let folderPathValue: string | undefined;
    let filePathNeedsMaterialize = false;
    let materializedPath: string | undefined;
    let materializedPromise: Promise<string | undefined> | null = null;

    function deliverSourceOpen(source: string, privateSession?: boolean, context?: BoardSourceContext): void {
        sourceOpenListeners.emit({
            url: source,
            sourceUrl: source,
            ...(privateSession ? { privateSession: true } : {}),
            ...(context ? { context } : {}),
        });
    }
    function onSourceOpen(callback: (event: PersephoneSourceOpenEvent) => void): () => void {
        const unsubscribe = sourceOpenListeners.add(callback);
        while (pendingSourceOpenEvents.length > 0) {
            const pending = pendingSourceOpenEvents.shift();
            if (pending !== undefined) deliverSourceOpen(pending.sourceUrl, pending.privateSession, pending.context);
        }
        return unsubscribe;
    }
    function initFilePath(data: BoardPortInitMsg): void {
        if (filePath.isSettled) return;
        filePathNeedsMaterialize = !!data.materialize;
        folderPathValue = typeof data.folderPath === "string" ? data.folderPath : undefined;
        filePath.settle(data.filePath);
    }
    function initSourceUrl(data: BoardPortInitMsg): void {
        if (sourceUrl.isSettled) return;
        initialSourcePrivateSession = data.initialSourcePrivateSession === true;
        initialSourceContext = data.sourceContext;
        sourceUrl.settle(data.sourceUrl);
    }

    hostFrame.on("source.opened", (data) => {
        if (typeof data.sourceUrl !== "string") return;
        const pending = {
            sourceUrl: data.sourceUrl,
            ...(data.privateSession === true ? { privateSession: true } : {}),
            ...(data.context ? { context: data.context } : {}),
        };
        if (sourceOpenListeners.size === 0) pendingSourceOpenEvents.push(pending);
        else deliverSourceOpen(pending.sourceUrl, pending.privateSession, pending.context);
    });

    return {
        api: {
            async getFilePath(): Promise<string | undefined> {
                await whenHandshake();
                const value = filePath.peek();
                if (!filePathNeedsMaterialize) return value;
                if (materializedPath) return materializedPath;
                if (!materializedPromise) {
                    materializedPromise = hostFrame.request("filePath", {}).then(
                        (path: string | undefined) => { materializedPath = path; return path; },
                        (error: unknown) => { materializedPromise = null; throw error; },
                    );
                }
                return materializedPromise;
            },
            getSourceUrl(): Promise<string | undefined> { return sourceUrl.get(); },
            async getFolderPath(): Promise<string | undefined> { await whenHandshake(); return folderPathValue; },
            source: {
                get initialSourceContext(): BoardSourceContext | undefined { return initialSourceContext; },
                get initialSourcePrivateSession(): boolean { return initialSourcePrivateSession; },
                navigate(href: string): Promise<void> {
                    if (typeof href !== "string" || !href) return Promise.reject(new TypeError("persephone.source.navigate() requires a non-empty href."));
                    return hostFrame.request("source.navigate", { href });
                },
                onOpen: onSourceOpen,
            },
            content: {
                open(link: string, options?: { timeoutMs?: number }): Promise<{ url: string; size: number; contentType: string }> {
                    if (typeof link !== "string") return Promise.reject(new Error("content.open() requires a link string."));
                    if (options !== undefined && (!options || typeof options !== "object")) return Promise.reject(new Error("content.open() options must be an object."));
                    const timeoutMs = options?.timeoutMs;
                    if (timeoutMs !== undefined && (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0)) return Promise.reject(new Error("content.open() timeoutMs must be a positive integer."));
                    return whenHandshake().then(() => hostFrame.request("contentOpen", { link, ...(timeoutMs === undefined ? {} : { timeoutMs }) }).then((value) => {
                        if (typeof value.url === "string" && typeof value.size === "number" && Number.isFinite(value.size) && value.size >= 0 && typeof value.contentType === "string") return value;
                        throw new Error("Malformed persephone.content.open() response.");
                    }));
                },
            },
        },
        initFilePath,
        initSourceUrl,
    };
}
