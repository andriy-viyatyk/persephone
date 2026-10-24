import type { PagesModel } from "./PagesModel";
import type { PageModel } from "./PageModel";

export class PagesLayoutModel {
    constructor(private model: PagesModel) {}

    moveTab = (fromId: string, toId: string) => {
        const { pages } = this.model.state.get();
        const fromIndex = pages.findIndex((p) => p.id === fromId);
        const toIndex = pages.findIndex((p) => p.id === toId);
        this.moveTabByIndex(fromIndex, toIndex);
    };

    moveTabByIndex = (fromIndex: number, toIndex: number) => {
        if (fromIndex === -1 || toIndex === -1) return;
        const { pages } = this.model.state.get();
        if (!pages[fromIndex] || !pages[toIndex]) return;
        if (this.zone(pages[fromIndex].pinSide) !== this.zone(pages[toIndex].pinSide)) return;
        const newPages = [...pages];
        const [movedPage] = newPages.splice(fromIndex, 1);
        newPages.splice(toIndex, 0, movedPage);
        this.model.state.update((s) => {
            s.pages = newPages;
        });
        this.fixGrouping();
        this.model.persistence.saveStateDebounced();
        if (movedPage.pinSide !== "right") this.model.onFocus.send(movedPage);
    };

    private zone = (side: "left" | "right" | undefined): number =>
        side === "left" ? 0 : side === "right" ? 2 : 1;

    sortByPinSide = (pages: PageModel[]): PageModel[] => [
        ...pages.filter((page) => page.pinSide === "left"),
        ...pages.filter((page) => page.pinSide === undefined),
        ...pages.filter((page) => page.pinSide === "right"),
    ];

    pinTab = (pageId: string, side: "left" | "right" | undefined = "left") => {
        const { pages } = this.model.state.get();
        const pageIndex = pages.findIndex((p) => p.id === pageId);
        if (pageIndex === -1) return;
        const page = pages[pageIndex];
        if (page.pinSide === side) return;
        const wasRightPinned = this.model.query.isRightPinned(pageId);
        if (side === "right" && this.model.query.isGrouped(pageId)) this.ungroup(pageId);

        const wasActive = side === "right" && this.model.query.activePage === page;
        const remainingPages = pages.filter((candidate) => candidate !== page);
        if (wasRightPinned && side !== "right") this.model.closePopover();
        page.pinSide = side;
        let insertionIndex: number;
        if (side === "left") {
            insertionIndex = remainingPages.filter((candidate) => candidate.pinSide === "left").length;
        } else if (side === "right") {
            insertionIndex = remainingPages.length;
        } else {
            const firstRightIndex = remainingPages.findIndex((candidate) =>
                this.model.query.isRightPinned(candidate.id),
            );
            insertionIndex = firstRightIndex < 0 ? remainingPages.length : firstRightIndex;
        }
        remainingPages.splice(insertionIndex, 0, page);
        this.model.state.update((s) => {
            s.pages = remainingPages;
            if (side === "right") s.ordered = s.ordered.filter((candidate) => candidate !== page);
            else if (wasRightPinned) s.ordered.push(page);
        });
        if (wasRightPinned && side !== "right") {
            this.model.onShow.send(page);
            this.model.onFocus.send(page);
        }
        this.model.handleActivePageRemoved(wasActive);
        this.model.persistence.saveStateDebounced();
    };

    unpinTab = (pageId: string) => {
        const { pages } = this.model.state.get();
        const pageIndex = pages.findIndex((p) => p.id === pageId);
        if (pageIndex === -1) return;
        const page = pages[pageIndex];
        if (page.pinSide === undefined) return;
        this.pinTab(pageId, undefined);
    };

    group = (leftPageId: string, rightPageId: string) => {
        if (this.model.query.isRightPinned(leftPageId) || this.model.query.isRightPinned(rightPageId)) {
            throw new Error("Right-pinned pages cannot be grouped.");
        }
        this.ungroup(leftPageId);
        this.ungroup(rightPageId);
        const state = this.model.state.get();
        const newLeftRight = new Map(state.leftRight);
        const newRightLeft = new Map(state.rightLeft);
        newLeftRight.set(leftPageId, rightPageId);
        newRightLeft.set(rightPageId, leftPageId);
        this.model.state.update((s) => {
            s.leftRight = newLeftRight;
            s.rightLeft = newRightLeft;
        });
        this.model.persistence.saveStateDebounced();
    };

    /**
     * Ungroup the pair containing `pageId`. Walkthrough 06 / CK7: also drops
     * any `compareGroups` entry for the pair so compare-mode exits when the
     * grouping ends.
     */
    ungroup = (pageId: string) => {
        const state = this.model.state.get();
        if (!state.leftRight.has(pageId) && !state.rightLeft.has(pageId)) return;

        const newLeftRight = new Map(state.leftRight);
        const newRightLeft = new Map(state.rightLeft);
        const rightId = newLeftRight.get(pageId);
        const leftId = newRightLeft.get(pageId);
        newLeftRight.delete(pageId);
        newRightLeft.delete(pageId);
        if (leftId) {
            newLeftRight.delete(leftId);
        }
        if (rightId) {
            newRightLeft.delete(rightId);
        }
        // Identify the leftId of the pair (whichever direction `pageId` was in).
        const pairLeftId = state.leftRight.has(pageId) ? pageId : leftId;
        const nextCompareGroups = new Set(state.compareGroups);
        if (pairLeftId) nextCompareGroups.delete(pairLeftId);

        this.model.state.update((s) => {
            s.leftRight = newLeftRight;
            s.rightLeft = newRightLeft;
            s.compareGroups = nextCompareGroups;
        });
        this.model.persistence.saveStateDebounced();
    };

