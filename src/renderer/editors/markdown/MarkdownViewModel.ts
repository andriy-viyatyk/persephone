import React from "react";
import { ContentViewModel } from "../base/ContentViewModel";
import { IContentHost } from "../base/IContentHost";
import { TextFileModel } from "../text/TextPageModel";
import { PageModel } from "../base";
import { pagesModel } from "../../api/pages";

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

export class MarkdownViewModel extends ContentViewModel<MarkdownViewState> {
    containerScrollTop = 0;

    constructor(host: IContentHost) {
        super(host, defaultMarkdownViewState);
    }

    get pageModel(): TextFileModel {
        return this.host as unknown as TextFileModel;
    }

    // =========================================================================
    // Lifecycle
    // =========================================================================

    private _searchTimer: ReturnType<typeof setTimeout> | undefined;

    protected onInit(): void {
        // Scroll restoration on page focus
        const sub = pagesModel.onFocus.subscribe(this.pageFocused);
        this.addSubscription(() => sub.unsubscribe());

        // Search highlight update when search state changes
        let lastSearchText = "";
        let lastSearchVisible = false;

        const unsubState = this.state.subscribe(() => {
            const { searchText, searchVisible } = this.state.get();
            if (searchText !== lastSearchText || searchVisible !== lastSearchVisible) {
                lastSearchText = searchText;
                lastSearchVisible = searchVisible;
                this.scheduleSearchUpdate();
            }
        });
        this.addSubscription(unsubState);

        this.addSubscription(() => clearTimeout(this._searchTimer));
    }

    protected onContentChanged(): void {
        // Content changed — re-evaluate search highlights if search is active
        this.scheduleSearchUpdate();
    }

    private scheduleSearchUpdate() {
        const { searchVisible, searchText } = this.state.get();
        if (searchVisible && searchText) {
            clearTimeout(this._searchTimer);
            this._searchTimer = setTimeout(() => this.updateMatchNavigation(), 0);
        }
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
            page === this.pageModel ||
            pagesModel.activePage === this.pageModel
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
        this.clearActiveMatchClass();
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
        this.navigateToMatch(newIndex);
    };

    prevMatch = () => {
        const { totalMatches, currentMatchIndex } = this.state.get();
        if (totalMatches === 0) return;
        const newIndex = (currentMatchIndex - 1 + totalMatches) % totalMatches;
        this.state.update((s) => {
            s.currentMatchIndex = newIndex;
        });
        this.navigateToMatch(newIndex);
    };

    /** Called after render to update match count and highlight the active match */
    updateMatchNavigation = () => {
        const { container, searchText, searchVisible } = this.state.get();
        if (!container || !searchText || !searchVisible) {
            if (this.state.get().totalMatches !== 0) {
                this.state.update((s) => { s.totalMatches = 0; });
            }
            return;
        }

        const spans = container.querySelectorAll(".highlighted-text");
        const total = spans.length;
        const { totalMatches, currentMatchIndex } = this.state.get();

        // Clamp index if matches changed
        let index = currentMatchIndex;
        if (total > 0 && index >= total) {
            index = 0;
        }

        if (total !== totalMatches || index !== currentMatchIndex) {
            this.state.update((s) => {
                s.totalMatches = total;
                s.currentMatchIndex = index;
            });
        }

        this.applyActiveMatchClass(spans, index);
        if (total > 0) {
            this.scrollToActiveMatch();
        }
    };

    private navigateToMatch(index: number) {
        const container = this.state.get().container;
        if (!container) return;
        const spans = container.querySelectorAll(".highlighted-text");
        this.applyActiveMatchClass(spans, index);
        this.scrollToActiveMatch();
    }

    private clearActiveMatchClass() {
        const container = this.state.get().container;
        if (!container) return;
        const active = container.querySelector(".highlighted-text-active");
        if (active) active.classList.remove("highlighted-text-active");
    }

    private applyActiveMatchClass(spans: NodeListOf<Element>, index: number) {
        // Remove old active class
        const container = this.state.get().container;
        if (!container) return;
        const oldActive = container.querySelector(".highlighted-text-active");
        if (oldActive) oldActive.classList.remove("highlighted-text-active");

        // Apply to current
        if (spans.length > 0 && index < spans.length) {
            spans[index].classList.add("highlighted-text-active");
        }
    }

    private scrollToActiveMatch() {
        // Use microtask so the DOM class is applied first
        Promise.resolve().then(() => {
            const container = this.state.get().container;
            if (!container) return;
            const active = container.querySelector(".highlighted-text-active");
            if (active) {
                active.scrollIntoView({ block: "center", behavior: "smooth" });
            }
        });
    }
}

// =============================================================================
// Factory
// =============================================================================

export function createMarkdownViewModel(host: IContentHost): MarkdownViewModel {
    return new MarkdownViewModel(host);
}
