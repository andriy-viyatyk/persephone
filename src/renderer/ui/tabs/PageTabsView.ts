import { t } from "../../../shared/i18n/t";
import { app } from "../../api/app";
import { pages } from "../../api/pages";
import { settings } from "../../api/settings";
import type { AppSettingsKey } from "../../api/settings-schema";
import { createLinkData } from "../../../shared/link-data";
import { encodePersephoneBoardLink } from "../../content/persephone-board-link";
import { fpBasename } from "../../core/utils/file-path";
import { createBoardGlyphElement } from "../../editors/board/board-glyph-element";
import { subscribeBoardIconChanges } from "../../editors/board/board-icon-cache";
import { boardDisplayText, boardMetadataKeys, ensureBoardDisplayText, onBoardDisplayTextChanged } from "../../api/boards/board-display-text";
import { readBoardManifest } from "../../api/boards/board-manifest-io";
import { type NormalizedBoardManifest } from "../../../shared/board/board-manifest-schema";
import type { EditorModel } from "../../editors/base";
import { IconButtonView } from "../../uikit/IconButton/IconButtonView";
import { SplitButtonView } from "../../uikit/SplitButton/SplitButtonView";
import { PopoverView } from "../../uikit/Popover/PopoverView";
import { KeyedList } from "../../uikit/shared/keyed-list";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import type { IState } from "../../core/state/state";
import type { MenuItem } from "../../uikit/Menu/types";
import { getCreatableItemLabel, getCreatableItems } from "../../api/creatable-items";
import { editorCategories } from "../../api/editor-categories";
import { createCreatableItemIcon } from "../sidebar/creatable-item-icon";
import { minTabWidth, pinnedTabEncryptedWidth, pinnedTabWidth } from "./PageTab";
import { PageTabView } from "./PageTabView";
import type { PageModel } from "../../api/pages/PageModel";
import "./PageTabs.css";
import { EditorCategoriesPopoverView } from "./EditorCategoriesPopoverView";
import { appWindow } from "../../api/window";
import { boardRegistry } from "../../api/boards/board-registry";

interface TabProjection {
    pages: PageModel[];
    activeId: string | undefined;
}

interface PageLayoutSubscription {
    page: PageModel;
    editor: EditorModel | null;
    release: () => void;
}

export class PageTabsView extends VanillaView<object> {
    private readonly wrapper = document.createElement("div");
    private readonly scrollLeftButton: IconButtonView;
    private readonly scrollRightButton: IconButtonView;
    private readonly addButton: SplitButtonView;
    private readonly tabViews = new WeakMap<HTMLElement, PageTabView>();
    private readonly tabs: KeyedList<PageModel, string, HTMLElement>;
    private readonly pageLayoutSubscriptions = new Map<string, PageLayoutSubscription>();
    private resizeObserver: ResizeObserver | undefined;
    private showScrollButtons = false;
    private currentPages: PageModel[] = [];
    private readonly warmedBoardRoots = new Set<string>();
    private readonly boardManifests = new Map<string, NormalizedBoardManifest>();
    private categoryPopover: PopoverView | undefined;

    public constructor(props: object) {
        super(props);
        this.wrapper.className = "tabs-wrapper";
        this.wrapper.dataset.name = "page-tabs-wrapper";
        this.scrollLeftButton = new IconButtonView({
            name: "page-tabs-scroll-left",
            size: "sm",
            icon: "arrow-left",
            onClick: () => this.scrollLeft(),
        });
        this.scrollRightButton = new IconButtonView({
            name: "page-tabs-scroll-right",
            size: "sm",
            icon: "arrow-right",
            onClick: () => this.scrollRight(),
        });
        this.addButton = new SplitButtonView({
            name: "page-tabs-add",
            size: "md",
            title: t("shell.addPageCtrlN", { shortcut: "Ctrl+N" }),
            icon: "plus",
            onClick: () => pages.lifecycle.addEmptyPage(),
            menuTitle: "New editor page",
            items: [],
            onOpenMenu: (anchor) => this.openCategoryPopover(anchor),
        });
        this.tabs = new KeyedList<PageModel, string, HTMLElement>(this.wrapper, {
            keyOf: (page) => page.id,
            create: (page) => this.createTab(page),
            update: (element, page) => this.updateTab(element, page),
            remove: (element) => this.removeTab(element),
        });
    }

