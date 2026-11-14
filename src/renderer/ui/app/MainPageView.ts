import { rendererProfileName } from "../../../shared/application-profile";
import { app } from "../../api/app";
import { appWindow } from "../../api/window";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import { PageTabsView } from "../tabs/PageTabsView";
import { RightPageTabsView } from "../tabs/RightPageTabsView";
import { VoiceTypingOverlayView } from "../voice-typing/VoiceTypingOverlayView";
import { MenuBarView } from "../sidebar/MenuBarView";
import { PagesView } from "./PagesView";
import { AppHeaderView } from "./AppHeaderView";
import { BoardWindowHeaderView } from "./BoardWindowHeaderView";
import "./MainPage.css";

export class MainPageView extends VanillaView<object> {
    private readonly pageTabs: PageTabsView;
    private readonly rightPageTabs: RightPageTabsView;
    private readonly pages: PagesView;
    private readonly menuBar: MenuBarView;
    private readonly appHeader: AppHeaderView | undefined;
    private readonly header: AppHeaderView | BoardWindowHeaderView;
    private voiceTypingOverlay: VoiceTypingOverlayView | undefined;
    private readonly toggleMenuBar = (): void => app.window.toggleMenuBar();
    private readonly closeMenuBar = (): void => app.window.menuBar.close();

    public constructor(props: object) {
        super(props);
        this.root.className = "app-root";
        this.pageTabs = this.child(new PageTabsView({}));
        this.rightPageTabs = this.child(new RightPageTabsView({}));
        this.pages = this.child(new PagesView({}));
        this.menuBar = this.child(new MenuBarView({ open: false, onClose: this.closeMenuBar }));
        if (appWindow.isBoardMode) {
            this.header = this.child(new BoardWindowHeaderView({ pageTabs: this.pageTabs.root, rightPageTabs: this.rightPageTabs.root }));
        } else {
            this.appHeader = this.child(new AppHeaderView({ pageTabs: this.pageTabs.root, rightPageTabs: this.rightPageTabs.root }));
            this.header = this.appHeader;
        }
    }

    protected onMount(): void {
        this.voiceTypingOverlay = this.child(new VoiceTypingOverlayView({}));
        this.voiceTypingOverlay.mount();
        this.own(() => { this.voiceTypingOverlay = undefined; });
        const profileName = rendererProfileName();
        if (profileName) document.title += ` — ${profileName}`;

        const content = document.createElement("div");
        content.className = "app-content";
        content.dataset.name = "app-content";
        const pagesContainer = document.createElement("div");
        pagesContainer.className = "pages-container";
        pagesContainer.dataset.name = "pages-container";
        pagesContainer.append(this.pages.root);
        content.append(pagesContainer, this.menuBar.root);
        if (this.appHeader) this.root.append(this.appHeader.popover.root);
        this.root.append(this.header.root, content);

        this.pageTabs.mount();
        this.rightPageTabs.mount();
        this.pages.mount();
        this.menuBar.mount();
        this.header.mount();
        this.bind(app.window.menuBar.state, (state) => state.isOpen, (open) => {
            this.menuBar.update({ open: appWindow.isBoardMode ? false : open, onClose: this.closeMenuBar });
        });
    }
}
