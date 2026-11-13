import { PAGE_ZOOM_DEFAULT } from "../../../shared/browser-zoom";
import type { BrowserEditor } from "./BrowserEditor";
import { t } from "../../../shared/i18n/t";
import type { BrowserEditorState } from "./browser-state";
import { createPanelElement } from "../../uikit/Panel/panel-style";
import type { IconRef } from "../../uikit/shared/slots";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import { InputView } from "../../uikit/Input/InputView";
import { IconButtonView } from "../../uikit/IconButton/IconButtonView";
import { ButtonView } from "../../uikit/Button/ButtonView";
import { PopoverView } from "../../uikit/Popover/PopoverView";
import { SpinnerView } from "../../uikit/Spinner/SpinnerView";
import { DotView } from "../../uikit/Dot/DotView";
import { openMenu, type MenuHandle } from "../../uikit/Menu/attach-menu";
import { IncognitoIcon, TorIcon } from "../../theme/language-icons";
import color from "../../theme/color";
import { DownloadButtonView } from "./DownloadButton";
import { BrowserSiteActionsView } from "./BrowserSiteActionsView";
import { BrowserTranslationPopoverContentView } from "./BrowserTranslationPopoverContentView";
import { getPageMenuItems } from "./browser-page-menu";
import { SitePermissionsContentView, type SitePermissionsContentProps, type AiVisionIndicator } from "./SitePermissionsPopover";
import { BrowserZoomContentView, type BrowserZoomContentProps } from "./PageZoomPopover";

interface BrowserToolbarProps { model: BrowserEditor; state: BrowserEditorState; }

export class BrowserToolbarView extends VanillaView<BrowserToolbarProps> {
    private readonly model: BrowserEditor;
    private readonly zoomButton: ButtonView; private readonly zoomPopover: PopoverView;
    private zoomContent: BrowserZoomContentView | undefined;
    private zoomOpen = false;
    private readonly homeButton: IconButtonView; private readonly backButton: IconButtonView;
    private readonly forwardButton: IconButtonView; private readonly reloadButton: IconButtonView;
    private readonly bookmarksButton: IconButtonView; private readonly torInfoButton: IconButtonView;
    private readonly moreButton: IconButtonView; private readonly devtoolsButton: IconButtonView;
    private readonly closeButton: IconButtonView; private readonly input: InputView;
    private readonly navigate: IconButtonView;
    private readonly star: IconButtonView;
    private readonly inputPanel: HTMLDivElement;
    private readonly startSlot: HTMLSpanElement; private readonly urlEntrySlot = document.createElement("span");
    private readonly endSlot: HTMLSpanElement;
    private readonly torIndicator = document.createElement("span");
    private readonly searchEngineButton = document.createElement("button");
    private readonly siteActions: BrowserSiteActionsView;
    private readonly sitePermissionsButton: IconButtonView;
    private readonly sitePermissionsPopover: PopoverView;
    private readonly translateButton: IconButtonView;
    private readonly translatePopover: PopoverView;
    private translateContent: BrowserTranslationPopoverContentView | undefined;
    private translatePopoverOpen = false;
    private translationStateTabId = "";
    private translationStateUnsubscribe: (() => void) | undefined;
    /** Proxied-profile marker; opens the network info dialog. */
    private readonly proxyChip = document.createElement("button");
    private pageMenu: MenuHandle | undefined;
    private searchMenu: MenuHandle | undefined;
    private permissionsContent: SitePermissionsContentView | undefined;
    private spinner: SpinnerView | undefined;
    private dot: DotView | undefined;

