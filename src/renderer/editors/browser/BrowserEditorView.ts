import { EditorToolbarView } from "../base/EditorToolbarView";
import type { BrowserEditor } from "./BrowserEditor";
import type { BrowserEditorState } from "./browser-state";
import { t } from "../../../shared/i18n/t";
import { PageManagerView } from "../../components/page-manager/PageManagerView";
import type { PageSlotViewProps } from "../../components/page-manager/PageSlot";
import { createPanelElement } from "../../uikit/Panel/panel-style";
import { createTextElement } from "../../uikit/Text/text-style";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import { SubtreeSwap } from "../../uikit/shared/subtree-swap";
import type { VanillaViewCtor } from "../../uikit/shared/vanilla-view";
import { ButtonView } from "../../uikit/Button/ButtonView";
import { SplitterView } from "../../uikit/Splitter/SplitterView";
import { BrowserTabsPanelView } from "./BrowserTabsPanel";
import { BookmarksDrawerView, type BookmarksDrawerProps } from "./BookmarksDrawer";
import { TorStatusOverlayView } from "./TorStatusOverlay";
import { UrlSuggestionsDropdownView } from "./UrlSuggestionsDropdown";
import { FindBarView } from "../shared/FindBarView";
import type { BrowserFindState } from "./BrowserFindModel";
import { focusAfterPaint } from "../../core/utils/scheduling";
import { BrowserToolbarView } from "./BrowserToolbarView";
import { BrowserTabPageView } from "./BrowserWebviewItemView";
import { PopupBlockedView, PermissionPromptBarView, SiteExtensionTrustPromptBarView } from "./BrowserPromptBars";
import "./BrowserView.css";
import "../../uikit/Panel/Panel.css";
import "../../uikit/Text/Text.css";
import "../../uikit/Input/Input.css";
import "../../uikit/IconButton/IconButton.css";
import "../../uikit/Button/Button.css";
import "../../uikit/Slider/Slider.css";
import "../../uikit/Switch/Switch.css";
import "../../uikit/Popover/Popover.css";
import "../../uikit/Select/Select.css";
import "../../uikit/Spinner/Spinner.css";
import "../../uikit/Dot/Dot.css";
import "../../uikit/Splitter/Splitter.css";

interface ProfileNetworkErrorProps { model: BrowserEditor; error: string; }

/** Shown instead of the page's webviews when its profile proxy could not be applied. */
class ProfileNetworkErrorView extends VanillaView<ProfileNetworkErrorProps> {
    private readonly message = createTextElement("", { size: "sm", color: "light" });
    private readonly retry: ButtonView;

    public constructor(props: ProfileNetworkErrorProps) {
        super(props, createPanelElement({ name: "profile-network-error", position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 5, background: "dark", direction: "column", align: "center", gap: "lg", paddingTop: "xxxl" }));
        this.retry = this.child(new ButtonView({ name: "profile-network-retry", children: t("browser.profileNetworkRetry"), onClick: () => { void props.model.retryProfileNetwork(); } }));
        this.root.append(createTextElement(t("browser.profileNetworkUnavailable"), { size: "md" }), this.message, this.retry.root);
    }
    protected onMount(): void { this.retry.mount(); this.sync(this.props); }
    protected onUpdate(props: ProfileNetworkErrorProps): void { this.sync(props); }
    private sync(props: ProfileNetworkErrorProps): void { this.message.textContent = t("browser.profileNetworkRetryHelp", { error: props.error }); }
}

class StaticNodeView extends VanillaView<Record<string, never>> { public constructor(root: HTMLElement) { super({}, root); } }

