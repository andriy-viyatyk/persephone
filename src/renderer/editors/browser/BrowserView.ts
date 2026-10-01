const { ipcRenderer } = require("electron");
import { EditorToolbarView } from "../base/EditorToolbarView";
import { BrowserEditor } from "./BrowserEditor";
import type { BrowserEditorState, BrowserTabData } from "./BrowserEditorModel";
import { BrowserChannel, type BrowserRegisterRequest, type BrowserSitePermissionEntry, type BrowserSitePermissionKey, type BrowserSitePermissions } from "../../../ipc/browser-ipc";
import { PageManagerView } from "../../components/page-manager/PageManagerView";
import type { PageSlotViewProps } from "../../components/page-manager/PageSlot";
import { createPanelElement } from "../../uikit/Panel/panel-style";
import { createTextElement } from "../../uikit/Text/text-style";
import type { IconRef } from "../../uikit/shared/slots";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import { SubtreeSwap } from "../../uikit/shared/subtree-swap";
import type { VanillaViewCtor } from "../../uikit/shared/vanilla-view";
import { InputView } from "../../uikit/Input/InputView";
import { IconButtonView } from "../../uikit/IconButton/IconButtonView";
import { ButtonView } from "../../uikit/Button/ButtonView";
import { SwitchView } from "../../uikit/Switch/SwitchView";
import { PopoverView } from "../../uikit/Popover/PopoverView";
import { SpinnerView } from "../../uikit/Spinner/SpinnerView";
import { DotView } from "../../uikit/Dot/DotView";
import { SplitterView } from "../../uikit/Splitter/SplitterView";
import { openMenu, type MenuHandle } from "../../uikit/Menu/attach-menu";
import { IncognitoIcon, TorIcon } from "../../theme/language-icons";
import color from "../../theme/color";
import { dismissOverlays } from "../../uikit/shared/overlayLayer";
import { BrowserTabsPanelView } from "./BrowserTabsPanel";
import { BookmarksDrawerView, type BookmarksDrawerProps } from "./BookmarksDrawer";
import { TorStatusOverlayView } from "./TorStatusOverlay";
import { UrlSuggestionsDropdownView } from "./UrlSuggestionsDropdown";
import { DownloadButtonView } from "./DownloadButton";
import { BrowserSecondaryViewsView } from "./BrowserSecondaryViews";
import { BrowserBookmarks } from "./BrowserBookmarks";
import { LinkActionView, LinkBreadcrumbView } from "../link-editor";
import { LinkBodyView } from "../link-editor/LinkBody";
import { FindBarView } from "../shared/FindBarView";
import { focusAfterPaint } from "../../core/utils/scheduling";
import "./BrowserView.css";
import "../../uikit/Panel/Panel.css";
import "../../uikit/Text/Text.css";
import "../../uikit/Input/Input.css";
import "../../uikit/IconButton/IconButton.css";
import "../../uikit/Button/Button.css";
import "../../uikit/Switch/Switch.css";
import "../../uikit/Popover/Popover.css";
import "../../uikit/Spinner/Spinner.css";
import "../../uikit/Dot/Dot.css";
import "../../uikit/Splitter/Splitter.css";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const WEBVIEW_PRELOAD_URL = (window as any).webviewPreloadUrl as string;
const isBlankUrl = (url: string | undefined): boolean => !url || url === "about:blank";

interface BrowserWebviewItemProps {
    model: BrowserEditor;
    tab: BrowserTabData;
    isActive: boolean;
    partition: string;
}

/** Owns exactly one connected webview and its guest IPC registration. */
export class BrowserWebviewItemView extends VanillaView<BrowserWebviewItemProps> {
    private readonly model: BrowserEditor;
    private readonly tabId: string;
    private readonly webview: Electron.WebviewTag;
    private registered = false;
    private wasCurrentWebview = false;
    private htmlFullscreen = false;

    public constructor(props: BrowserWebviewItemProps) {
        const wrapper = document.createElement("div");
        wrapper.dataset.webviewWrapper = "";
        const webview = document.createElement("webview") as Electron.WebviewTag;
        wrapper.append(webview);
        super(props, wrapper);
        this.model = props.model;
        this.tabId = props.tab.id;
        this.webview = webview;
        this.webview.src = props.tab.url;
        this.webview.partition = props.partition;
        this.webview.preload = WEBVIEW_PRELOAD_URL;
        this.webview.setAttribute("allowpopups", "true");
        this.updateBackground(props.tab);
    }