    public constructor(props: BrowserToolbarProps) {
        super(props, createPanelElement({ name: "browser-toolbar-content", direction: "row", align: "center", flex: true, gap: "xs" }));
        this.model = props.model;
        this.zoomButton = this.child(new ButtonView(this.zoomButtonProps(props.state)));
        this.zoomPopover = this.child(new PopoverView(this.zoomPopoverProps()));
        this.startSlot = document.createElement("span"); this.startSlot.style.display = "contents";
        this.endSlot = document.createElement("span"); this.endSlot.style.display = "contents";
        this.torIndicator.dataset.torIndicator = "";
        this.searchEngineButton.type = "button"; this.searchEngineButton.dataset.searchEngineChip = "";
        this.proxyChip.type = "button"; this.proxyChip.dataset.proxyChip = ""; this.proxyChip.dataset.name = "url-proxy-indicator"; this.proxyChip.textContent = t("browser.proxy");
        this.inputPanel = createPanelElement({ name: "url-bar", flex: true }); this.inputPanel.dataset.urlBar = "";
        const make = (name: string, icon: IconRef, title: string, onClick: () => void): IconButtonView => this.child(new IconButtonView({ name, size: "sm", icon, title, onClick }));
        this.homeButton = this.child(new IconButtonView(this.homeProps(props.state)));
        this.backButton = this.child(new IconButtonView(this.backProps(props.state)));
        this.forwardButton = this.child(new IconButtonView(this.forwardProps(props.state)));
        this.reloadButton = this.child(new IconButtonView(this.reloadProps(props.state)));
        this.translateButton = make("toolbar-translate", "translate", t("translation.button"), this.handleTranslateClick);
        this.translateButton.update({ name: "toolbar-translate", size: "sm", icon: "translate", title: t("translation.button"), "aria-label": t("translation.button"), onClick: this.handleTranslateClick });
        this.translatePopover = this.child(new PopoverView(this.translatePopoverProps()));
        this.navigate = this.child(new IconButtonView({ name: "url-navigate", size: "sm", icon: "arrow-right", title: t("browser.navigate"), onClick: this.model.urlBar.handleNavigate }));
        this.sitePermissionsButton = this.child(new IconButtonView({ name: "url-site-permissions", size: "sm", icon: "info", title: t("browser.sitePermissions"), onClick: this.toggleSitePermissions }));
        this.sitePermissionsPopover = this.child(new PopoverView(this.sitePermissionsPopoverProps()));
        this.star = this.child(new IconButtonView({ name: "url-bookmark-toggle", size: "sm", icon: "star", title: t("browser.bookmarkAdd"), onClick: this.model.bookmarks.handleStarClick }));
        this.input = this.child(new InputView({ name: "url-input", size: "sm", value: this.model.urlBar.state.get().urlInput, onChange: this.model.urlBar.handleUrlChange, onKeyDown: this.model.urlBar.handleUrlKeyDown, onFocus: this.model.urlBar.handleUrlFocus, onBlur: this.model.urlBar.handleUrlBlur, onContextMenu: (event) => this.model.urlBar.handleUrlContextMenu(event as never), placeholder: t("browser.urlPlaceholder"), autoComplete: "off", startSlot: this.startSlot, endSlot: this.endSlot }));
        this.urlEntrySlot.style.display = "contents";
        this.bookmarksButton = this.child(new IconButtonView(this.bookmarksProps(props.state)));
        this.torInfoButton = this.child(new IconButtonView(this.torInfoProps(props.state)));
        this.siteActions = this.child(new BrowserSiteActionsView({ model: this.model, state: props.state }));
        const downloads = this.child(new DownloadButtonView());
        this.moreButton = this.child(new IconButtonView(this.moreProps(props.state)));
        this.devtoolsButton = this.child(new IconButtonView(this.devtoolsProps(props.state)));
        this.closeButton = this.child(new IconButtonView(this.closeProps(props.state)));
        this.endSlot.append(this.navigate.root, this.siteActions.root, this.translateButton.root, this.star.root);
        this.inputPanel.append(this.input.root);
        this.root.append(
            this.homeButton.root, this.backButton.root, this.forwardButton.root, this.reloadButton.root,
            this.inputPanel,
            this.zoomButton.root, this.bookmarksButton.root, this.torInfoButton.root, downloads.root,
            this.moreButton.root, this.devtoolsButton.root, this.closeButton.root,
            this.sitePermissionsPopover.root,
            this.translatePopover.root, this.zoomPopover.root,
        );
        this.downloads = downloads;
    }

    private readonly downloads: DownloadButtonView;
    get urlAnchor(): Element { return this.inputPanel; }
    get urlInputElement(): HTMLInputElement { return this.input.inputElement; }

