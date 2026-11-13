import type { Cleanup } from "../../core/utils/DisposableStore";

export interface MarkdownBodyState {
    compactMode: boolean;
    searchVisible: boolean;
    searchText: string;
    currentMatchIndex: number;
    totalMatches: number;
}

export interface MarkdownBodyHostState {
    content: string;
    filePath?: string;
    title: string;
}

export interface MarkdownBodyStateStore<T> {
    get(): T;
    subscribe(listener: () => void): Cleanup;
    subscribe<R>(listener: (value: R) => void, selector: (state: T) => R): Cleanup;
}

export interface MarkdownBodyHost {
    readonly state: MarkdownBodyStateStore<MarkdownBodyHostState>;
}

export type MarkdownQueueEvent =
    | { type: "focus" }
    | { type: "anchor"; fragment: string };

export type MarkdownQueueRequest =
    | { type: "scrollToMatch"; index: number }
    | { type: "scrollToAnchor"; fragment: string };

export interface MarkdownBodyQueue {
    send(event: MarkdownQueueEvent): void;
    subscribe(handler: (event: MarkdownQueueEvent) => void): Cleanup;
    execute(request: MarkdownQueueRequest): Promise<unknown>;
    register(handler: (request: MarkdownQueueRequest) => unknown): Cleanup;
    readonly pendingRequestCount: number;
}

export interface MarkdownBodyViewPort {
    renderedHtml(): string;
}

interface MarkdownBodyModelBase {
    readonly state: MarkdownBodyStateStore<MarkdownBodyState>;
    readonly host?: MarkdownBodyHost | null;
    readonly page?: object | null;
    openSearch(): void;
    closeSearch(): void;
    setSearchText(text: string): void;
    setMatchCount(count: number): void;
    nextMatch(): void;
    prevMatch(): void;
    attachViewPort?(port: MarkdownBodyViewPort): () => void;
    followLink(href: string): boolean;
}

export type MarkdownBodyModel = MarkdownBodyModelBase & (
    | { readonly queue: MarkdownBodyQueue; readonly typedQueue?: never }
    | { readonly typedQueue: MarkdownBodyQueue; readonly queue?: never }
);