    protected onMount(): void {
        this.root.dataset.type = "page-tabs";
        this.root.dataset.name = "page-tabs";
        this.root.className = "page-tabs";
        // A board window opens only the pages its board asks for; new custom pages belong in a
        // normal Persephone window, so board mode has no new-page button.
        this.root.append(this.wrapper);
        if (!appWindow.isBoardMode) this.root.append(this.addButton.root);

        this.child(this.scrollLeftButton).mount();
        this.child(this.scrollRightButton).mount();
        this.child(this.addButton).mount();
        this.listen(this.wrapper, "wheel", (event) => this.handleWheel(event), { passive: false });
        this.resizeObserver = new ResizeObserver(() => this.checkScrollButtons());
        this.resizeObserver.observe(this.wrapper);
        this.own(() => this.resizeObserver?.disconnect());
        this.own(() => this.tabs.dispose());
        this.own(() => {
            for (const subscription of this.pageLayoutSubscriptions.values()) subscription.release();
            this.pageLayoutSubscriptions.clear();
        });
        const settingsKeys = ["browser-profiles", "editor-categories"] as const satisfies readonly AppSettingsKey[];
        const settingsSubscriptions = settingsKeys.map((key) => settings.watch(key, () => this.updateAddMenu()));
        this.own(() => settingsSubscriptions.forEach((dispose) => dispose()));
        this.own(boardRegistry.subscribeMembership(() => this.updateAddMenu()));
        this.own(subscribeBoardIconChanges(() => this.updateAddMenu()));
        this.own(onBoardDisplayTextChanged((_root, reason) => {
            if (reason === "invalidate") this.warmedBoardRoots.clear();
            this.updateAddMenu();
        }));
        this.bind(
            pages.state,
            (state): TabProjection => ({
                pages: state.pages,
                activeId: state.ordered[state.ordered.length - 1]?.id,
            }),
            (projection) => this.updateTabs(projection),
        );
        this.updateAddMenu();
        this.checkScrollButtons();
    }

    protected onUpdate(): void {
        this.updateAddMenu();
    }

    private createTab(page: PageModel): HTMLElement {
        const view = new PageTabView({ model: page, mode: "main", pinnedLeft: this.pinnedLeft(page, this.currentPages) });
        this.tabViews.set(view.root, view);
        this.child(view).mount();
        return view.root;
    }

    private updateTab(element: HTMLElement, page: PageModel): void {
        this.tabViews.get(element)?.update({
            model: page,
            mode: "main",
            pinnedLeft: this.pinnedLeft(page, this.currentPages),
        });
    }

    private removeTab(element: HTMLElement): void {
        const view = this.tabViews.get(element);
        if (!view) return;
        view.dispose();
        this.tabViews.delete(element);
    }

    private updateTabs(projection: TabProjection): void {
        const mainPages = projection.pages.filter((page) => !pages.query.isRightPinned(page.id));
        const rightPageCount = projection.pages.filter((page) => pages.query.isRightPinned(page.id)).length;
        if (appWindow.isBoardMode) {
            mainPages.sort((left, right) => Number(right.isLockedBoardPage) - Number(left.isLockedBoardPage));
            this.root.toggleAttribute("data-board-single", mainPages.length <= 1 && rightPageCount === 0);
        }
        this.currentPages = mainPages;
        this.syncPageLayoutSubscriptions(mainPages);
        this.tabs.update(mainPages);
        this.checkScrollButtons();
        this.scrollToActive(projection.activeId);
    }

    private refreshTabLayout(): void {
        const state = pages.state.get();
        const mainPages = state.pages.filter((page) => !pages.query.isRightPinned(page.id));
        const rightPageCount = state.pages.filter((page) => pages.query.isRightPinned(page.id)).length;
        if (appWindow.isBoardMode) {
            mainPages.sort((left, right) => Number(right.isLockedBoardPage) - Number(left.isLockedBoardPage));
            this.root.toggleAttribute("data-board-single", mainPages.length <= 1 && rightPageCount === 0);
        }
        this.currentPages = mainPages;
        this.syncPageLayoutSubscriptions(mainPages);
        this.tabs.update(mainPages);
        this.checkScrollButtons();
    }

