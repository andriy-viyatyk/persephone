import type { BrowserEditor } from "./BrowserEditor";
import type { BrowserTabData } from "./browser-state";
import { parseGuestMessage } from "../../../ipc/browser-guest-messages";
import { createPanelElement } from "../../uikit/Panel/panel-style";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import { SubtreeSwap } from "../../uikit/shared/subtree-swap";
import color from "../../theme/color";
import { dismissOverlays } from "../../uikit/shared/overlayLayer";
import { BrowserSecondaryViewsView } from "./BrowserSecondaryViews";
import { BrowserBookmarks } from "./BrowserBookmarks";
import { LinkActionView, LinkBreadcrumbView } from "../link-editor";
import { LinkBodyView } from "../link-editor/LinkBody";
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
class BrowserWebviewItemView extends VanillaView<BrowserWebviewItemProps> {
    private readonly model: BrowserEditor;
    private readonly tabId: string;
    private readonly webview: Electron.WebviewTag;
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
        const existing = this.model.webview.get(this.tabId);
        if (existing && existing !== this.webview && existing.isConnected) {
            // Preserve the duplicate-connected-webview warning verbatim in meaning.
            console.warn(
                `[browser] duplicate webview mount for tab ${this.tabId} — `
                    + "previous webview is still connected (US-806)",
            );
        }
        this.model.webview.attach(this.tabId, this.webview);
        this.own(() => { this.model.webview.detach(this.tabId, this.webview); });

        // Focus can reach the guest without a press in it (keyboard traversal, a
        // programmatic focus), so this is a second dismissal trigger alongside the
        // `guest-pointerdown` ping below — and it carried the same dead `mousedown`.
        const onFocus = (): void => {
            dismissOverlays(this.webview);
        };
        this.listenNative("focus", onFocus);

        const onIpcMessage = (event: Electron.IpcMessageEvent): void => {
            const msg = parseGuestMessage(event.channel, event.args);
            if (msg) this.model.webview.handleGuestMessage(this.tabId, msg, event.frameId);
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
                if (this.model.webview.isRegistered(this.tabId)) this.model.guest.exitHtmlFullscreen(this.tabId);
            }
        });
        hiddenObserver.observe(this.root);
        this.own(() => hiddenObserver.disconnect());
        // Escape normally reaches the page's own key hook in the main process. When keyboard focus
        // is in Persephone instead, the key lands here; it must still leave the fullscreen video.
        const onDocumentKeyDown = (event: KeyboardEvent): void => {
            if (!this.htmlFullscreen || event.key !== "Escape" || !this.model.webview.isRegistered(this.tabId)) return;
            event.preventDefault();
            this.model.guest.exitHtmlFullscreen(this.tabId);
        };
        document.addEventListener("keydown", onDocumentKeyDown, true);
        this.own(() => document.removeEventListener("keydown", onDocumentKeyDown, true));

        const onFoundInPage = (event: Electron.FoundInPageEvent): void => {
            if (this.props.isActive) this.model.find.foundInPage(event.result);
        };
        this.listenNative("found-in-page", onFoundInPage);
    }

    protected onUpdate(props: BrowserWebviewItemProps): void { this.updateBackground(props.tab); }

    private setHtmlFullscreen(fullscreen: boolean): void {
        this.htmlFullscreen = fullscreen;
        this.root.toggleAttribute("data-html-fullscreen", fullscreen);
    }

    private updateBackground(tab: BrowserTabData): void {
        this.webview.style.backgroundColor = isBlankUrl(tab.url) ? color.background.default : color.background.webview;
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
        const tab = props.model.findTab(props.tabId);
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
        this.bind(this.model.state, (state) => ({ tab: this.model.findTab(this.props.tabId), active: state.activeTabId === this.props.tabId, bookmarksReady: state.bookmarksReady, bookmarks: this.model.bookmarks.bookmarks }), this.sync);
    }

    protected onUpdate(): void { this.sync(); }

    private readonly sync = (): void => {
        const state = this.model.state.get();
        const tab = this.model.findTab(this.props.tabId);
        if (!tab) return;
        this.webview.update({ model: this.model, tab, isActive: state.activeTabId === this.props.tabId, partition: this.model.partition });
        const bookmarks = state.bookmarksReady ? this.model.bookmarks.bookmarks : null;
        const showBlankPage = isBlankUrl(tab.url) && !tab.loading && !!bookmarks;
        if (!showBlankPage || !bookmarks) { this.blankView = undefined; this.blankSwap.clear(); return; }
        let created: BlankPageLinksView | undefined;
        this.blankSwap.set("blank", () => { created = new BlankPageLinksView({ bookmarks }); this.blankView = created; return created; });
        created?.mount();
    };
}

