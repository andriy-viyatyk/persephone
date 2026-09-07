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

export interface MarkdownBodyPage {
    readonly id: string;
    pushNavBack(entry: { href: string; title: string }): void;
}

export interface MarkdownBodyModel {
    readonly state: MarkdownBodyStateStore<MarkdownBodyState>;
    readonly host?: MarkdownBodyHost | null;
    readonly typedQueue: MarkdownBodyQueue;
    readonly page?: MarkdownBodyPage | null;
    openSearch(): void;
    closeSearch(): void;
    setSearchText(text: string): void;
    setMatchCount(count: number): void;
    nextMatch(): void;
    prevMatch(): void;
    setContainer?(element: HTMLDivElement | null): void;
    navigateLink?(href: string): boolean;
}
