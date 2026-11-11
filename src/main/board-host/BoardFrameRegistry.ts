import type { WebContents } from "electron";

export interface BoardFrameRegistration {
    host: WebContents;
    boardHost: string;
    frameNonce?: string;
    title?: string;
    pageId?: string;
    sessionId?: string;
}

export class BoardFrameRegistry {
    private readonly registrations = new Map<string, BoardFrameRegistration>();

    public register(
        key: string,
        host: WebContents,
        boardHost: string,
        frameNonce?: string,
        title?: string,
        pageId?: string,
    ): BoardFrameRegistration | undefined {
        const previous = this.registrations.get(key);
        this.registrations.set(key, { host, boardHost, frameNonce, title, pageId });
        return previous;
    }

    public unregister(key: string, frameNonce?: string): boolean {
        const registration = this.registrations.get(key);
        if (frameNonce !== undefined && registration?.frameNonce !== frameNonce) return false;
        this.registrations.delete(key);
        return true;
    }

    public get(key: string): BoardFrameRegistration | undefined {
        return this.registrations.get(key);
    }

    public has(key: string): boolean {
        return this.registrations.has(key);
    }

    public entries(): IterableIterator<[string, BoardFrameRegistration]> {
        return this.registrations.entries();
    }

    public resolveDialogFrame(
        boardHost: string,
        frameNonce: string,
        view: string,
    ): { key: string; host: WebContents; title: string; pageId: string } | undefined {
        const tab = view === "main" ? "main" : `board-secondary:${view}`;
        const matches = [...this.registrations.entries()].filter(([key, registration]) =>
            key.endsWith(`/${tab}`) && registration.boardHost === boardHost
            && registration.frameNonce === frameNonce && !registration.host.isDestroyed());
        return matches.length === 1
            ? {
                key: matches[0][0],
                host: matches[0][1].host,
                title: matches[0][1].title ?? "Board",
                pageId: matches[0][1].pageId ?? "",
            }
            : undefined;
    }
}

export const boardFrameRegistry = new BoardFrameRegistry();
