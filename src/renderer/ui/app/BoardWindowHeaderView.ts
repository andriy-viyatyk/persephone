import { app } from "../../api/app";
import { rendererProfileName } from "../../../shared/application-profile";
import { t } from "../../../shared/i18n/t";
import { createIconElement } from "../../uikit/shared/slots";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import { createSystemButton, createWindowToggleButton, updateWindowToggle } from "./header-buttons";
import { GlobalMuteButtonView } from "./GlobalMuteButtonView";

export interface BoardWindowHeaderViewProps {
    pageTabs: HTMLElement;
    rightPageTabs: HTMLElement;
}

export class BoardWindowHeaderView extends VanillaView<BoardWindowHeaderViewProps> {
    private readonly globalMute = this.child(new GlobalMuteButtonView({}));
    private readonly toggleWindowButton = createWindowToggleButton((button, listener) => this.listen(button, "click", listener), () => app.window.toggleWindow());

    public constructor(props: BoardWindowHeaderViewProps) {
        super(props, document.createElement("div"));
        this.root.className = "app-header";
        this.root.dataset.name = "app-header";
        // The locked board tab is always shown and carries the board's icon and name, so the
        // header holds no separate identity block — it would repeat the tab.
        this.root.dataset.boardMode = "";
    }

    protected onMount(): void {
        const spacer = document.createElement("div");
        spacer.className = "board-header-drag-spacer";
        const minimizeButton = createSystemButton("window-minimize", createIconElement("window-minimize"), t("shell.minimize"), (button, listener) => this.listen(button, "click", listener), () => app.window.minimize());
        const closeButton = createSystemButton("window-close", createIconElement("close"), t("shell.closeWindow"), (button, listener) => this.listen(button, "click", listener), () => app.window.close());
        this.root.append(this.props.pageTabs, this.props.rightPageTabs, spacer, this.globalMute.root, minimizeButton, this.toggleWindowButton, closeButton);
        const profileName = rendererProfileName();
        if (profileName) {
            const label = document.createElement("span");
            label.textContent = ` — ${profileName}`;
            this.root.append(label);
        }
        this.globalMute.mount();
        this.bind(app.window.state, (state) => state.isMaximized, (isMaximized) => {
            updateWindowToggle(this.toggleWindowButton, isMaximized, t("shell.restore"), t("shell.maximize"));
        });
    }
}
