import React from "react";
import { ContentViewModel } from "../base/ContentViewModel";
import { IContentHost } from "../base/IContentHost";
import { EditorModel } from "../base";
import { pagesModel } from "../../api/pages";
import type { PageModel } from "../../api/pages/PageModel";

// =============================================================================
// State
// =============================================================================

export const defaultMarkdownViewState = {
    container: null as HTMLDivElement | null,
    compactMode: false,
    searchVisible: false,
    searchText: "",
    currentMatchIndex: 0,
    totalMatches: 0,
};

export type MarkdownViewState = typeof defaultMarkdownViewState;

// =============================================================================
// ViewModel
// =============================================================================

/**
 * ViewModel for the markdown editor page shell.
 *
 * Manages search state, compact mode, scroll restoration, and focus events.
 * DOM-level search operations (match counting, highlight navigation) are
 * delegated to MarkdownBlock via its imperative handle — the MarkdownView
 * component bridges this ViewModel's state with the MarkdownBlock handle.
 */
export class MarkdownViewModel extends ContentViewModel<MarkdownViewState> {
    containerScrollTop = 0;

    constructor(host: IContentHost) {
        super(host, defaultMarkdownViewState);
    }

    get pageModel() {
        return this.host as unknown as EditorModel;
    }

    // =========================================================================
    // Lifecycle
    // =========================================================================

    protected onInit(): void {
        // Scroll restoration on page focus
        const sub = pagesModel.onFocus.subscribe(this.pageFocused);
        this.addSubscription(() => sub.unsubscribe());
    }

    protected onContentChanged(): void {
        // No-op — MarkdownBlock handles re-rendering via props
    }

    // =========================================================================
    // Container & Scroll
    // =========================================================================

    setContainer = (el: HTMLDivElement | null) => {
        this.state.update((s) => {
            s.container = el;
        });
    };

    pageFocused = (page?: PageModel) => {
        if (
            page === this.pageModel.page ||
            pagesModel.activePage === this.pageModel.page
        ) {
            Promise.resolve().then(() => {
                const container = this.state.get().container;
                if (container) container.scrollTop = this.containerScrollTop;
            });
        }
    };

    containerScroll = (e: React.UIEvent<HTMLDivElement>) => {
        this.containerScrollTop = e.currentTarget?.scrollTop ?? 0;
    };

    // =========================================================================
    // Compact Mode
    // =========================================================================

    toggleCompact = () => {
        this.state.update((s) => {
            s.compactMode = !s.compactMode;
        });
    };

    // =========================================================================
    // Search
    // =========================================================================

    openSearch = () => {
        this.state.update((s) => {
            s.searchVisible = true;
        });
    };

    closeSearch = () => {
        this.state.update((s) => {
            s.searchVisible = false;
            s.searchText = "";
            s.currentMatchIndex = 0;
            s.totalMatches = 0;
        });
    };

    setSearchText = (text: string) => {
        this.state.update((s) => {
            s.searchText = text;
            s.currentMatchIndex = 0;
        });
    };

    nextMatch = () => {
        const { totalMatches, currentMatchIndex } = this.state.get();
        if (totalMatches === 0) return;
        const newIndex = (currentMatchIndex + 1) % totalMatches;
        this.state.update((s) => {
            s.currentMatchIndex = newIndex;
        });
    };

    prevMatch = () => {
        const { totalMatches, currentMatchIndex } = this.state.get();
        if (totalMatches === 0) return;
        const newIndex = (currentMatchIndex - 1 + totalMatches) % totalMatches;
        this.state.update((s) => {
            s.currentMatchIndex = newIndex;
        });
    };
}

// =============================================================================
// Factory
// =============================================================================

export function createMarkdownViewModel(host: IContentHost): MarkdownViewModel {
    return new MarkdownViewModel(host);
}
