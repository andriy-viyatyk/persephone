import { AppPageManagerView, type AppPageManagerProps } from "../../components/page-manager/AppPageManagerView";
import { pagesModel } from "../../api/pages";
import type { OpenFilesState } from "../../api/pages/PagesModel";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import { PageContentView } from "./PageContentView";
import "./Pages.css";

type PagesProjection = Pick<OpenFilesState, "pages" | "ordered" | "leftRight" | "rightLeft" | "compareGroups" | "popoverPageId">;
type PagePopoverSize = { width: number; height: number };

export class PagesView extends VanillaView<object> {
    private readonly manager: AppPageManagerView;
    private popoverId: string | undefined;
    private popoverListenersActive = false;
    private activeElementFrame: number | undefined;
    private readonly onPopoverPointerDown = (event: PointerEvent): void => {
        this.closeForHostTarget(event.target);
    };
    private readonly onPopoverFocusIn = (event: FocusEvent): void => {
        this.scheduleActiveElementCheck();
        this.closeForHostTarget(event.target);
    };
    private readonly onPopoverWindowBlur = (): void => this.scheduleActiveElementCheck();
    private readonly onPopoverKeyDown = (event: KeyboardEvent): void => {
        if (event.key === "Escape" && !event.defaultPrevented) pagesModel.closePopover();
    };

    public constructor(props: object) {
        const projection = PagesView.selectState(pagesModel.state.get());
        const manager = new AppPageManagerView(PagesView.managerProps(projection));
        super(props, manager.root);
        this.manager = this.child(manager);
        this.popoverId = projection.popoverPageId;
    }

    protected onMount(): void {
        this.manager.mount();
        this.bind(
            pagesModel.state,
            PagesView.selectState,
            (projection) => this.applyProjection(projection),
        );
        this.own(() => this.setPopoverListeners(false));
    }

    private static selectState(state: OpenFilesState): PagesProjection {
        return {
            pages: state.pages,
            ordered: state.ordered,
            leftRight: state.leftRight,
            rightLeft: state.rightLeft,
            compareGroups: state.compareGroups,
            popoverPageId: state.popoverPageId,
        };
    }

    private static managerProps(projection: PagesProjection): AppPageManagerProps {
        const activePage = projection.ordered[projection.ordered.length - 1];
        const groupedActiveId = activePage
            ? pagesModel.query.getGroupedPage(activePage.id)?.id
            : undefined;
        const popoverPage = projection.pages.find((page) => page.id === projection.popoverPageId);
        return {
            pageIds: projection.pages.map((page) => page.id),
            activeId: activePage?.id ?? "",
            groupedActiveId,
            grouping: projection.leftRight,
            compareModeIds: projection.compareGroups,
            rightPinnedIds: new Set(projection.pages
                .filter((page) => pagesModel.query.isRightPinned(page.id))
                .map((page) => page.id)),
            popoverId: projection.popoverPageId,
            popoverSize: popoverPage?.popoverSize,
            onPopoverResize: (id, fractions) => PagesView.savePopoverSize(id, fractions),
            pageView: PageContentView,
        };
    }

    private static savePopoverSize(id: string, fractions: PagePopoverSize): void {
        const page = pagesModel.state.get().pages.find((candidate) => candidate.id === id);
        if (page) page.popoverSize = fractions;
    }

    private applyProjection(projection: PagesProjection): void {
        const previousPopoverId = this.popoverId;
        const nextPopoverId = projection.popoverPageId;
        this.manager.update(PagesView.managerProps(projection));
        this.popoverId = nextPopoverId;
        this.setPopoverListeners(nextPopoverId !== undefined);

        if (previousPopoverId === nextPopoverId) return;
        const focusedPage = nextPopoverId
            ? projection.pages.find((page) => page.id === nextPopoverId)
            : pagesModel.query.activePage;
        if (focusedPage) pagesModel.onFocus.send(focusedPage);
    }

    private setPopoverListeners(active: boolean): void {
        if (active === this.popoverListenersActive) return;
        this.popoverListenersActive = active;
        if (active) {
            document.addEventListener("pointerdown", this.onPopoverPointerDown);
            document.addEventListener("focusin", this.onPopoverFocusIn);
            document.addEventListener("keydown", this.onPopoverKeyDown);
            window.addEventListener("blur", this.onPopoverWindowBlur);
            return;
        }

        document.removeEventListener("pointerdown", this.onPopoverPointerDown);
        document.removeEventListener("focusin", this.onPopoverFocusIn);
        document.removeEventListener("keydown", this.onPopoverKeyDown);
        window.removeEventListener("blur", this.onPopoverWindowBlur);
        if (this.activeElementFrame !== undefined) {
            window.cancelAnimationFrame(this.activeElementFrame);
            this.activeElementFrame = undefined;
        }
    }

    private closeForHostTarget(target: EventTarget | null): void {
        if (!(target instanceof Node)) return;
        const appRoot = this.root.closest(".app-root");
        if (!appRoot || !appRoot.contains(target)) return;
        const popoverSlot = this.popoverId
            ? this.manager.getSlotElement(this.popoverId)
            : undefined;
        const rightPageTabs = appRoot.querySelector('[data-name="right-page-tabs"]');
        if (popoverSlot?.contains(target) || rightPageTabs?.contains(target)) return;
        pagesModel.closePopover();
    }

    private scheduleActiveElementCheck(): void {
        if (this.activeElementFrame !== undefined || !this.popoverId) return;
        this.activeElementFrame = window.requestAnimationFrame(() => {
            this.activeElementFrame = undefined;
            const activeElement = document.activeElement;
            if (!(activeElement instanceof HTMLElement)) return;
            const tagName = activeElement.tagName.toLowerCase();
            if (tagName !== "iframe" && tagName !== "webview") return;
            this.closeForHostTarget(activeElement);
        });
    }
}
