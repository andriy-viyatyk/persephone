import type { MarkdownBodyState } from "./MarkdownBodyModel";

interface MarkdownSearchFields {
    searchVisible: boolean;
    searchText: string;
    currentMatchIndex: number;
    totalMatches: number;
}

interface MarkdownSearchStateAccess<T extends MarkdownSearchFields> {
    get(): T;
    update(updater: (state: T) => void): void;
}

/** Owns the shared Markdown find-bar state transitions for editor and standalone bodies. */
export class MarkdownSearchState<T extends MarkdownBodyState> {
    public constructor(private readonly state: MarkdownSearchStateAccess<T>) {}

    open(): void {
        this.state.update(state => {
            state.searchVisible = true;
        });
    }

    close(): void {
        this.state.update(state => {
            state.searchVisible = false;
            state.searchText = "";
            state.currentMatchIndex = 0;
            state.totalMatches = 0;
        });
    }

    setText(text: string): void {
        this.state.update(state => {
            state.searchText = text;
            state.currentMatchIndex = 0;
        });
    }

    setMatchCount(count: number): void {
        this.state.update(state => {
            const newIndex = count > 0 && state.currentMatchIndex >= count
                ? 0
                : state.currentMatchIndex;
            state.totalMatches = count;
            state.currentMatchIndex = newIndex;
        });
    }

    next(): void {
        const { totalMatches, currentMatchIndex } = this.state.get();
        if (totalMatches === 0) return;
        this.state.update(state => {
            state.currentMatchIndex = (currentMatchIndex + 1) % totalMatches;
        });
    }

    prev(): void {
        const { totalMatches, currentMatchIndex } = this.state.get();
        if (totalMatches === 0) return;
        this.state.update(state => {
            state.currentMatchIndex = (currentMatchIndex - 1 + totalMatches) % totalMatches;
        });
    }
}