    private syncPageLayoutSubscriptions(pages: readonly PageModel[]): void {
        const presentIds = new Set(pages.map((page) => page.id));
        for (const [pageId, subscription] of this.pageLayoutSubscriptions) {
            if (presentIds.has(pageId)) continue;
            subscription.release();
            this.pageLayoutSubscriptions.delete(pageId);
        }
        for (const page of pages) {
            const editor = page.mainEditor;
            const previous = this.pageLayoutSubscriptions.get(page.id);
            if (previous?.page === page && previous.editor === editor) continue;
            previous?.release();
            const pageUnsubscribe = page.state.subscribe(
                () => this.refreshTabLayout(),
                (state) => ({ pinSide: state.pinSide, mainEditorId: state.mainEditorId, version: state.version }),
            );
            const updateLayout = (): void => this.refreshTabLayout();
            const editorState = editor?.state as unknown as IState<{ encrypted?: boolean; password?: unknown }> | undefined;
            const editorUnsubscribe = editorState?.subscribe(
                updateLayout,
                (state) => ({
                    encrypted: state.encrypted === true,
                    decrypted: state.password !== undefined,
                }),
            );
            const hostState = editor?.contentHost?.state as unknown as IState<{ encrypted?: boolean; password?: unknown }> | undefined;
            const hostUnsubscribe = hostState?.subscribe(
                updateLayout,
                (state) => ({
                    encrypted: state.encrypted === true,
                    decrypted: state.password !== undefined,
                }),
            );
            this.pageLayoutSubscriptions.set(page.id, {
                page,
                editor,
                release: () => {
                    pageUnsubscribe();
                    editorUnsubscribe?.();
                    hostUnsubscribe?.();
                },
            });
        }
    }

    private pinnedLeft(page: PageModel, pages: readonly PageModel[]): number | undefined {
        if (!page.pinned) return undefined;
        let left = 0;
        for (const candidate of pages) {
            if (candidate === page) break;
            if (candidate.isLockedBoardPage) {
                left += 208;
                continue;
            }
            if (!candidate.pinned) continue;
            const host = candidate.mainEditor?.contentHost;
            const encrypted = Boolean(host && (host.encrypted || host.decrypted));
            left += (encrypted ? pinnedTabEncryptedWidth : pinnedTabWidth) + 2;
        }
        return left;
    }

    private handleWheel(event: WheelEvent): void {
        if (this.wrapper.scrollWidth <= this.wrapper.clientWidth) return;
        event.preventDefault();
        this.wrapper.scrollLeft += event.deltaY;
    }

    private checkScrollButtons(): void {
        const next = this.wrapper.scrollWidth > this.wrapper.clientWidth;
        if (next === this.showScrollButtons) return;
        this.showScrollButtons = next;
        if (next) {
            this.root.insertBefore(this.scrollLeftButton.root, this.wrapper);
            this.root.insertBefore(this.scrollRightButton.root, this.addButton.root);
        } else {
            this.scrollLeftButton.root.remove();
            this.scrollRightButton.root.remove();
        }
    }

    private scrollLeft(): void {
        this.wrapper.scrollBy({ left: -minTabWidth, behavior: "smooth" });
    }

    private scrollRight(): void {
        this.wrapper.scrollBy({ left: minTabWidth, behavior: "smooth" });
    }

    private scrollToActive(activeId: string | undefined): void {
        // Resolve by page id, NOT by querying `[data-active]`. Each `PageTabView` writes its own
        // `data-active` from its own binding, so at this point the DOM can still carry the
        // OUTGOING tab's attribute — querying it scrolled the strip to the previously active tab.
        if (!activeId) return;
        const activeTab = this.tabs.get(activeId);
        if (!activeTab) return;
        // A pinned tab is `position: sticky`, so it is never scrolled out of view.
        if (activeTab.hasAttribute("data-pinned")) return;

        // `scrollIntoView` cannot express this. The pinned tabs are sticky at the strip's left
        // edge, so the leftmost `pinnedInset` pixels of the scrollport are permanently covered by
        // them. `inline: "nearest"` aligns the target's left edge to the scrollport's left edge,
        // which parks it BEHIND the pinned tabs — the tab is technically scrolled in but still
        // invisible, and the user has to nudge the strip further. `inline: "center"` happened to
        // clear the pinned block, which is why this was latent until the options changed.
        const wrapper = this.wrapper;
        const inset = this.pinnedInset();

        // Measure against the wrapper's own box, NOT `offsetLeft`. Neither the strip nor the
        // wrapper is positioned, so `offsetParent` resolves to `.app-header` and `offsetLeft`
        // includes everything to the left of the tab strip in the header — which inflates the
        // target and leaves the tab's left edge cut off. Client rects are relative to the
        // viewport, so the difference is exactly the tab's position within the scrollport.
        const wrapperLeft = wrapper.getBoundingClientRect().left;
        const tabRect = activeTab.getBoundingClientRect();
        const leftInPort = tabRect.left - wrapperLeft;
        const rightInPort = tabRect.right - wrapperLeft;

        let delta = 0;
        if (leftInPort < inset) delta = leftInPort - inset;
        else if (rightInPort > wrapper.clientWidth) delta = rightInPort - wrapper.clientWidth;
        else return;

        const maxScroll = Math.max(0, wrapper.scrollWidth - wrapper.clientWidth);
        const target = Math.min(maxScroll, Math.max(0, wrapper.scrollLeft + delta));
        if (target === wrapper.scrollLeft) return;
        wrapper.scrollTo({ left: target, behavior: "smooth" });
    }