    protected onMount(): void {
        const existing = this.model.webview.webviewRefs.get(this.tabId);
        if (existing && existing !== this.webview && existing.isConnected) {
            // Preserve the US-806 duplicate-connected-webview warning verbatim in meaning.
            console.warn(
                `[browser] duplicate webview mount for tab ${this.tabId} — `
                    + "previous webview is still connected (US-806)",
            );
        }
        this.model.webview.webviewRefs.set(this.tabId, this.webview);
        // Delete only our OWN entry. The earlier implementation deleted unconditionally, but its
        // duplicate-mount warning above exists precisely because "a new view mounted before
        // the old one unmounted" has been observed for this tab key (US-806, trigger unknown).
        // In that ordering an unconditional delete removes the *live* webview from the map, so
        // `webviewRefs.get(tabId)` reports nothing for a tab that has one — and the tab then
        // silently stops responding to navigation while its guest renderer stays alive. This is
        // the same class as the board bridge regression (EPIC-072 C1a): on a shared key, the
        // entry you did not put there belongs to somebody else. Identical in the normal path.
        this.own(() => {
            this.wasCurrentWebview = this.model.webview.webviewRefs.get(this.tabId) === this.webview;
            if (this.wasCurrentWebview) {
                this.model.webview.webviewRefs.delete(this.tabId);
            }
        });

        // Focus can reach the guest without a press in it (keyboard traversal, a
        // programmatic focus), so this is a second dismissal trigger alongside the
        // `guest-pointerdown` ping below — and it carried the same dead `mousedown`.
        const onFocus = (): void => {
            dismissOverlays();
        };
        this.listenNative("focus", onFocus);

        const onDomReady = (): void => {
            if (this.model.webview.webviewRefs.get(this.tabId) !== this.webview) return;
            const currentUrl = this.webview.getURL();
            if (currentUrl && currentUrl !== "about:blank") this.model.tabs.currentUrls.set(this.tabId, currentUrl);
            this.model.webview.webviewReady.add(this.tabId);
            const request: BrowserRegisterRequest = {
                tabId: this.model.id,
                internalTabId: this.tabId,
                webContentsId: this.webview.getWebContentsId(),
            };
            ipcRenderer.send(BrowserChannel.register, request);
            this.registered = true;
            if (this.model.state.get().pageMuted) {
                ipcRenderer.send(BrowserChannel.setAudioMuted, `${this.model.id}/${this.tabId}`, true);
            }
            // Probe here as well as on `did-stop-loading`: a tab restored with the page (a session
            // restore, or a tab mounted lazily) has already finished loading, so the load events the
            // probe normally rides never fire for it and its `.app` would stay missing until the
            // user navigated. The probe dedupes per tab and document generation, so this costs at
            // most the one evaluate it would have cost anyway.
            this.model.webview.probeAiVisionOnReady(this.tabId);
        };
        this.listenNative("dom-ready", onDomReady);

        const onIpcMessage = (event: Electron.IpcMessageEvent): void => {
            const { channel, args } = event;
            if (channel === "page-title") {
                const title = args[0] as string;
                if (title) this.model.updateTab(this.tabId, { pageTitle: title });
            } else if (channel === "page-favicon") {
                this.handleFavicon(args[0] as string);
            } else if (channel === "clicked-images") {
                const urls = args[0] as string[];
                if (Array.isArray(urls) && urls.length) this.model.bookmarksUI.trackClickedImages(this.tabId, urls);
            } else if (channel === "guest-pointerdown") {
                dismissOverlays();
            } else if (channel === "show-find-bar") {
                this.model.webview.openFind();
            } else if (channel === "hide-find-bar" && this.model.state.get().findBarVisible) {
                this.model.webview.closeFind();
            }
        };
        this.listenNative("ipc-message", onIpcMessage);

        // HTML fullscreen (a video's fullscreen button). Electron makes the window fullscreen but
        // leaves the webview in its box, so the wrapper is stretched over the whole app. If the
        // webview is then hidden — the video opened an ad in a new tab, or the user switched
        // pages — the window would stay fullscreen with nothing to leave it by, so leave it.
        this.listenNative("enter-html-full-screen", () => this.setHtmlFullscreen(true));
        this.listenNative("leave-html-full-screen", () => this.setHtmlFullscreen(false));
        const hiddenObserver = new ResizeObserver(() => {
            if (this.htmlFullscreen && this.root.offsetWidth === 0 && this.root.offsetHeight === 0) {
                this.setHtmlFullscreen(false);
                if (this.registered) ipcRenderer.send(BrowserChannel.exitHtmlFullscreen, `${this.model.id}/${this.tabId}`);
            }
        });
        hiddenObserver.observe(this.root);
        this.own(() => hiddenObserver.disconnect());
        // Escape normally reaches the page's own key hook in the main process. When keyboard focus
        // is in Persephone instead, the key lands here; it must still leave the fullscreen video.
        const onDocumentKeyDown = (event: KeyboardEvent): void => {
            if (!this.htmlFullscreen || event.key !== "Escape" || !this.registered) return;
            event.preventDefault();
            ipcRenderer.send(BrowserChannel.exitHtmlFullscreen, `${this.model.id}/${this.tabId}`);
        };
        document.addEventListener("keydown", onDocumentKeyDown, true);
        this.own(() => document.removeEventListener("keydown", onDocumentKeyDown, true));

        const onFoundInPage = (event: Electron.FoundInPageEvent): void => {
            if (this.props.isActive) this.model.webview.handleFoundInPage(event.result);
        };
        this.listenNative("found-in-page", onFoundInPage);
        this.own(() => {
            const ownsWebview = this.wasCurrentWebview || this.model.webview.webviewRefs.get(this.tabId) === this.webview;
            if (ownsWebview) this.model.webview.webviewReady.delete(this.tabId);
            if (ownsWebview && this.registered) {
                ipcRenderer.send(BrowserChannel.unregister, `${this.model.id}/${this.tabId}`);
                this.registered = false;
            }
        });
    }

    protected onUpdate(props: BrowserWebviewItemProps): void { this.updateBackground(props.tab); }

    private setHtmlFullscreen(fullscreen: boolean): void {
        this.htmlFullscreen = fullscreen;
        this.root.toggleAttribute("data-html-fullscreen", fullscreen);
    }

    private updateBackground(tab: BrowserTabData): void {
        this.webview.style.backgroundColor = isBlankUrl(tab.url) ? color.background.default : color.background.webview;
    }

    private handleFavicon(faviconUrl: string): void {
        if (!faviconUrl) return;
        const webview = this.webview;
        if (this.model.webview.webviewRefs.get(this.tabId) !== webview) return;
        const currentUrl = this.webview.getURL() || this.model.tabs.currentUrls.get(this.tabId) || "";
        this.model.tabs.cacheFavicon(currentUrl, faviconUrl);
        this.model.updateTab(this.tabId, { favicon: faviconUrl });
        const state = this.model.state.get();
        if (state.isIncognito || state.isTor) return;
        // A proxied profile downloads it through its own session (US-1557).
        const routedUrl = this.model.network.routedFetchUrl(faviconUrl);
        if (routedUrl === null) return;
        void import("../../components/icons/favicon-cache").then((cache) => {
            if (this.model.webview.webviewRefs.get(this.tabId) !== webview) return;
            const hostname = cache.getHostname(currentUrl);
            if (!hostname) return;
            if (cache.consumeFaviconSaveRequest(hostname)) { cache.saveFavicon(hostname, faviconUrl, routedUrl); return; }
            const bookmarks = this.model.tabs.bookmarks;
            if (bookmarks && bookmarks.linkEditor.state.get().data.links.some((link: { href: string }) => cache.getHostname(link.href) === hostname)) {
                cache.saveFavicon(hostname, faviconUrl, routedUrl);
            }
        });
    }