    protected onMount(): void { this.listen(this.searchEngineButton, "click", (event) => { event.stopPropagation(); this.openSearchMenu(); }); this.listen(this.torIndicator, "click", (event) => { event.stopPropagation(); this.model.tor.toggleOverlay(); }); this.listen(this.proxyChip, "click", (event) => { event.stopPropagation(); void this.model.showNetworkInfoDialog(); }); this.homeButton.mount(); this.backButton.mount(); this.forwardButton.mount(); this.reloadButton.mount(); this.bookmarksButton.mount(); this.torInfoButton.mount(); this.moreButton.mount(); this.devtoolsButton.mount(); this.closeButton.mount(); this.zoomButton.mount(); this.zoomPopover.mount(); this.translateButton.mount(); this.input.mount(); this.model.urlBar.setUrlInputRef(this.input.inputElement); this.navigate.mount(); this.star.mount(); this.siteActions.mount(); this.downloads.mount(); this.sitePermissionsButton.mount(); this.sitePermissionsPopover.mount(); this.translatePopover.mount(); this.own(this.model.pageRemote.changed.subscribe(() => this.sync(this.model.state.get()))); this.own(this.model.sitePermissions.state.subscribe(() => this.sync(this.model.state.get()))); this.bind(this.model.urlBar.state, (state) => ({ urlInput: state.urlInput, userHasTyped: state.userHasTyped }), ({ urlInput, userHasTyped }) => { this.input.update(this.urlInputProps(urlInput)); this.syncUrlEntrySlot(this.props.state, userHasTyped, false); }); this.sync(this.props.state); }
    protected onUpdate(props: BrowserToolbarProps): void { this.sync(props.state); }
    protected onDispose(): void { this.pageMenu?.dispose(); this.searchMenu?.dispose(); this.pageMenu = undefined; this.searchMenu = undefined; this.translationStateUnsubscribe?.(); }

    private sync(state: BrowserEditorState): void {
        this.siteActions.update({ model: this.model, state });
        if (this.translationStateTabId !== state.activeTabId) {
            this.translationStateUnsubscribe?.();
            this.translationStateTabId = state.activeTabId;
            this.translationStateUnsubscribe = this.model.translation.subscribeTabView(state.activeTabId, () => this.sync(this.props.state));
        }
        const translationView = this.model.translation.tabView(state.activeTabId);
        const aiVisionIndicator = this.getAiVisionIndicator(state);
        const sitePermissionsTitle = aiVisionIndicator.source === "page"
            ? t("browser.sitePermissionsTitleBuiltin")
            : aiVisionIndicator.source === "extension"
                ? t("browser.sitePermissionsTitleExtension", { name: aiVisionIndicator.extensionName })
                : t("browser.sitePermissions");
        this.sitePermissionsButton.update({ name: "url-site-permissions", size: "sm", icon: "info", title: sitePermissionsTitle, onClick: this.toggleSitePermissions });
        if (aiVisionIndicator.source === "none") delete this.sitePermissionsButton.root.dataset.aiVisionSource;
        else this.sitePermissionsButton.root.dataset.aiVisionSource = aiVisionIndicator.source;
        this.zoomButton.update(this.zoomButtonProps(state));
        this.zoomPopover.update(this.zoomPopoverProps());
        this.zoomContent?.update(this.zoomContentProps());
        this.homeButton.update(this.homeProps(state));
        this.backButton.update(this.backProps(state));
        this.forwardButton.update(this.forwardProps(state));
        this.reloadButton.update(this.reloadProps(state));
        this.navigate.update({ name: "url-navigate", size: "sm", icon: "arrow-right", title: t("browser.navigate"), onClick: this.model.urlBar.handleNavigate });
        this.star.update({ name: "url-bookmark-toggle", size: "sm", icon: state.isBookmarked ? "star-filled" : "star", title: state.isBookmarked ? t("browser.bookmarkEdit") : t("browser.bookmarkAdd"), active: state.isBookmarked, onClick: this.model.bookmarks.handleStarClick });
        this.bookmarksButton.update(this.bookmarksProps(state));
        this.torInfoButton.update(this.torInfoProps(state));
        this.moreButton.update(this.moreProps(state));
        this.devtoolsButton.update(this.devtoolsProps(state));
        this.closeButton.update(this.closeProps(state));
        this.renderStart(state, this.model.urlBar.state.get().userHasTyped);
        this.sitePermissionsPopover.update(this.sitePermissionsPopoverProps());
        this.permissionsContent?.update(this.sitePermissionsContentProps());
        const translation = translationView.state;
        this.translateButton.update({ name: "toolbar-translate", size: "sm", icon: "translate", title: t("translation.button"), "aria-label": t("translation.button"), active: translation.active, hidden: !translation.available, onClick: this.handleTranslateClick });
        this.translatePopover.update(this.translatePopoverProps());
        this.translateContent?.update({ tabId: state.activeTabId, state: translation, pageError: translationView.page.lastError, onChange: this.model.translation.correctSource });
        this.pageMenu?.update({ name: "page-menu", items: getPageMenuItems(this.model), placement: "bottom-end" });
        this.searchMenu?.update({ name: "search-engine-menu", items: this.model.urlBar.searchEngineMenuItems, placement: "bottom-start" });
    }

