import type { Cleanup } from "../../core/utils/DisposableStore";
import { TComponentState } from "../../core/state/state";
import { ComponentQueue } from "../../core/state/ComponentQueue";
import { MarkdownSearchState } from "./MarkdownSearchState";

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

const DEFAULT_BODY_STATE: MarkdownBodyState = {
    compactMode: false,
    searchVisible: false,
    searchText: "",
    currentMatchIndex: 0,
    totalMatches: 0,
};

const DEFAULT_HOST_STATE: MarkdownBodyHostState = {
    content: "",
    filePath: undefined,
    title: "",
};

export interface StandaloneMarkdownBodyModel {
    readonly model: MarkdownBodyModel;
    readonly hostState: TComponentState<MarkdownBodyHostState>;
    reset(): void;
    dispose(): void;
}

export function createStandaloneMarkdownBodyModel(
    followLink: (href: string) => boolean,
): StandaloneMarkdownBodyModel {
    const bodyState = new TComponentState<MarkdownBodyState>({ ...DEFAULT_BODY_STATE });
    const hostState = new TComponentState<MarkdownBodyHostState>({ ...DEFAULT_HOST_STATE });
    const queue = new ComponentQueue<MarkdownQueueEvent, MarkdownQueueRequest>();
    const searchState = new MarkdownSearchState(bodyState);
    const model: MarkdownBodyModel = {
        state: bodyState,
        host: { state: hostState },
        typedQueue: queue,
        page: undefined,
        openSearch: () => searchState.open(),
        closeSearch: () => searchState.close(),
        setSearchText: text => searchState.setText(text),
        setMatchCount: count => searchState.setMatchCount(count),
        nextMatch: () => searchState.next(),
        prevMatch: () => searchState.prev(),
        followLink,
    };

    return {
        model,
        hostState,
        reset: () => {
            bodyState.set({ ...DEFAULT_BODY_STATE });
            hostState.set({ ...DEFAULT_HOST_STATE });
        },
        dispose: () => queue.dispose(),
    };
}