    private listenNative(type: string, listener: (event: never) => void): void {
        this.webview.addEventListener(type, listener as EventListener);
        this.own(() => this.webview.removeEventListener(type, listener as EventListener));
    }
}

class BlankPageLinksView extends VanillaView<{ bookmarks: BrowserBookmarks }> {
    private readonly breadcrumb: LinkBreadcrumbView;
    private readonly actions: LinkActionView;
    private readonly secondary: BrowserSecondaryViewsView;
    private readonly body: LinkBodyView;

    public constructor(props: { bookmarks: BrowserBookmarks }) {
        const toolbar = createPanelElement({ name: "blank-page-toolbar", direction: "row", align: "center", gap: "xs", paddingX: "md", paddingY: "xs", background: "dark", borderBottom: true, shrink: false, minHeight: 32 });
        const body = createPanelElement({ name: "blank-page-body", direction: "row", flex: true, overflow: "hidden" });
        const content = createPanelElement({ flex: true, overflow: "hidden" });
        super(props, createPanelElement({ name: "blank-page", position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 3, direction: "column", background: "default" }, [toolbar, body]));
        this.breadcrumb = this.child(new LinkBreadcrumbView({ model: props.bookmarks.linkEditor }));
        this.actions = this.child(new LinkActionView({ model: props.bookmarks.linkEditor }));
        this.secondary = this.child(new BrowserSecondaryViewsView({ host: props.bookmarks.panelHost }));
        this.body = this.child(new LinkBodyView({ model: props.bookmarks.linkEditor }));
        toolbar.append(this.breadcrumb.root, createPanelElement({ flex: true }), this.actions.root);
        content.append(this.body.root);
        body.append(this.secondary.root, content);
    }

    protected onMount(): void { this.breadcrumb.mount(); this.actions.mount(); this.secondary.mount(); this.body.mount(); }
}

export class BrowserTabPageView extends VanillaView<{ model: BrowserEditor; tabId: string }> {
    private readonly model: BrowserEditor;
    private readonly webview: BrowserWebviewItemView;
    private readonly blankSwap: SubtreeSwap<"blank">;
    private blankView: BlankPageLinksView | undefined;

    public constructor(props: { model: BrowserEditor; tabId: string }) {
        const tab = props.model.state.get().tabs.find((item) => item.id === props.tabId);
        if (!tab) throw new Error(`Browser tab ${props.tabId} was not found.`);
        super(props, document.createElement("div"));
        this.root.style.position = "absolute"; this.root.style.inset = "0";
        this.model = props.model;
        this.webview = this.child(new BrowserWebviewItemView({ model: props.model, tab, isActive: props.model.state.get().activeTabId === props.tabId, partition: props.model.partition }));
        this.blankSwap = new SubtreeSwap(this.root);
        this.own(() => this.blankSwap.dispose());
    }

    protected onMount(): void {
        this.root.append(this.webview.root); this.webview.mount(); this.sync();
        this.bind(this.model.state, (state) => ({ tab: state.tabs.find((item) => item.id === this.props.tabId), active: state.activeTabId === this.props.tabId, bookmarksReady: state.bookmarksReady, bookmarks: this.model.tabs.bookmarks }), this.sync);
    }

    protected onUpdate(): void { this.sync(); }

    private readonly sync = (): void => {
        const state = this.model.state.get();
        const tab = state.tabs.find((item) => item.id === this.props.tabId);
        if (!tab) return;
        this.webview.update({ model: this.model, tab, isActive: state.activeTabId === this.props.tabId, partition: this.model.partition });
        const bookmarks = state.bookmarksReady ? this.model.tabs.bookmarks : null;
        if (!isBlankUrl(tab.url) || !bookmarks) { this.blankView = undefined; this.blankSwap.clear(); return; }
        let created: BlankPageLinksView | undefined;
        this.blankSwap.set("blank", () => { created = new BlankPageLinksView({ bookmarks }); this.blankView = created; return created; });
        created?.mount();
    };
}

interface ProfileNetworkErrorProps { model: BrowserEditor; error: string; }

/** Shown instead of the page's webviews when its profile proxy could not be applied (US-1557). */
class ProfileNetworkErrorView extends VanillaView<ProfileNetworkErrorProps> {
    private readonly message = createTextElement("", { size: "sm", color: "light" });
    private readonly retry: ButtonView;

    public constructor(props: ProfileNetworkErrorProps) {
        super(props, createPanelElement({ name: "profile-network-error", position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 5, background: "dark", direction: "column", align: "center", gap: "lg", paddingTop: "xxxl" }));
        this.retry = this.child(new ButtonView({ name: "profile-network-retry", children: "Retry", onClick: () => { void props.model.retryProfileNetwork(); } }));
        this.root.append(createTextElement("The profile's proxy could not be applied, so no page is loaded.", { size: "md" }), this.message, this.retry.root);
    }
    protected onMount(): void { this.retry.mount(); this.sync(this.props); }
    protected onUpdate(props: ProfileNetworkErrorProps): void { this.sync(props); }
    private sync(props: ProfileNetworkErrorProps): void { this.message.textContent = `${props.error} Fix the profile's network in Settings → Browser Profiles, then retry.`; }
}

interface BrowserToolbarProps { model: BrowserEditor; state: BrowserEditorState; }

interface SitePermissionsContentProps {
    permissions: BrowserSitePermissions;
    changed: boolean;
    onSet: (key: BrowserSitePermissionKey, decision: "allow" | "block") => void;
    onReset: () => void;
    onReload: () => void;
}

const SITE_PERMISSION_LABELS: Record<string, string> = {
    camera: "Camera",
    microphone: "Microphone",
    geolocation: "Location",
    notifications: "Notifications",
    midi: "MIDI",
    midiSysex: "MIDI full control (SysEx)",
    "clipboard-read": "Clipboard read",
    "idle-detection": "Device use (idle detection)",
    "window-management": "Window management",
    "speaker-selection": "Speaker selection",
};