export class BrowserEditorView extends VanillaView<{ model: BrowserEditor }> {
    private readonly model: BrowserEditor;
    private readonly toolbar: BrowserToolbarView;
    private readonly editorToolbar: EditorToolbarView;
    private readonly tabs: BrowserTabsPanelView;
    private readonly splitter: SplitterView;
    private readonly pageManager: PageManagerView;
    private readonly pageViewCtor: VanillaViewCtor<PageSlotViewProps>;
    private readonly popupSwap: SubtreeSwap<"blocked">;
    private readonly permissionSwap: SubtreeSwap<"permission">;
    private readonly siteExtensionTrustSwap: SubtreeSwap<"site-extension-trust">;
    private readonly torSwap: SubtreeSwap<"tor">;
    private readonly networkSwap: SubtreeSwap<"network">;
    private networkView: ProfileNetworkErrorView | undefined;
    private readonly clickSwap: SubtreeSwap<"click">;
    private readonly findSwap: SubtreeSwap<"find">;
    private readonly drawerSwap: SubtreeSwap<"drawer">;
    private readonly suggestionsSwap: SubtreeSwap<"suggestions">;
    private readonly popupHost = document.createElement("div");
    private readonly webviewArea: HTMLDivElement;
    private readonly browserBody: HTMLDivElement;
    private tabsHost: HTMLDivElement;
    private loadingBar: HTMLDivElement;
    private popupView: PopupBlockedView | undefined;
    private permissionView: PermissionPromptBarView | undefined;
    private siteExtensionTrustView: SiteExtensionTrustPromptBarView | undefined;
    private torView: TorStatusOverlayView | undefined;
    private findView: FindBarView | undefined;
    private drawerView: BookmarksDrawerView | undefined;
    private suggestionsView: UrlSuggestionsDropdownView | undefined;
    private lastUrl = "";
    private lastActiveTabId = "";
    private initialLoad = true;
    private focusTimer: ReturnType<typeof setTimeout> | undefined;
    private urlBarFocusDisposer: (() => void) | undefined;

    public constructor(props: { model: BrowserEditor }) {
        const root = document.createElement("div"); root.className = "browser-root"; root.dataset.type = "browser-editor"; root.tabIndex = -1;
        super(props, root); this.model = props.model;
        this.pageViewCtor = class extends BrowserTabPageView { public constructor(slotProps: PageSlotViewProps) { super({ model: props.model, tabId: slotProps.pageId }); } } as unknown as VanillaViewCtor<PageSlotViewProps>;
        this.toolbar = this.child(new BrowserToolbarView({ model: this.model, state: this.model.state.get() }));
        this.editorToolbar = this.child(new EditorToolbarView({ borderBottom: true, children: this.toolbar.root }));
        this.tabs = this.child(new BrowserTabsPanelView(this.tabsProps(this.model.state.get())));
        this.webviewArea = createPanelElement({ name: "webview-area", flex: true, position: "relative", overflow: "hidden" });
        this.browserBody = createPanelElement({ name: "browser-body", direction: "row", flex: true, overflow: "hidden", position: "relative" });
        this.pageManager = this.child(new PageManagerView({ pageIds: [], activeId: "", renderPage: () => this.pageViewCtor }));
        this.splitter = this.child(new SplitterView({ name: "tabs-webview-splitter", orientation: "vertical", value: this.model.state.get().tabsPanelWidth, onChange: this.model.tabs.setPanelWidth, side: "before", min: 32, background: "default", hoverBackground: "light", border: "none" }));
        this.popupSwap = new SubtreeSwap(this.popupHost); this.permissionSwap = new SubtreeSwap(this.popupHost); this.siteExtensionTrustSwap = new SubtreeSwap(this.popupHost); this.torSwap = new SubtreeSwap(this.webviewArea); this.networkSwap = new SubtreeSwap(this.webviewArea); this.clickSwap = new SubtreeSwap(this.webviewArea); this.findSwap = new SubtreeSwap(this.webviewArea); this.drawerSwap = new SubtreeSwap(this.browserBody); this.suggestionsSwap = new SubtreeSwap(this.root);
        this.own(() => { this.popupSwap.dispose(); this.permissionSwap.dispose(); this.siteExtensionTrustSwap.dispose(); this.torSwap.dispose(); this.networkSwap.dispose(); this.clickSwap.dispose(); this.findSwap.dispose(); this.drawerSwap.dispose(); this.suggestionsSwap.dispose(); });
        this.buildTree();
    }

    protected onMount(): void {
        this.listen(this.root, "keydown", (event) => this.model.handleBrowserShortcut(event as never, "root"));
        this.toolbar.mount(); this.editorToolbar.mount(); this.tabs.mount(); this.splitter.mount(); this.pageManager.mount();
        this.model.urlBar.setFocusScheduler((select) => {
            this.urlBarFocusDisposer?.();
            this.urlBarFocusDisposer = focusAfterPaint(this.model.urlBar.urlInputRef, { select });
        });
        this.own(() => {
            this.urlBarFocusDisposer?.();
            this.urlBarFocusDisposer = undefined;
            this.model.urlBar.setFocusScheduler(undefined);
        });
        this.own(this.model.tabs.materializationRevision.subscribe(() => this.sync(this.model.state.get())));
        this.bind(this.model.state, (state) => state, this.sync);
        this.own(this.model.find.state.subscribe(() => this.syncFind(this.model.find.state.get())));
        this.sync(this.model.state.get());
        this.syncFind(this.model.find.state.get());
    }
    protected onUpdate(): void { this.sync(this.model.state.get()); }
    protected onDispose(): void {
        if (this.focusTimer) clearTimeout(this.focusTimer);
        this.focusTimer = undefined;
    }

