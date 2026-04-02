import type { PagesModel } from "./PagesModel";
import { isTextFileModel, TextFileModel } from "../../editors/text";

/**
 * PagesLayoutModel — Tab reordering, pinning, and grouping.
 */
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
        // Enforce pinned/unpinned boundary — cannot drag across sections
        const fromPinned = pages[fromIndex].pinned;
        const toPinned = pages[toIndex].pinned;
        if (fromPinned !== toPinned) return;
        const newPages = [...pages];
        const [movedPage] = newPages.splice(fromIndex, 1);
        newPages.splice(toIndex, 0, movedPage);
        this.model.state.update((s) => {
            s.pages = newPages;
        });
        this.fixGrouping();
        this.model.persistence.saveStateDebounced();
        this.model.onFocus.send(movedPage);
    };

    pinTab = (pageId: string) => {
        const { pages } = this.model.state.get();
        const pageIndex = pages.findIndex((p) => p.id === pageId);
        if (pageIndex === -1) return;
        const page = pages[pageIndex];
        if (page.pinned) return;

        // Calculate target BEFORE changing state (insert after existing pinned tabs)
        const pinnedCount = pages.filter((p) => p.pinned).length;

        page.pinned = true;

        if (pageIndex !== pinnedCount) {
            const newPages = [...pages];
            const [movedPage] = newPages.splice(pageIndex, 1);
            newPages.splice(pinnedCount, 0, movedPage);
            this.model.state.update((s) => {
                s.pages = newPages;
            });
        }

        this.model.persistence.saveStateDebounced();
    };

    unpinTab = (pageId: string) => {
        const { pages } = this.model.state.get();
        const pageIndex = pages.findIndex((p) => p.id === pageId);
        if (pageIndex === -1) return;
        const page = pages[pageIndex];
        if (!page.pinned) return;

        // Calculate target BEFORE changing state (insert after remaining pinned tabs)
        const remainingPinned = pages.filter(
            (p) => p.pinned && p !== page
        ).length;

        page.pinned = false;

        if (pageIndex !== remainingPinned) {
            const newPages = [...pages];
            const [movedPage] = newPages.splice(pageIndex, 1);
            newPages.splice(remainingPinned, 0, movedPage);
            this.model.state.update((s) => {
                s.pages = newPages;
            });
        }

        this.model.persistence.saveStateDebounced();
    };

    group = (leftPageId: string, rightPageId: string) => {
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

    ungroup = (pageId: string) => {
        const state = this.model.state.get();
        if (state.leftRight.has(pageId) || state.rightLeft.has(pageId)) {
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
            this.model.state.update((s) => {
                s.leftRight = newLeftRight;
                s.rightLeft = newRightLeft;
            });
            this.model.persistence.saveStateDebounced();
        }
    };

    groupTabs = (
        pageId1: string,
        pageId2: string,
        enforceAdjacency = false
    ) => {
        const state = this.model.state.get();
        const idx1 = state.pages.findIndex((p) => p.id === pageId1);
        const idx2 = state.pages.findIndex((p) => p.id === pageId2);
        if (idx1 === -1 || idx2 === -1 || idx1 === idx2) {
            return;
        }

        const isPinned1 = state.pages[idx1].pinned;
        const isPinned2 = state.pages[idx2].pinned;

        // Only enforce adjacency for unpinned-unpinned if explicitly requested
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
            // Non-adjacent grouping: just create the relationship
            if (idx1 < idx2) {
                this.group(pageId1, pageId2);
            } else {
                this.group(pageId2, pageId1);
            }
        }
    };

    fixGrouping = () => {
        const state = this.model.state.get();
        const toSwap: Array<[string, string]> = [];
        const toRemove = new Set<string>();
        const allIds = new Set<string>(state.pages.map((p) => p.id));

        // Check for swapped adjacent pairs (left/right reversed)
        for (let i = 0; i < state.pages.length - 1; i++) {
            const leftPageId = state.pages[i].id;
            const rightPageId = state.pages[i + 1].id;
            const groupedSwap = state.rightLeft.get(leftPageId);
            if (rightPageId === groupedSwap) {
                toSwap.push([leftPageId, rightPageId]);
            }
        }

        // Remove groupings where one or both pages no longer exist
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

        [...toRemove].forEach((pageId) => {
            this.ungroup(pageId);
        });
        toSwap.forEach(([leftPageId, rightPageId]) => {
            this.ungroup(leftPageId);
            this.ungroup(rightPageId);
            this.group(leftPageId, rightPageId);
        });

        this.fixCompareMode();
    };

    fixCompareMode = () => {
        // Access mainEditor for TextFileModel-specific compareMode
        const pages = this.model.state.get().pages;
        for (const page of pages) {
            const editor = page.mainEditor;
            if (editor && isTextFileModel(editor)) {
                const textEditor = editor as unknown as TextFileModel;
                if (
                    textEditor.state.get().compareMode &&
                    !this.model.query.isGrouped(page.id)
                ) {
                    textEditor.setCompareMode(false);
                }
            }
        }
    };
}