class SitePermissionsContentView extends VanillaView<SitePermissionsContentProps> {
    // The popover shell owns its own `data-type`; this editor-owned content root is the styling hook.
    private readonly contentRoot = document.createElement("div");
    private readonly heading = createTextElement("", { size: "md", bold: true });
    private readonly rows = document.createElement("div");
    private readonly reset: ButtonView;
    private readonly reloadHint = createTextElement("Reload the page to apply", { size: "sm", color: "light" });
    private readonly reload: ButtonView;
    private readonly rowViews = new Map<BrowserSitePermissionKey, { row: HTMLDivElement; label: HTMLSpanElement; hint: HTMLSpanElement; toggle: SwitchView }>();

    public constructor(props: SitePermissionsContentProps, host: HTMLElement) {
        super(props, host);
        this.rows.dataset.part = "permission-list";
        this.reset = this.child(new ButtonView({ name: "site-permissions-reset", variant: "ghost", size: "sm", children: "Reset permissions", onClick: () => this.props.onReset() }));
        this.reload = this.child(new ButtonView({ name: "site-permissions-reload", variant: "link", size: "sm", children: "Reload", onClick: () => this.props.onReload() }));
    }

    protected onMount(): void {
        this.contentRoot.dataset.type = "browser-site-permissions";
        this.contentRoot.append(this.heading, this.rows, this.reset.root);
        const reloadRow = document.createElement("div");
        reloadRow.dataset.part = "reload-hint";
        reloadRow.append(this.reloadHint, this.reload.root);
        this.contentRoot.append(reloadRow);
        this.root.append(this.contentRoot);
        this.reset.mount();
        this.reload.mount();
        this.sync(this.props);
    }

    protected onUpdate(props: SitePermissionsContentProps): void {
        this.sync(props);
    }

    private sync(props: SitePermissionsContentProps): void {
        this.heading.textContent = props.permissions.origin;
        this.contentRoot.dataset.changed = props.changed ? "" : "false";
        const entries = props.permissions.entries;
        const entryKeys = new Set(entries.map((entry) => entry.key));
        for (const [key, row] of this.rowViews) {
            if (entryKeys.has(key)) continue;
            this.releaseChild(row.toggle);
            row.row.remove();
            this.rowViews.delete(key);
        }
        const orderedRows: HTMLDivElement[] = [];
        for (const entry of entries) {
            const row = this.getOrCreateRow(entry);
            row.label.textContent = this.permissionLabel(entry.key);
            row.hint.textContent = entry.decision === undefined ? "Ask" : "";
            row.hint.hidden = entry.decision !== undefined;
            row.toggle.update({ name: `site-permission-${entry.key.replace(/[^a-z0-9-]/gi, "-")}`, label: this.permissionLabel(entry.key), checked: entry.decision === "allow", size: "sm", onChange: (checked) => this.props.onSet(entry.key, checked ? "allow" : "block") });
            orderedRows.push(row.row);
        }
        this.rows.replaceChildren(...orderedRows);
        this.reloadHint.hidden = !props.changed;
        this.reload.root.hidden = !props.changed;
    }

    private getOrCreateRow(entry: BrowserSitePermissionEntry): { row: HTMLDivElement; label: HTMLSpanElement; hint: HTMLSpanElement; toggle: SwitchView } {
        const existing = this.rowViews.get(entry.key);
        if (existing) return existing;
        const row = document.createElement("div");
        row.dataset.part = "permission-row";
        const copy = document.createElement("div");
        copy.dataset.part = "permission-copy";
        const label = createTextElement("");
        const hint = createTextElement("", { size: "sm", color: "light" });
        hint.dataset.part = "permission-ask";
        copy.append(label, hint);
        const toggle = this.child(new SwitchView({ name: `site-permission-${entry.key}`, label: this.permissionLabel(entry.key), checked: entry.decision === "allow", size: "sm", onChange: (checked) => this.props.onSet(entry.key, checked ? "allow" : "block") }));
        row.append(copy, toggle.root);
        if (this.root.isConnected) toggle.mount();
        const view = { row, label, hint, toggle };
        this.rowViews.set(entry.key, view);
        return view;
    }

    private permissionLabel(key: string): string {
        if (key.startsWith("openExternal:")) return `Open ${key.slice("openExternal:".length)} links`;
        return SITE_PERMISSION_LABELS[key] ?? key;
    }
}

class BrowserToolbarView extends VanillaView<BrowserToolbarProps> {
    private readonly model: BrowserEditor;
    private readonly controls: IconButtonView[];
    private readonly input: InputView;
    private readonly navigate: IconButtonView;
    private readonly star: IconButtonView;
    private readonly inputPanel: HTMLDivElement;
    private readonly startSlot: HTMLSpanElement;
    private readonly endSlot: HTMLSpanElement;
    private readonly torIndicator = document.createElement("span");
    private readonly searchEngineButton = document.createElement("button");
    private readonly sitePermissionsButton: IconButtonView;
    private readonly sitePermissionsPopover: PopoverView;
    /** Proxied-profile marker (US-1557); opens the network info dialog. */
    private readonly proxyChip = document.createElement("button");
    private pageMenu: MenuHandle | undefined;
    private searchMenu: MenuHandle | undefined;
    private permissionsContent: SitePermissionsContentView | undefined;
    private permissionsOpen = false;
    private permissionsChanged = false;
    private permissionsData: BrowserSitePermissions = { origin: "", entries: [] };
    private permissionsRegistrationKey = "";
    private permissionsOrigin = "";
    private permissionsLoadGeneration = 0;
    private spinner: SpinnerView | undefined;
    private dot: DotView | undefined;