    private renderStart(state: BrowserEditorState, userHasTyped: boolean): void {
        this.startSlot.replaceChildren(); this.torIndicator.replaceChildren();
        if (state.isTor) {
            if (state.torStatus === "connecting") {
                if (!this.spinner) { this.spinner = this.child(new SpinnerView({ size: 14 })); this.spinner.mount(); }
                this.torIndicator.append(this.spinner.root);
            } else {
                if (this.spinner) { this.releaseChild(this.spinner); this.spinner = undefined; }
                this.torIndicator.append(TorIcon.createElement());
                if (!this.dot) { this.dot = this.child(new DotView({ size: 6, color: "warning" })); this.dot.mount(); }
                this.dot.update({ size: 6, color: state.torStatus === "connected" ? "success" : state.torStatus === "error" ? "error" : "warning" });
                const dotHost = document.createElement("span"); dotHost.dataset.torStatusDot = ""; dotHost.append(this.dot.root);
                this.torIndicator.append(dotHost);
            }
            this.startSlot.append(this.torIndicator);
        } else {
            if (this.spinner) { this.releaseChild(this.spinner); this.spinner = undefined; }
            if (this.dot) { this.releaseChild(this.dot); this.dot = undefined; }
        }
        if (state.isIncognito) this.startSlot.append(IncognitoIcon.createElement({ color: color.icon.light }));
        if (state.networkLabel) { this.proxyChip.title = t("browser.proxyInfoTitle", { network: state.networkLabel }); this.startSlot.append(this.proxyChip); }
        this.syncUrlEntrySlot(state, userHasTyped, true);
    }

    private syncUrlEntrySlot(state: BrowserEditorState, userHasTyped: boolean, syncPage: boolean): void {
        this.urlEntrySlot.replaceChildren(); const activeUrl = this.model.activeTab?.url || ""; const showSearchEngine = this.model.urlBar.showSearchEngineSelector;
        if (syncPage) this.model.sitePermissions.syncPage(state.activeTabId, activeUrl, !showSearchEngine && !userHasTyped);
        const permissionsState = this.model.sitePermissions.state.get(); if (showSearchEngine) { this.searchEngineButton.textContent = `${this.model.urlBar.currentEngineName} ▾`; this.urlEntrySlot.append(this.searchEngineButton); }
        else if (permissionsState.origin && !userHasTyped) this.urlEntrySlot.append(this.sitePermissionsButton.root); this.startSlot.append(this.urlEntrySlot);
    }

    private urlInputProps(urlInput: string) { return { name: "url-input", size: "sm" as const, value: urlInput, onChange: this.model.urlBar.handleUrlChange, onKeyDown: this.model.urlBar.handleUrlKeyDown, onFocus: this.model.urlBar.handleUrlFocus, onBlur: this.model.urlBar.handleUrlBlur, onContextMenu: (event: Event) => this.model.urlBar.handleUrlContextMenu(event as MouseEvent), placeholder: t("browser.urlPlaceholder"), autoComplete: "off", startSlot: this.startSlot, endSlot: this.endSlot }; }

    private readonly toggleSitePermissions = (): void => {
        if (this.model.sitePermissions.state.get().open) this.model.sitePermissions.close();
        else {
            const tab = this.model.activeTab;
            this.model.sitePermissions.open(tab?.id || "", tab?.url || "");
        }
        this.sitePermissionsPopover.update(this.sitePermissionsPopoverProps());
    };

