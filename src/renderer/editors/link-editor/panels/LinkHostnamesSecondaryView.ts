import type { SecondaryViewProps } from "../../../ui/secondary-views/secondary-view-registry";
import {
    createSideBarPanelHeader,
    type SideBarPanelHeaderHandle,
} from "../../../ui/secondary-views/SideBarPanelHeaderView";
import { createPanelElement } from "../../../uikit/Panel/panel-style";
import "../../../uikit/Panel/Panel.css";
import { VanillaView } from "../../../uikit/shared/vanilla-view";
import { LinkEditor } from "../LinkEditor";
import { LinkFilterNavigationPanelView } from "../LinkFilterNavigationPanelView";
import { linkHostnamesNavigationStrategy } from "./LinkHostnamesNavigationPanel";
import { t } from "../../../../shared/i18n/t";

export default class LinkHostnamesSecondaryView extends VanillaView<SecondaryViewProps<LinkEditor>> {
    private navigation: LinkFilterNavigationPanelView | undefined;
    private header: SideBarPanelHeaderHandle | undefined;

    public constructor(props: SecondaryViewProps<LinkEditor>) {
        super(props, createPanelElement({
            name: "link-hostnames-secondary-view",
            direction: "column",
            flex: true,
            minHeight: 0,
            overflow: "hidden",
        }));
    }

    protected onMount(): void {
        this.navigation = this.child(new LinkFilterNavigationPanelView({
            editor: this.props.model,
            strategy: linkHostnamesNavigationStrategy,
        }));
        this.root.append(this.navigation.root);
        this.navigation.mount();
        this.header = createSideBarPanelHeader({
            headerHost: this.props.headerHost,
            icon: this.props.iconElement,
            title: t("shell.hostnames"),
        });
        this.own(() => this.header?.dispose());
        this.updateHeader();
    }

    protected onUpdate(props: SecondaryViewProps<LinkEditor>): void {
        this.navigation?.update({ editor: props.model, strategy: linkHostnamesNavigationStrategy });
        this.updateHeader();
    }

    protected onDispose(): void {
        this.navigation = undefined;
        this.header = undefined;
    }

    private updateHeader(): void {
        this.header?.update({
            headerHost: this.props.headerHost,
            icon: this.props.iconElement,
            title: t("shell.hostnames"),
        });
    }
}