    private buildTree(): void {
        this.loadingBar = document.createElement("div"); this.loadingBar.dataset.browserLoadingBar = "";
        this.tabsHost = createPanelElement({ name: "tabs-panel-host", shrink: false, overflow: "hidden", borderRight: true, width: this.model.state.get().tabsPanelWidth });
        this.tabsHost.append(this.tabs.root); this.webviewArea.append(this.pageManager.root); this.browserBody.append(this.tabsHost, this.splitter.root, this.webviewArea);
        this.popupHost.style.display = "contents"; this.root.append(this.editorToolbar.root, this.loadingBar, this.popupHost, this.browserBody);
    }
    private tabsProps(state: BrowserEditorState) { return { model: this.model, tabs: state.tabs, activeTabId: state.activeTabId, width: state.tabsPanelWidth }; }

    private readonly sync = (state: BrowserEditorState): void => {
        const active = this.model.activeTab;
        this.toolbar.update({ model: this.model, state }); this.tabs.update(this.tabsProps(state)); this.tabsHost.style.width = `${state.tabsPanelWidth}px`; this.loadingBar.toggleAttribute("data-loading", !!active?.loading); this.splitter.update({ name: "tabs-webview-splitter", orientation: "vertical", value: state.tabsPanelWidth, onChange: this.model.tabs.setPanelWidth, side: "before", min: 32, background: "default", hoverBackground: "light", border: "none" });
        // No webview mounts while the profile's proxy could not be applied:
        // its session route is unknown, and a mounted webview would start loading.
        this.pageManager.update({ pageIds: state.networkError ? [] : state.tabs.filter((tab) => this.model.tabs.isMaterialized(tab.id)).map((tab) => tab.id), activeId: state.activeTabId, renderPage: () => this.pageViewCtor });
        const activeUrl = active?.url || "";
        if (state.activeTabId !== this.lastActiveTabId || activeUrl !== this.lastUrl) {
            this.lastActiveTabId = state.activeTabId;
            this.lastUrl = activeUrl;
            this.model.urlBar.syncFromUrl(activeUrl);
        }
        if (this.initialLoad) {
            this.initialLoad = false;
            if (!activeUrl || activeUrl === "about:blank") {
                // Wait 100 ms for the blank-page toolbar to become visible before focusing it.
                this.focusTimer = setTimeout(() => this.model.urlBar.focusUrlInput(), 100);
            }
        }
        this.syncPopup(state); this.syncPermissionPrompt(state); this.syncSiteExtensionTrustPrompt(); this.syncTor(state); this.syncNetworkError(state); this.syncClick(state); this.syncDrawer(state); this.syncSuggestions(state);
    };