    private sitePermissionsContentProps(): SitePermissionsContentProps {
        const state = this.model.sitePermissions.state.get();
        const certificateVisible = URL.canParse(state.sourceUrl)
            && new URL(state.sourceUrl).protocol === "https:";
        return {
            permissions: state.permissions,
            changed: state.changed,
            aiVisionIndicator: this.getAiVisionIndicator(this.props.state),
            certificateVisible,
            certificateHandlerAvailable: state.certificateAvailable,
            onSet: this.model.sitePermissions.set,
            onReset: this.model.sitePermissions.reset,
            onReload: this.reloadAfterPermissionChange,
            onViewCertificate: this.model.sitePermissions.viewCertificate,
        };
    }

    private getAiVisionIndicator(state: BrowserEditorState): AiVisionIndicator {
        return this.model.pageRemote.indicator(state);
    }

    private readonly reloadAfterPermissionChange = (): void => {
        this.model.sitePermissions.state.update((state) => { state.changed = false; state.open = false; });
        this.sitePermissionsPopover.update(this.sitePermissionsPopoverProps());
        this.model.webview.reload();
    };

    private sitePermissionsPopoverProps() {
        return {
            name: "site-permissions-popover",
            open: this.model.sitePermissions.state.get().open,
            elementRef: this.sitePermissionsButton?.root,
            placement: "bottom-start" as const,
            offset: [0, 4] as [number, number],
            outsideClickIgnoreSelector: '[data-name="url-site-permissions"]',
            onClose: () => { this.model.sitePermissions.close(); this.sitePermissionsPopover.update(this.sitePermissionsPopoverProps()); },
            contentView: (host: HTMLElement) => {
                const content = new SitePermissionsContentView(this.sitePermissionsContentProps(), host);
                this.permissionsContent = content;
                return content;
            },
        };
    }

    private readonly handleTranslateClick = (): void => {
        const tabId = this.model.state.get().activeTabId;
        if (this.model.translation.tabView(tabId).state.active) {
            this.translatePopoverOpen = false;
            this.translatePopover.update(this.translatePopoverProps());
            void this.model.translation.toggle(tabId);
            return;
        }
        this.translatePopoverOpen = true;
        this.translatePopover.update(this.translatePopoverProps());
        void this.model.translation.toggle(tabId);
    };

    private homeProps(_state: BrowserEditorState) {
        const active = this.model.activeTab;
        return { name: "toolbar-home", size: "sm" as const, icon: "home" as const,
            title: active?.homeUrl ? t("browser.toolbarGoToHome", { url: active.homeUrl }) : t("browser.toolbarHome"),
            onClick: this.model.goHome, disabled: !active?.homeUrl };
    }
    private backProps(_state: BrowserEditorState) {
        const active = this.model.activeTab;
        return { name: "toolbar-back", size: "sm" as const, icon: "arrow-left" as const,
            title: t("browser.toolbarBack", { shortcut: "Alt+Left" }), onClick: this.model.webview.goBack, disabled: !active?.canGoBack };
    }
    private forwardProps(_state: BrowserEditorState) {
        const active = this.model.activeTab;
        return { name: "toolbar-forward", size: "sm" as const, icon: "arrow-right" as const,
            title: t("browser.toolbarForward", { shortcut: "Alt+Right" }), onClick: this.model.webview.goForward, disabled: !active?.canGoForward };
    }
    private reloadProps(_state: BrowserEditorState) {
        const loading = !!this.model.activeTab?.loading;
        return { name: "toolbar-reload", size: "sm" as const, icon: (loading ? "stop" : "refresh") as IconRef,
            title: loading ? t("browser.toolbarStop") : t("browser.toolbarReload"), onClick: this.model.webview.reloadOrStop };
    }
    private bookmarksProps(_state: BrowserEditorState) {
        return { name: "toolbar-bookmarks", size: "sm" as const, icon: "bookmark" as const,
            title: t("browser.toolbarOpenBookmarks"), onClick: this.model.bookmarks.handleOpenBookmarks };
    }
    private torInfoProps(state: BrowserEditorState) {
        return { name: "toolbar-tor-info", size: "sm" as const, icon: "question" as const,
            title: t("browser.toolbarTorInfo"), onClick: this.model.tor.showInfoDialog, hidden: !state.isTor };
    }
    private moreProps(_state: BrowserEditorState) {
        return { name: "toolbar-more", size: "sm" as const, icon: "more-vert" as const,
            title: t("browser.toolbarPageMenu"), onClick: this.openPageMenuCommand };
    }
    private devtoolsProps(_state: BrowserEditorState) {
        return { name: "toolbar-devtools", size: "sm" as const, icon: "settings" as const,
            title: t("browser.toolbarDevTools"), onClick: this.model.webview.openDevTools };
    }
    private closeProps(_state: BrowserEditorState) {
        return { name: "toolbar-close", size: "sm" as const, icon: "close" as const,
            title: t("shell.closeTab"), onClick: this.closeActiveTab };
    }