    public constructor(props: BrowserToolbarProps) {
        super(props, createPanelElement({ name: "browser-toolbar-content", direction: "row", align: "center", flex: true, gap: "xs" }));
        this.model = props.model;
        this.startSlot = document.createElement("span"); this.startSlot.style.display = "contents";
        this.endSlot = document.createElement("span"); this.endSlot.style.display = "contents";
        this.torIndicator.dataset.torIndicator = "";
        this.searchEngineButton.type = "button"; this.searchEngineButton.dataset.searchEngineChip = "";
        this.proxyChip.type = "button"; this.proxyChip.dataset.proxyChip = ""; this.proxyChip.dataset.name = "url-proxy-indicator"; this.proxyChip.textContent = "Proxy";
        this.inputPanel = createPanelElement({ name: "url-bar", flex: true }); this.inputPanel.dataset.urlBar = "";
        const make = (name: string, icon: IconRef, title: string, onClick: () => void): IconButtonView => this.child(new IconButtonView({ name, size: "sm", icon, title, onClick }));
        const home = make("toolbar-home", "home", "Home", this.model.goHome);
        const back = make("toolbar-back", "arrow-left", "Back (Alt+Left)", this.model.webview.goBack);
        const forward = make("toolbar-forward", "arrow-right", "Forward (Alt+Right)", this.model.webview.goForward);
        const reload = make("toolbar-reload", "refresh", "Reload", this.model.webview.reloadOrStop);
        this.controls = [home, back, forward, reload];
        this.navigate = this.child(new IconButtonView({ name: "url-navigate", size: "sm", icon: "arrow-right", title: "Navigate", onClick: this.model.urlBar.handleNavigate }));
        this.sitePermissionsButton = this.child(new IconButtonView({ name: "url-site-permissions", size: "sm", icon: "info", title: "Site permissions", onClick: this.toggleSitePermissions }));
        this.sitePermissionsPopover = this.child(new PopoverView(this.sitePermissionsPopoverProps()));
        this.star = this.child(new IconButtonView({ name: "url-bookmark-toggle", size: "sm", icon: "star", title: "Add Bookmark", onClick: this.model.bookmarksUI.handleStarClick }));
        this.input = this.child(new InputView({ name: "url-input", size: "sm", value: props.state.urlInput, onChange: this.model.urlBar.handleUrlChange, onKeyDown: this.model.urlBar.handleUrlKeyDown, onFocus: this.model.urlBar.handleUrlFocus, onBlur: this.model.urlBar.handleUrlBlur, onContextMenu: (event) => this.model.urlBar.handleUrlContextMenu(event as never), placeholder: "Enter URL or search term...", autoComplete: "off", startSlot: this.startSlot, endSlot: this.endSlot }));
        const bookmarks = make("toolbar-bookmarks", "bookmark", "Open Bookmarks", this.model.bookmarksUI.handleOpenBookmarks);
        const torInfo = make("toolbar-tor-info", "question", "Tor connection info", this.model.showTorInfoDialog);
        const downloads = this.child(new DownloadButtonView());
        const more = make("toolbar-more", "more-vert", "Page Menu", () => this.openPageMenu());
        const devtools = make("toolbar-devtools", "settings", "Open DevTools", this.model.webview.openDevTools);
        const close = make("toolbar-close", "close", "Close Tab", () => this.model.closeTab(this.model.state.get().activeTabId));
        this.controls.push(bookmarks, torInfo, more, devtools, close);
        this.endSlot.append(this.navigate.root, this.star.root);
        this.inputPanel.append(this.input.root);
        // Spell the DOM order out once, left to right, rather than appending `this.controls`
        // in construction order and patching it with insertBefore. `this.controls` keeps its
        // own order because sync() indexes into it positionally.
        this.root.append(
            home.root, back.root, forward.root, reload.root,
            this.inputPanel,
            bookmarks.root, torInfo.root, downloads.root,
            more.root, devtools.root, close.root,
            this.sitePermissionsPopover.root,
        );
        this.downloads = downloads;
    }

    private readonly downloads: DownloadButtonView;
    get urlAnchor(): Element { return this.inputPanel; }
    get urlInputElement(): HTMLInputElement { return this.input.inputElement; }

    protected onMount(): void { this.listen(this.searchEngineButton, "click", (event) => { event.stopPropagation(); this.openSearchMenu(); }); this.listen(this.torIndicator, "click", (event) => { event.stopPropagation(); this.model.toggleTorOverlay(); }); this.listen(this.proxyChip, "click", (event) => { event.stopPropagation(); void this.model.showNetworkInfoDialog(); }); this.controls.forEach((view) => view.mount()); this.input.mount(); this.model.urlBar.setUrlInputRef(this.input.inputElement); this.navigate.mount(); this.star.mount(); this.downloads.mount(); this.sitePermissionsButton.mount(); this.sitePermissionsPopover.mount(); this.sync(this.props.state); }
    protected onUpdate(props: BrowserToolbarProps): void { this.sync(props.state); }
    protected onDispose(): void { this.pageMenu?.dispose(); this.searchMenu?.dispose(); this.pageMenu = undefined; this.searchMenu = undefined; this.permissionsLoadGeneration++; }