    private syncPopup(state: BrowserEditorState): void {
        if (state.blockedPopupCount <= 0) { this.popupView = undefined; this.popupSwap.clear(); return; }
        let created: PopupBlockedView | undefined; this.popupSwap.set("blocked", () => { created = new PopupBlockedView({ model: this.model, count: state.blockedPopupCount }); this.popupView = created; return created; }); created?.mount(); this.popupView?.update({ model: this.model, count: state.blockedPopupCount });
    }
    private syncPermissionPrompt(state: BrowserEditorState): void {
        const prompt = state.permissionPrompts.find((item) => item.internalTabId === state.activeTabId);
        if (!prompt) { this.permissionView = undefined; this.permissionSwap.clear(); return; }
        let created: PermissionPromptBarView | undefined;
        this.permissionSwap.set("permission", () => { created = new PermissionPromptBarView({ model: this.model, prompt }); this.permissionView = created; return created; });
        created?.mount();
        this.permissionView?.update({ model: this.model, prompt });
    }
    private syncSiteExtensionTrustPrompt(): void {
        const prompt = this.model.siteExtensions.activePrompt();
        if (!prompt) { this.siteExtensionTrustView = undefined; this.siteExtensionTrustSwap.clear(); return; }
        let created: SiteExtensionTrustPromptBarView | undefined;
        this.siteExtensionTrustSwap.set("site-extension-trust", () => { created = new SiteExtensionTrustPromptBarView({ model: this.model, prompt }); this.siteExtensionTrustView = created; return created; });
        created?.mount();
        this.siteExtensionTrustView?.update({ model: this.model, prompt });
    }
    private syncTor(state: BrowserEditorState): void {
        if (!state.isTor || !state.torOverlayVisible) { this.torView = undefined; this.torSwap.clear(); return; }
        let created: TorStatusOverlayView | undefined; this.torSwap.set("tor", () => { created = new TorStatusOverlayView({ model: this.model, torStatus: state.torStatus, torLog: state.torLog }); this.torView = created; return created; }); created?.mount(); this.torView?.update({ model: this.model, torStatus: state.torStatus, torLog: state.torLog });
    }
    private syncNetworkError(state: BrowserEditorState): void {
        if (!state.networkError) { this.networkView = undefined; this.networkSwap.clear(); return; }
        let created: ProfileNetworkErrorView | undefined; this.networkSwap.set("network", () => { created = new ProfileNetworkErrorView({ model: this.model, error: state.networkError }); this.networkView = created; return created; }); created?.mount(); this.networkView?.update({ model: this.model, error: state.networkError });
    }
    private syncClick(state: BrowserEditorState): void {
        if (!state.popupOpen) { this.clickSwap.clear(); return; }
        let created: StaticNodeView | undefined; this.clickSwap.set("click", () => { const node = document.createElement("div"); node.dataset.webviewClickOverlay = ""; created = new StaticNodeView(node); return created; }); created?.mount();
    }
    private syncFind(state: BrowserFindState): void {
        if (!state.findBarVisible) { this.findView = undefined; this.findSwap.clear(); return; }
        const props = { text: state.findText, currentMatch: state.findActiveMatch, totalMatches: state.findTotalMatches, onTextChange: this.model.find.setText, onNext: this.model.find.next, onPrev: this.model.find.prev, onClose: this.model.find.close, placeholder: t("browser.toolbarFindPlaceholder") };
        let created: FindBarView | undefined; this.findSwap.set("find", () => { created = new FindBarView(props); this.findView = created; return created; }); created?.mount(); this.findView?.update(props);
    }
    private syncDrawer(state: BrowserEditorState): void {
        const bookmarks = this.model.bookmarks.bookmarks;
        if (!state.bookmarksReady || !bookmarks || !state.bookmarksOpen) { this.drawerView = undefined; this.drawerSwap.clear(); return; }
        // Built fresh on each use rather than captured once: the drawer's own `sync()` recovers a
        // zero width by calling `onChangeWidth` *during* `mount()`, so a props object captured
        // before mount still says `width: 0` and the `update()` below would overwrite the recovery.
        // `bookmarksWidth` defaults to 0, so that made the first open on any new browser page render
        // a 0px-wide, invisible drawer that only a close-and-reopen fixed.
        const drawerProps = (): BookmarksDrawerProps => ({ open: true, bookmarks, width: this.model.state.get().bookmarksWidth, onChangeWidth: (width: number) => this.model.state.update((s) => { s.bookmarksWidth = width; }), onClose: this.model.bookmarks.handleCloseBookmarks });
        let created: BookmarksDrawerView | undefined; this.drawerSwap.set("drawer", () => { created = new BookmarksDrawerView(drawerProps()); this.drawerView = created; return created; }); created?.mount(); this.drawerView?.update(drawerProps());
    }
    private syncSuggestions(state: BrowserEditorState): void {
        const items = this.model.urlBar.suggestionsItems; const open = state.suggestionsOpen && items.length > 0;
        if (!open) { this.suggestionsView = undefined; this.suggestionsSwap.clear(); return; }
        const props = { anchorEl: this.toolbar.urlAnchor, open: true, items, mode: this.model.urlBar.suggestionsMode, searchText: this.model.urlBar.suggestionsMode === "search" ? state.urlInput : undefined, hoveredIndex: state.hoveredIndex, onHoveredIndexChange: (index: number) => this.model.state.update((s) => { s.hoveredIndex = index; }), onSelect: this.model.urlBar.handleSuggestionSelect, onClearVisible: this.model.urlBar.suggestionsMode === "search" ? this.model.urlBar.handleClearVisible : undefined };
        let created: UrlSuggestionsDropdownView | undefined; this.suggestionsSwap.set("suggestions", () => { created = new UrlSuggestionsDropdownView(props); this.suggestionsView = created; return created; }); created?.mount(); this.suggestionsView?.update(props);
    }
}