    private readonly openPageMenuCommand = (): void => this.openPageMenu();
    private readonly closeActiveTab = (): void => this.model.tabs.closeTab(this.model.state.get().activeTabId);

    private zoomContentProps(): BrowserZoomContentProps {
        return {
            value: this.model.activeTab?.zoomPercent ?? PAGE_ZOOM_DEFAULT,
            onChange: (value) => this.model.webview.setTabZoom(this.model.state.get().activeTabId, value),
        };
    }

    private zoomButtonProps(_state: BrowserEditorState) {
        const value = this.model.activeTab?.zoomPercent ?? PAGE_ZOOM_DEFAULT;
        return { name: "toolbar-page-zoom", size: "sm" as const, children: `${value}%`, title: t("browser.pageZoom"), "aria-label": t("browser.pageZoom"), "aria-expanded": this.zoomOpen, onClick: () => { this.zoomOpen = !this.zoomOpen; if (!this.zoomOpen) this.zoomContent = undefined; this.zoomPopover.update(this.zoomPopoverProps()); this.zoomButton.update(this.zoomButtonProps(this.model.state.get())); } };
    }

    private zoomPopoverProps() {
        return {
            name: "page-zoom-popover", open: this.zoomOpen, elementRef: this.zoomButton?.root,
            placement: "bottom-end" as const, offset: [0, 4] as [number, number],
            outsideClickIgnoreSelector: '[data-name="toolbar-page-zoom"]',
            onClose: () => { this.zoomOpen = false; this.zoomContent = undefined; this.zoomPopover.update(this.zoomPopoverProps()); this.zoomButton.update(this.zoomButtonProps(this.model.state.get())); },
            contentView: (host: HTMLElement) => {
                const content = new BrowserZoomContentView(this.zoomContentProps(), host);
                this.zoomContent = content;
                return content;
            },
        };
    }

    private translatePopoverProps() {
        return {
            name: "translation-source-popover",
            open: this.translatePopoverOpen,
            elementRef: this.translateButton?.root,
            placement: "bottom-start" as const,
            offset: [0, 4] as [number, number],
            outsideClickIgnoreSelector: '[data-name="toolbar-translate"]',
            onClose: () => { this.translatePopoverOpen = false; this.translatePopover.update(this.translatePopoverProps()); },
            contentView: (host: HTMLElement) => {
                const activeTabId = this.model.state.get().activeTabId;
                const view = this.model.translation.tabView(activeTabId);
                const content = new BrowserTranslationPopoverContentView({
                    tabId: activeTabId,
                    state: view.state,
                    pageError: view.page.lastError,
                    onChange: this.model.translation.correctSource,
                }, host);
                this.translateContent = content;
                return content;
            },
        };
    }

    private openSearchMenu(): void { this.searchMenu?.dispose(); this.searchMenu = openMenu(this.searchEngineButton, { name: "search-engine-menu", items: this.model.urlBar.searchEngineMenuItems, placement: "bottom-start", onClose: () => { this.searchMenu = undefined; } }); }
    private openPageMenu(): void { this.pageMenu?.dispose(); this.pageMenu = openMenu(this.moreButton.root, { name: "page-menu", items: getPageMenuItems(this.model), placement: "bottom-end", onClose: () => { this.pageMenu = undefined; } }); }
}