    groupTabs = (
        id1: string,
        id2: string,
        enforceAdjacency = false
    ) => {
        const state = this.model.state.get();
        const pageId1 = this.model.query.findPage(id1)?.id ?? id1;
        const pageId2 = this.model.query.findPage(id2)?.id ?? id2;
        const idx1 = state.pages.findIndex((p) => p.id === pageId1);
        const idx2 = state.pages.findIndex((p) => p.id === pageId2);
        if (this.model.query.isRightPinned(pageId1) || this.model.query.isRightPinned(pageId2)) {
            throw new Error("Right-pinned pages cannot be grouped.");
        }
        if (idx1 === -1 || idx2 === -1 || idx1 === idx2) {
            return;
        }

        const isPinned1 = state.pages[idx1].pinSide === "left";
        const isPinned2 = state.pages[idx2].pinSide === "left";

        if (enforceAdjacency && !isPinned1 && !isPinned2) {
            const doMove = Math.abs(idx1 - idx2) !== 1;
            if (idx1 < idx2) {
                doMove && this.moveTabByIndex(idx2, idx1 + 1);
                this.group(pageId1, pageId2);
            } else {
                doMove && this.moveTabByIndex(idx2, idx1 - 1);
                this.group(pageId2, pageId1);
            }
        } else {
            if (idx1 < idx2) {
                this.group(pageId1, pageId2);
            } else {
                this.group(pageId2, pageId1);
            }
        }
    };

    /**
     * Sanity sweep — fix swapped pairs and drop dangling groups. Called from
     * `removePage` and `moveTabByIndex`.
     *
     * Walkthrough 07 / GK3: kept as single sweep. CK7: no trailing
     * `fixCompareMode()` call — `ungroup`'s own compareGroups cleanup covers it.
     */
    fixGrouping = () => {
        const state = this.model.state.get();
        const toSwap: Array<[string, string]> = [];
        const toRemove = new Set<string>();
        const allIds = new Set<string>(state.pages.map((p) => p.id));

        for (let i = 0; i < state.pages.length - 1; i++) {
            const leftPageId = state.pages[i].id;
            const rightPageId = state.pages[i + 1].id;
            const groupedSwap = state.rightLeft.get(leftPageId);
            if (rightPageId === groupedSwap) {
                toSwap.push([leftPageId, rightPageId]);
            }
        }

        for (const leftId of state.leftRight.keys()) {
            if (!allIds.has(leftId)) {
                toRemove.add(leftId);
            }
        }
        for (const rightId of state.rightLeft.keys()) {
            if (!allIds.has(rightId)) {
                toRemove.add(rightId);
            }
        }

        for (const [leftId, rightId] of state.leftRight) {
            if (this.model.query.isRightPinned(leftId) || this.model.query.isRightPinned(rightId)) {
                toRemove.add(leftId);
            }
        }
        for (const [rightId, leftId] of state.rightLeft) {
            if (this.model.query.isRightPinned(rightId) || this.model.query.isRightPinned(leftId)) {
                toRemove.add(rightId);
            }
        }

        [...toRemove].forEach((pageId) => {
            this.ungroup(pageId);
        });
        toSwap.forEach(([leftPageId, rightPageId]) => {
            if (this.model.query.isRightPinned(leftPageId) || this.model.query.isRightPinned(rightPageId)) return;
            this.ungroup(leftPageId);
            this.ungroup(rightPageId);
            this.group(leftPageId, rightPageId);
        });
    };

    // ── Compare mode (walkthrough 06 / CK4) ────────────────────────────

    /**
     * Activate compare mode for the pair containing `pageId`. Accepts either
     * the left or right page id; resolves the leftId via `leftRight`/`rightLeft`.
     * Returns true if compare mode was entered (precondition satisfied),
     * false otherwise.
     */
    enterCompareMode = (pageId: string): boolean => {
        const state = this.model.state.get();
        const resolvedPageId = this.model.query.findPage(pageId)?.id ?? pageId;

        // Resolve leftId.
        let leftId: string | undefined;
        let rightId: string | undefined;
        if (state.leftRight.has(resolvedPageId)) {
            leftId = resolvedPageId;
            rightId = state.leftRight.get(resolvedPageId);
        } else if (state.rightLeft.has(resolvedPageId)) {
            leftId = state.rightLeft.get(resolvedPageId);
            rightId = resolvedPageId;
        }

        if (!leftId || !rightId) return false;
        if (!this.model.query.canCompare(leftId, rightId)) return false;

        const nextCompareGroups = new Set(state.compareGroups);
        nextCompareGroups.add(leftId);
        this.model.state.update((s) => { s.compareGroups = nextCompareGroups; });
        return true;
    };

    /**
     * Exit compare mode for the pair containing `pageId`. Accepts either side.
     */
    exitCompareMode = (pageId: string): void => {
        const state = this.model.state.get();
        const resolvedPageId = this.model.query.findPage(pageId)?.id ?? pageId;
        let leftId: string | undefined;
        if (state.leftRight.has(resolvedPageId)) {
            leftId = resolvedPageId;
        } else if (state.rightLeft.has(resolvedPageId)) {
            leftId = state.rightLeft.get(resolvedPageId);
        }
        if (!leftId) return;
        if (!state.compareGroups.has(leftId)) return;
        const nextCompareGroups = new Set(state.compareGroups);
        nextCompareGroups.delete(leftId);
        this.model.state.update((s) => { s.compareGroups = nextCompareGroups; });
    };
}