    private sync(state: BrowserEditorState): void {
        const active = state.tabs.find((tab) => tab.id === state.activeTabId);
        this.controls[0].update({ name: "toolbar-home", size: "sm", icon: "home", title: active?.homeUrl ? `Go to ${active.homeUrl}` : "Home", onClick: this.model.goHome, disabled: !active?.homeUrl });
        this.controls[1].update({ name: "toolbar-back", size: "sm", icon: "arrow-left", title: "Back (Alt+Left)", onClick: this.model.webview.goBack, disabled: !state.canGoBack });
        this.controls[2].update({ name: "toolbar-forward", size: "sm", icon: "arrow-right", title: "Forward (Alt+Right)", onClick: this.model.webview.goForward, disabled: !state.canGoForward });
        this.controls[3].update({ name: "toolbar-reload", size: "sm", icon: state.loading ? "stop" : "refresh", title: state.loading ? "Stop" : "Reload", onClick: this.model.webview.reloadOrStop });
        this.input.update({ name: "url-input", size: "sm", value: state.urlInput, onChange: this.model.urlBar.handleUrlChange, onKeyDown: this.model.urlBar.handleUrlKeyDown, onFocus: this.model.urlBar.handleUrlFocus, onBlur: this.model.urlBar.handleUrlBlur, onContextMenu: (event) => this.model.urlBar.handleUrlContextMenu(event as never), placeholder: "Enter URL or search term...", autoComplete: "off", startSlot: this.startSlot, endSlot: this.endSlot });
        this.navigate.update({ name: "url-navigate", size: "sm", icon: "arrow-right", title: "Navigate", onClick: this.model.urlBar.handleNavigate });
        this.star.update({ name: "url-bookmark-toggle", size: "sm", icon: state.isBookmarked ? "star-filled" : "star", title: state.isBookmarked ? "Edit Bookmark" : "Add Bookmark", active: state.isBookmarked, onClick: this.model.bookmarksUI.handleStarClick });
        this.controls[4].update({ name: "toolbar-bookmarks", size: "sm", icon: "bookmark", title: "Open Bookmarks", onClick: this.model.bookmarksUI.handleOpenBookmarks });
        this.controls[5].update({ name: "toolbar-tor-info", size: "sm", icon: "question", title: "Tor connection info", onClick: this.model.showTorInfoDialog, hidden: !state.isTor });
        this.controls[6].update({ name: "toolbar-more", size: "sm", icon: "more-vert", title: "Page Menu", onClick: () => this.openPageMenu() });
        this.controls[7].update({ name: "toolbar-devtools", size: "sm", icon: "settings", title: "Open DevTools", onClick: this.model.webview.openDevTools });
        this.controls[8].update({ name: "toolbar-close", size: "sm", icon: "close", title: "Close Tab", onClick: () => this.model.closeTab(this.model.state.get().activeTabId) });
        this.renderStart(state);
        this.sitePermissionsPopover.update(this.sitePermissionsPopoverProps());
        this.permissionsContent?.update(this.sitePermissionsContentProps());
        this.pageMenu?.update({ name: "page-menu", items: this.model.webview.getPageMenuItems(), placement: "bottom-end" });
        this.searchMenu?.update({ name: "search-engine-menu", items: this.model.urlBar.searchEngineMenuItems, placement: "bottom-start" });
    }

    private renderStart(state: BrowserEditorState): void {
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
        if (state.networkLabel) { this.proxyChip.title = `Proxy: ${state.networkLabel} — click for connection info`; this.startSlot.append(this.proxyChip); }
        const registrationKey = `${state.id}/${state.activeTabId}`;
        const activeUrl = state.tabs.find((tab) => tab.id === state.activeTabId)?.url ?? "";
        let origin = "";
        try {
            const url = new URL(activeUrl);
            if (url.protocol === "http:" || url.protocol === "https:") origin = url.origin;
        } catch { /* Non-web URL: no site-permissions control. */ }
        if (this.permissionsRegistrationKey !== registrationKey || this.permissionsOrigin !== origin) {
            this.permissionsRegistrationKey = registrationKey;
            this.permissionsOrigin = origin;
            this.permissionsData = { origin, entries: [] };
            this.permissionsChanged = false;
            if (this.permissionsOpen && origin) void this.loadSitePermissions();
        }
        const showSearchEngine = this.model.urlBar.showSearchEngineSelector;
        if (!origin || showSearchEngine || state.userHasTyped) this.permissionsOpen = false;
        if (showSearchEngine) { this.searchEngineButton.textContent = `${this.model.urlBar.currentEngineName} ▾`; this.startSlot.append(this.searchEngineButton); }
        else if (origin && !state.userHasTyped) this.startSlot.append(this.sitePermissionsButton.root);
    }

    private readonly toggleSitePermissions = (): void => {
        this.permissionsOpen = !this.permissionsOpen;
        if (this.permissionsOpen) void this.loadSitePermissions();
        this.sitePermissionsPopover.update(this.sitePermissionsPopoverProps());
    };

    private async loadSitePermissions(): Promise<void> {
        const generation = ++this.permissionsLoadGeneration;
        const registrationKey = this.permissionsRegistrationKey;
        try {
            const permissions = await this.model.getSitePermissions(registrationKey);
            if (generation !== this.permissionsLoadGeneration || registrationKey !== this.permissionsRegistrationKey
                || permissions.origin !== this.permissionsOrigin) return;
            this.permissionsData = permissions;
            this.permissionsContent?.update(this.sitePermissionsContentProps());
        } catch { /* An unavailable webview simply has no permissions to display. */ }
    }

    private readonly setSitePermission = async (key: BrowserSitePermissionKey, decision: "allow" | "block"): Promise<void> => {
        const registrationKey = this.permissionsRegistrationKey;
        const changed = await this.model.setSitePermission(registrationKey, key, decision);
        if (!changed || registrationKey !== this.permissionsRegistrationKey) return;
        this.permissionsChanged = true;
        await this.loadSitePermissions();
        this.permissionsContent?.update(this.sitePermissionsContentProps());
    };

    private readonly resetSitePermissions = async (): Promise<void> => {
        const registrationKey = this.permissionsRegistrationKey;
        const reset = await this.model.resetSitePermissions(registrationKey);
        if (!reset || registrationKey !== this.permissionsRegistrationKey) return;
        this.permissionsChanged = true;
        await this.loadSitePermissions();
        this.permissionsContent?.update(this.sitePermissionsContentProps());
    };

    private sitePermissionsContentProps(): SitePermissionsContentProps {
        return { permissions: this.permissionsData, changed: this.permissionsChanged, onSet: this.setSitePermission, onReset: this.resetSitePermissions, onReload: this.reloadAfterPermissionChange };
    }

    private readonly reloadAfterPermissionChange = (): void => {
        this.permissionsChanged = false;
        this.permissionsOpen = false;
        this.sitePermissionsPopover.update(this.sitePermissionsPopoverProps());
        this.model.webview.reload();
    };

