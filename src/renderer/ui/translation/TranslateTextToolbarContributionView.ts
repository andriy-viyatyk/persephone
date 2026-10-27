import { ButtonView } from "../../uikit/Button/ButtonView";
import { MenuView } from "../../uikit/Menu/MenuView";
import type { MenuItem } from "../../core/events/context-menu";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import { t } from "../../../shared/i18n/t";
import type { TranslateTextPageController } from "./TranslateTextPageController";
import type { MonacoEditor } from "../../editors/monaco/MonacoEditor";
import { EventEndpoint } from "../../../ipc/api-types";
import rendererEvents from "../../../ipc/renderer/renderer-events";
import "../../uikit/Button/Button.css";
import "../../uikit/Menu/Menu.css";

interface Props { controller: TranslateTextPageController; model: MonacoEditor; language: string }

export class TranslateTextToolbarContributionView extends VanillaView<Props> {
    private readonly button: ButtonView;
    private readonly menu: MenuView;
    private providerAvailable = false;
    private menuOpen = false;
    private language: string;
    private readonly items: MenuItem[];

    public constructor(props: Props) {
        super(props, document.createElement("span"));
        this.root.dataset.type = "translate-text-toolbar-contribution";
        this.root.dataset.name = "translate-text-toolbar";
        this.root.hidden = true;
        this.language = props.language;
        this.items = [
            { id: "translate-selection", label: t("translation.selection"), onClick: () => { void this.props.controller.start("selection"); } },
            { id: "translate-page", label: t("translation.page"), onClick: () => { void this.props.controller.start("page"); } },
        ];
        this.button = this.child(new ButtonView({ name: "translate-text-button", variant: "ghost", size: "sm", children: t("translation.button"), title: t("translation.button"), disabled: true, onClick: this.toggle }));
        this.menu = this.child(new MenuView({ name: "translate-text-menu", elementRef: this.button.root, placement: "bottom-end", open: false, items: this.items, onClose: this.onMenuClose }));
    }

    protected onMount(): void {
        this.root.append(this.button.root, this.menu.root);
        this.button.mount();
        this.menu.mount();
        void this.props.controller.refreshProviders();
        this.own(rendererEvents[EventEndpoint.eBoardTrustChanged].subscribe(() => { void this.props.controller.refreshProviders(); }));
        const host = this.props.model.host;
        if (host) this.own(host.state.subscribe<string>((language) => { this.language = language; this.sync(); }, (state) => (state as { language?: string }).language ?? "plaintext"));
    }

    protected onUpdate(props: Props): void {
        this.language = props.language;
        this.sync();
    }

    protected onDispose(): void { this.props.controller.dispose(); }

    public setProviderAvailable(value: boolean): void {
        this.providerAvailable = value;
        this.sync();
    }

    public setLanguage(language: string): void { this.language = language; this.sync(); }

    private readonly toggle = (): void => {
        this.menuOpen = !this.menuOpen;
        this.sync();
    };

    private readonly onMenuClose = (): void => { this.menuOpen = false; this.sync(); };

    private sync(): void {
        const supported = this.language === "plaintext" || this.language === "markdown";
        const visible = supported && this.providerAvailable;
        this.root.hidden = !visible;
        this.button.update({ name: "translate-text-button", variant: "ghost", size: "sm", children: t("translation.button"), title: t("translation.button"), disabled: !visible, onClick: this.toggle });
        this.menu.update({ name: "translate-text-menu", elementRef: this.button.root, placement: "bottom-end", open: this.menuOpen && visible, items: this.items, onClose: this.onMenuClose });
    }
}
