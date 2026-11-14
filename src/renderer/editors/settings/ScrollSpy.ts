import type { SettingsLayoutSection } from "./SettingsLayoutModel";

interface PendingProgrammaticScroll {
    readonly selectionValue: string;
    readonly sectionId: string;
    readonly targetWrapper: HTMLDivElement;
    lastScrollTop: number;
    stableFrameCount: number;
}

interface SettingsNavigationTarget {
    readonly sectionId: string;
    readonly wrapper: HTMLDivElement;
}

const SCROLL_GEOMETRY_TOLERANCE = 2;

export class ScrollSpy {
    private pendingProgrammaticScroll: PendingProgrammaticScroll | undefined;
    private programmaticSettleFrame: number | undefined;

    public constructor(
        private readonly panelsElement: () => HTMLDivElement | undefined,
        private readonly sections: () => readonly SettingsLayoutSection[],
        private readonly wrapperForSection: (sectionId: string) => HTMLDivElement | undefined,
        private readonly isNavigableSection: (sectionId: string) => boolean,
        private readonly onActiveChange: (selectionValue: string, force?: boolean) => void,
        private readonly onPendingSectionInvalidated: () => void,
    ) {}

    public scrollTo(selectionValue: string, target: SettingsNavigationTarget): void {
        const panels = this.panelsElement();
        if (!panels) return;

        this.cancelProgrammaticScroll();
        this.pendingProgrammaticScroll = {
            selectionValue,
            sectionId: target.sectionId,
            targetWrapper: target.wrapper,
            lastScrollTop: panels.scrollTop,
            stableFrameCount: 0,
        };
        target.wrapper.scrollIntoView({ behavior: "instant", block: "start", inline: "nearest" });
        this.queueProgrammaticSettleCheck();
    }

    public handleScroll(): void {
        if (this.pendingProgrammaticScroll) {
            this.queueProgrammaticSettleCheck();
            return;
        }
        this.updateSelectionFromScroll();
    }

    public cancelProgrammaticScroll(): void {
        if (this.programmaticSettleFrame !== undefined) {
            cancelAnimationFrame(this.programmaticSettleFrame);
            this.programmaticSettleFrame = undefined;
        }
        this.pendingProgrammaticScroll = undefined;
    }

    public cancelIfSectionNotNavigable(): void {
        if (this.pendingProgrammaticScroll && !this.isNavigableSection(this.pendingProgrammaticScroll.sectionId)) {
            this.cancelProgrammaticScroll();
        }
    }

    public dispose(): void {
        this.cancelProgrammaticScroll();
    }

    private queueProgrammaticSettleCheck(): void {
        if (!this.pendingProgrammaticScroll || this.programmaticSettleFrame !== undefined) return;
        this.programmaticSettleFrame = requestAnimationFrame(() => {
            this.programmaticSettleFrame = undefined;
            this.checkProgrammaticScrollSettled();
        });
    }

    private checkProgrammaticScrollSettled(): void {
        const pending = this.pendingProgrammaticScroll;
        const panels = this.panelsElement();
        if (!pending || !panels) return;
        if (!this.isNavigableSection(pending.sectionId)) {
            this.cancelProgrammaticScroll();
            this.onPendingSectionInvalidated();
            return;
        }

        const currentScrollTop = panels.scrollTop;
        if (currentScrollTop === pending.lastScrollTop) pending.stableFrameCount++;
        else pending.stableFrameCount = 0;
        pending.lastScrollTop = currentScrollTop;

        if (pending.stableFrameCount < 2 || !this.isProgrammaticTargetSettled(pending)) {
            this.queueProgrammaticSettleCheck();
            return;
        }

        this.pendingProgrammaticScroll = undefined;
        this.onActiveChange(pending.selectionValue, true);
    }

    private isProgrammaticTargetSettled(pending: PendingProgrammaticScroll): boolean {
        const panels = this.panelsElement();
        if (!panels) return false;
        const viewport = panels.getBoundingClientRect();
        const target = pending.targetWrapper.getBoundingClientRect();
        const aligned = Math.abs(target.top - viewport.top) <= SCROLL_GEOMETRY_TOLERANCE;
        const maximumScrollTop = Math.max(0, panels.scrollHeight - panels.clientHeight);
        const atBottom = Math.abs(panels.scrollTop - maximumScrollTop) <= SCROLL_GEOMETRY_TOLERANCE;
        const targetIsVisible = target.bottom > viewport.top && target.top < viewport.bottom;
        const isFinalTarget = this.lastNavigableSectionId() === pending.sectionId;
        return aligned || (atBottom && isFinalTarget && targetIsVisible);
    }

    private updateSelectionFromScroll(): void {
        const sectionId = this.topmostVisibleSectionId();
        if (!sectionId) return;
        this.onActiveChange(`section:${sectionId}`);
    }

    private topmostVisibleSectionId(): string | undefined {
        const panels = this.panelsElement();
        if (!panels) return undefined;
        const viewport = panels.getBoundingClientRect();
        let firstVisibleSectionId: string | undefined;
        for (const section of this.sections()) {
            if (!this.isNavigableSection(section.id)) continue;
            const wrapper = this.wrapperForSection(section.id);
            if (!wrapper) continue;
            const rect = wrapper.getBoundingClientRect();
            if (rect.bottom > viewport.top && rect.top < viewport.bottom) {
                firstVisibleSectionId = section.id;
                break;
            }
        }

        const maximumScrollTop = Math.max(0, panels.scrollHeight - panels.clientHeight);
        const atBottom = Math.abs(panels.scrollTop - maximumScrollTop) <= SCROLL_GEOMETRY_TOLERANCE;
        return atBottom ? this.lastNavigableSectionId() ?? firstVisibleSectionId : firstVisibleSectionId;
    }

    private lastNavigableSectionId(): string | undefined {
        const sections = this.sections();
        for (let index = sections.length - 1; index >= 0; index--) {
            const section = sections[index];
            if (this.isNavigableSection(section.id)) return section.id;
        }
        return undefined;
    }
}