    private sitePermissionsPopoverProps() {
        return {
            name: "site-permissions-popover",
            open: this.permissionsOpen,
            elementRef: this.sitePermissionsButton?.root,
            placement: "bottom-start" as const,
            offset: [0, 4] as [number, number],
            outsideClickIgnoreSelector: '[data-name="url-site-permissions"]',
            onClose: () => { this.permissionsOpen = false; this.sitePermissionsPopover.update(this.sitePermissionsPopoverProps()); },
            contentView: (host: HTMLElement) => {
                const content = new SitePermissionsContentView(this.sitePermissionsContentProps(), host);
                this.permissionsContent = content;
                return content;
            },
        };
    }

    private openSearchMenu(): void { this.searchMenu?.dispose(); this.searchMenu = openMenu(this.searchEngineButton, { name: "search-engine-menu", items: this.model.urlBar.searchEngineMenuItems, placement: "bottom-start", onClose: () => { this.searchMenu = undefined; } }); }
    private openPageMenu(): void { this.pageMenu?.dispose(); this.pageMenu = openMenu(this.controls[6].root, { name: "page-menu", items: this.model.webview.getPageMenuItems(), placement: "bottom-end", onClose: () => { this.pageMenu = undefined; } }); }
}

class PopupBlockedView extends VanillaView<{ model: BrowserEditor; count: number }> {
    private readonly text = createTextElement("");
    private readonly allow: ButtonView;
    private readonly dismiss: IconButtonView;
    public constructor(props: { model: BrowserEditor; count: number }) {
        const root = createPanelElement({ name: "popup-blocked-bar", direction: "row", align: "center", gap: "md", paddingX: "md", paddingY: "xs", background: "light", borderBottom: true, shrink: false });
        super(props, root); this.allow = this.child(new ButtonView({ name: "popup-allow", size: "sm", variant: "ghost", children: "Allow", onClick: props.model.allowPopups })); this.dismiss = this.child(new IconButtonView({ name: "popup-dismiss", size: "sm", icon: "close", title: "Dismiss", onClick: props.model.dismissBlockedPopups }));
        root.append(createPanelElement({ flex: true }, [this.text]), this.allow.root, this.dismiss.root);
    }
    protected onMount(): void { this.allow.mount(); this.dismiss.mount(); this.sync(); }
    protected onUpdate(props: { model: BrowserEditor; count: number }): void { this.props = props; this.sync(); }
    private sync(): void { this.text.textContent = this.props.count === 1 ? "A popup was blocked on this page" : `${this.props.count} popups were blocked on this page`; }
}

class PermissionPromptBarView extends VanillaView<{ model: BrowserEditor; prompt: BrowserEditorState["permissionPrompts"][number] }> {
    private readonly origin = createTextElement("");
    private readonly requestText = createTextElement("");
    private readonly allow: ButtonView;
    private readonly block: ButtonView;

    public constructor(props: { model: BrowserEditor; prompt: BrowserEditorState["permissionPrompts"][number] }) {
        const root = createPanelElement({ name: "browser-permission-prompt", direction: "row", align: "center", gap: "md", paddingX: "md", paddingY: "xs", background: "light", borderBottom: true, shrink: false });
        super(props, root);
        const details = createPanelElement({ name: "permission-prompt-copy", flex: true, direction: "column", gap: "xs" });
        details.append(this.origin, this.requestText);
        this.allow = this.child(new ButtonView({ name: "permission-allow", size: "sm", variant: "ghost", children: "Allow", onClick: () => this.resolve("allow") }));
        this.block = this.child(new ButtonView({ name: "permission-block", size: "sm", variant: "ghost", children: "Block", onClick: () => this.resolve("block") }));
        root.append(details, this.allow.root, this.block.root);
    }

    protected onMount(): void { this.allow.mount(); this.block.mount(); this.sync(); }
    protected onUpdate(props: { model: BrowserEditor; prompt: BrowserEditorState["permissionPrompts"][number] }): void { this.props = props; this.sync(); }

    private sync(): void {
        const prompt = this.props.prompt;
        this.origin.textContent = prompt.topLevelOrigin;
        this.origin.dataset.name = "permission-origin";
        const labels: Record<string, string> = {
            camera: "camera", microphone: "microphone", geolocation: "location", notifications: "notifications",
            midi: "MIDI devices", midiSysex: "MIDI system messages", "clipboard-read": "clipboard contents",
            "idle-detection": "idle detection", "window-management": "window information", "speaker-selection": "audio output",
            openExternal: `open ${prompt.externalScheme || "external"} links`,
        };
        const names = prompt.permissions.map((permission) => labels[permission] ?? permission);
        this.requestText.textContent = `wants permission to access ${names.join(" and ")}`;
        this.requestText.dataset.name = "permission-description";
    }