    /**
     * Width of the sticky pinned block — the permanently obscured left inset of the scrollport.
     *
     * Measured from the last pinned tab's right edge rather than summed from
     * `pinnedTabWidth`/`pinnedTabEncryptedWidth`. Those constants describe the layout `width`, not
     * the rendered outer width: each tab adds 1px borders and 2px horizontal padding, so the
     * arithmetic under-reported the real inset by ~4px per tab and left the target tab clipped
     * behind the pinned block. Reading the last stuck tab's right edge is exact and needs no
     * knowledge of the column gap.
     */
    private pinnedInset(): number {
        const pinnedTabs = this.wrapper.querySelectorAll<HTMLElement>(
            '[data-type="page-tab"][data-pinned]',
        );
        const last = pinnedTabs[pinnedTabs.length - 1];
        if (!last) return 0;
        return Math.max(0, last.getBoundingClientRect().right - this.wrapper.getBoundingClientRect().left);
    }

    private updateAddMenu(): void {
        const allItems = getCreatableItems(settings.get("browser-profiles"));
        for (const item of allItems) {
            if (item.boardRoot) this.warmBoard(item.boardRoot);
        }
        const items: MenuItem[] = [];
        for (const stored of editorCategories.allRefs()) {
            const ref = editorCategories.decodeRef(stored);
            if (ref.kind === "editor") {
                const item = allItems.find((candidate) => candidate.id === ref.id);
                if (item) {
                    items.push({ label: getCreatableItemLabel(item), icon: createCreatableItemIcon(item), onClick: item.create });
                }
            } else {
                const root = ref.root;
                if (!boardRegistry.isTrusted(root)) continue;
                this.warmBoard(root);
                items.push({
                    label: boardDisplayText(
                        root,
                        this.boardManifests.get(root),
                        boardMetadataKeys.name,
                        this.boardManifests.get(root)?.name?.trim() || fpBasename(root),
                    ),
                    icon: createBoardGlyphElement(root),
                    onClick: () => {
                        void app.events.openRawLink.sendAsync(
                            createLinkData(encodePersephoneBoardLink(root)),
                        );
                    },
                });
            }
        }
        items.push({
            label: t("shell.showAll"),
            startGroup: true,
            onClick: () => void pages.standalonePages.show("tools-hub-page").then((): undefined => undefined),
        });
        this.addButton.update({
            name: "page-tabs-add",
            size: "md",
            title: t("shell.addPageCtrlN", { shortcut: "Ctrl+N" }),
            icon: "plus",
            onClick: () => pages.lifecycle.addEmptyPage(),
            menuTitle: "New editor page",
            items,
            onOpenMenu: (anchor) => this.openCategoryPopover(anchor),
        });
    }

    private openCategoryPopover(anchor: HTMLElement): void {
        if (this.categoryPopover) this.releaseChild(this.categoryPopover);
        const close = (): void => {
            if (this.categoryPopover !== popover) return;
            this.releaseChild(popover);
            popover.root.remove();
            this.categoryPopover = undefined;
        };
        const popover = new PopoverView({
            name: "editor-categories-popover",
            open: true,
            elementRef: anchor,
            placement: "bottom-start",
            maxHeight: "calc(100vh - 16px)",
            scroll: false,
            onClose: close,
            contentView: (host) => new EditorCategoriesPopoverView({ host, onClose: close }),
        });
        this.categoryPopover = this.child(popover);
        popover.mount();
    }

    private warmBoard(root: string): void {
        if (this.warmedBoardRoots.has(root)) return;
        this.warmedBoardRoots.add(root);
        void readBoardManifest(root).then((manifest) => {
            if (!manifest) return;
            this.boardManifests.set(root, manifest);
            return ensureBoardDisplayText(root, manifest);
        }).catch(() => {});
    }
}
