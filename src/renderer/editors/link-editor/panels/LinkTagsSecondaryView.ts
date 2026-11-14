import type { SecondaryViewProps } from "../../../ui/secondary-views/secondary-view-registry";
import {
    createSideBarPanelHeader,
    type SideBarPanelHeaderHandle,
} from "../../../ui/secondary-views/SideBarPanelHeaderView";
import { createPanelElement } from "../../../uikit/Panel/panel-style";
import { VanillaView } from "../../../uikit/shared/vanilla-view";
import { LinkFilterNavigationPanelView } from "../LinkFilterNavigationPanelView";
import type { LinkFilterNavigationStrategy } from "../LinkFilterNavigationPanelView";
import { LinkEditor } from "../LinkEditor";
import { LinkTagsPanelView } from "./LinkTagsPanel";
import "../../../uikit/Panel/Panel.css";
import "../../../uikit/Splitter/Splitter.css";
import { t } from "../../../../shared/i18n/t";

export const linkTagsNavigationStrategy: LinkFilterNavigationStrategy = {
    name: "tags",
    topView(editor) {
        let panel: LinkTagsPanelView | undefined;
        return {
            create() {
                panel = new LinkTagsPanelView({ vm: editor });
                return {
                    root: panel.root,
                    mount: () => panel?.mount(),
                    dispose: () => panel?.dispose(),
                };
            },
            update() {
                panel?.update({ vm: editor });
            },
        };
    },
    selectedKey: (state) => state.selectedTag,
    itemsFor: (editor, key) => (key
        ? editor.treeProvider?.getTagItems(key) ?? []
        : editor.state.get().data.links).filter((item) => !item.isDirectory),
    sourceId: "link-tag",
};

export default class LinkTagsSecondaryView extends VanillaView<SecondaryViewProps<LinkEditor>> {
    private navigation: LinkFilterNavigationPanelView | undefined;
    private header: SideBarPanelHeaderHandle | undefined;

    public constructor(props: SecondaryViewProps<LinkEditor>) {
        super(props, createPanelElement({
            name: "link-tags-secondary-view",
            direction: "column",
            flex: true,
            minHeight: 0,
            overflow: "hidden",
        }));
    }

    protected onMount(): void {
        this.navigation = this.child(new LinkFilterNavigationPanelView({
            editor: this.props.model,
            strategy: linkTagsNavigationStrategy,
        }));
        this.root.append(this.navigation.root);
        this.navigation.mount();
        this.header = createSideBarPanelHeader({
            headerHost: this.props.headerHost,
            icon: this.props.iconElement,
            title: t("shell.tags"),
        });
        this.own(() => this.header?.dispose());
        this.updateHeader();
    }

    protected onUpdate(props: SecondaryViewProps<LinkEditor>): void {
        this.navigation?.update({ editor: props.model, strategy: linkTagsNavigationStrategy });
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
            title: t("shell.tags"),
        });
    }
}