    private resolve(decision: "allow" | "block"): void {
        this.props.model.resolvePermissionPrompt(this.props.prompt.requestId, decision);
    }
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
    private torView: TorStatusOverlayView | undefined;
    private findView: FindBarView | undefined;
    private drawerView: BookmarksDrawerView | undefined;
    private suggestionsView: UrlSuggestionsDropdownView | undefined;
    private lastUrl = "";
    private lastNavigationKey = "";
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
        this.splitter = this.child(new SplitterView({ name: "tabs-webview-splitter", orientation: "vertical", value: this.model.state.get().tabsPanelWidth, onChange: this.model.setTabsPanelWidth, side: "before", min: 32, background: "default", hoverBackground: "light", border: "none" }));
        this.popupSwap = new SubtreeSwap(this.popupHost); this.permissionSwap = new SubtreeSwap(this.popupHost); this.torSwap = new SubtreeSwap(this.webviewArea); this.networkSwap = new SubtreeSwap(this.webviewArea); this.clickSwap = new SubtreeSwap(this.webviewArea); this.findSwap = new SubtreeSwap(this.webviewArea); this.drawerSwap = new SubtreeSwap(this.browserBody); this.suggestionsSwap = new SubtreeSwap(this.root);
        this.own(() => { this.popupSwap.dispose(); this.permissionSwap.dispose(); this.torSwap.dispose(); this.networkSwap.dispose(); this.clickSwap.dispose(); this.findSwap.dispose(); this.drawerSwap.dispose(); this.suggestionsSwap.dispose(); });
        this.buildTree();
    }

    protected onMount(): void {
        this.listen(this.root, "keydown", (event) => this.model.webview.handleKeyDown(event as never));
        this.model.webview.initIpcHandler(); this.own(() => this.model.webview.disposeIpcHandler());
        this.toolbar.mount(); this.editorToolbar.mount(); this.tabs.mount(); this.splitter.mount(); this.pageManager.mount();
        this.model.urlBar.setUrlInputRef(this.toolbar.urlInputElement);
        this.model.urlBar.setFocusScheduler((select) => {
            this.urlBarFocusDisposer?.();
            this.urlBarFocusDisposer = focusAfterPaint(this.model.urlBar.urlInputRef, { select });
        });
        this.own(() => {
            this.urlBarFocusDisposer?.();
            this.urlBarFocusDisposer = undefined;
            this.model.urlBar.setFocusScheduler(undefined);
        });
        this.bind(this.model.state, (state) => state, this.sync); this.sync(this.model.state.get());
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
        this.toolbar.update({ model: this.model, state }); this.tabs.update(this.tabsProps(state)); this.tabsHost.style.width = `${state.tabsPanelWidth}px`; this.loadingBar.toggleAttribute("data-loading", state.loading); this.splitter.update({ name: "tabs-webview-splitter", orientation: "vertical", value: state.tabsPanelWidth, onChange: this.model.setTabsPanelWidth, side: "before", min: 32, background: "default", hoverBackground: "light", border: "none" });
        // No webview mounts while the profile's proxy could not be applied (US-1557):
        // its session route is unknown, and a mounted webview would start loading.
        this.pageManager.update({ pageIds: state.networkError ? [] : state.tabs.map((tab) => tab.id), activeId: state.activeTabId, renderPage: () => this.pageViewCtor });
        const active = state.tabs.find((tab) => tab.id === state.activeTabId); const navigationKey = `${state.activeTabId}\u0000${active?.url ?? ""}`;
        if (navigationKey !== this.lastNavigationKey) { this.lastNavigationKey = navigationKey; if (active) this.model.webview.navigateWebview(state.activeTabId, active.url); }
        if (state.url !== this.lastUrl) { this.lastUrl = state.url; this.model.urlBar.syncFromUrl(state.url); }
        if (this.initialLoad) {
            this.initialLoad = false;
            if (!state.url || state.url === "about:blank") {
                // Wait 100 ms for the blank-page toolbar to become visible before focusing it.
                this.focusTimer = setTimeout(() => this.model.urlBar.focusUrlInput(), 100);
            }
        }
        this.syncPopup(state); this.syncPermissionPrompt(state); this.syncTor(state); this.syncNetworkError(state); this.syncClick(state); this.syncFind(state); this.syncDrawer(state); this.syncSuggestions(state);
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
    private syncFind(state: BrowserEditorState): void {
        if (!state.findBarVisible) { this.findView = undefined; this.findSwap.clear(); return; }
        const props = { text: state.findText, currentMatch: state.findActiveMatch, totalMatches: state.findTotalMatches, onTextChange: this.model.webview.setFindText, onNext: this.model.webview.findNext, onPrev: this.model.webview.findPrev, onClose: this.model.webview.closeFind, placeholder: "Find in page..." };
        let created: FindBarView | undefined; this.findSwap.set("find", () => { created = new FindBarView(props); this.findView = created; return created; }); created?.mount(); this.findView?.update(props);
    }
    private syncDrawer(state: BrowserEditorState): void {
        const bookmarks = this.model.tabs.bookmarks;
        if (!state.bookmarksReady || !bookmarks || !state.bookmarksOpen) { this.drawerView = undefined; this.drawerSwap.clear(); return; }
        // Built fresh on each use rather than captured once: the drawer's own `sync()` recovers a
        // zero width by calling `onChangeWidth` *during* `mount()`, so a props object captured
        // before mount still says `width: 0` and the `update()` below would overwrite the recovery.
        // `bookmarksWidth` defaults to 0, so that made the first open on any new browser page render
        // a 0px-wide, invisible drawer that only a close-and-reopen fixed (US-1188).
        const drawerProps = (): BookmarksDrawerProps => ({ open: true, bookmarks, width: this.model.state.get().bookmarksWidth, onChangeWidth: (width: number) => this.model.state.update((s) => { s.bookmarksWidth = width; }), onClose: this.model.bookmarksUI.handleCloseBookmarks });
        let created: BookmarksDrawerView | undefined; this.drawerSwap.set("drawer", () => { created = new BookmarksDrawerView(drawerProps()); this.drawerView = created; return created; }); created?.mount(); this.drawerView?.update(drawerProps());
    }
    private syncSuggestions(state: BrowserEditorState): void {
        const items = this.model.urlBar.suggestionsItems; const open = state.suggestionsOpen && items.length > 0;
        if (!open) { this.suggestionsView = undefined; this.suggestionsSwap.clear(); return; }
        const props = { anchorEl: this.toolbar.urlAnchor, open: true, items, mode: this.model.urlBar.suggestionsMode, searchText: this.model.urlBar.suggestionsMode === "search" ? state.urlInput : undefined, hoveredIndex: state.hoveredIndex, onHoveredIndexChange: (index: number) => this.model.state.update((s) => { s.hoveredIndex = index; }), onSelect: this.model.urlBar.handleSuggestionSelect, onClearVisible: this.model.urlBar.suggestionsMode === "search" ? this.model.urlBar.handleClearVisible : undefined };
        let created: UrlSuggestionsDropdownView | undefined; this.suggestionsSwap.set("suggestions", () => { created = new UrlSuggestionsDropdownView(props); this.suggestionsView = created; return created; }); created?.mount(); this.suggestionsView?.update(props);
    }
}

export { BrowserEditor };
