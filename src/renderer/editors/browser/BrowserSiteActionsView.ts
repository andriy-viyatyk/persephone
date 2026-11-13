import { t } from "../../../shared/i18n/t";
import type { SiteActionItem } from "../../../shared/site-extension-actions";
import { ui } from "../../api/ui";
import type { MenuItem } from "../../uikit/Menu";
import { getIcon } from "../../theme/icon-registry";
import { IconButtonView } from "../../uikit/IconButton/IconButtonView";
import { closeAppPopupMenu, showAppPopupMenu } from "../../ui/dialogs/poppers/showPopupMenu";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import type { BrowserEditor } from "./BrowserEditor";
import type { BrowserEditorState } from "./browser-state";

interface BrowserSiteActionsProps {
    model: BrowserEditor;
    state: BrowserEditorState;
}

export class BrowserSiteActionsView extends VanillaView<BrowserSiteActionsProps> {
    private readonly button: IconButtonView;
    private actionMenuOpen = false;
    private actionMenuGeneration = 0;
    private actionMenuKey = "";

    constructor(props: BrowserSiteActionsProps) {
        let openSiteActions = (): void => undefined;
        const button = new IconButtonView({
            name: "toolbar-site-actions",
            size: "sm",
            icon: "extension",
            title: t("browser.siteActions"),
            "aria-label": t("browser.siteActions"),
            onClick: () => openSiteActions(),
        });
        super(props, button.root);
        this.button = this.child(button);
        openSiteActions = () => this.openSiteActions();
    }

    protected onMount(): void {
        this.button.mount();
        this.sync(this.props.state);
    }

    protected onUpdate(props: BrowserSiteActionsProps): void {
        this.sync(props.state);
    }

    protected onDispose(): void {
        if (this.actionMenuOpen) void closeAppPopupMenu();
    }

    private sync(state: BrowserEditorState): void {
        const actionItems = this.props.model.siteExtensions.actions(state.activeTabId);
        const actionKey = `${state.activeTabId}:${this.props.model.siteExtensions.documentId(state.activeTabId)}:${JSON.stringify(actionItems)}`;
        this.button.root.style.display = actionItems.length ? "" : "none";
        if (this.actionMenuOpen && this.actionMenuKey !== actionKey) {
            this.actionMenuOpen = false;
            this.actionMenuGeneration++;
            void closeAppPopupMenu();
        }
        this.actionMenuKey = actionKey;
    }

    private openSiteActions(): void {
        const tabId = this.props.model.state.get().activeTabId;
        const tree = this.props.model.siteExtensions.actions(tabId);
        const icons = {
            play: "play",
            "file-text": "new-file",
            image: "view-landscape",
            table: "filter-table",
            link: "open-link",
        } as const;
        const menu = (items: SiteActionItem[]): MenuItem[] => items.map((item) => ({
            id: item.id,
            label: item.label,
            ...(item.icon ? { icon: getIcon(icons[item.icon])?.createElement({}) } : {}),
            ...(item.children?.length
                ? { items: menu(item.children) }
                : { onClick: () => void this.runSiteAction(item.id, tabId, menuKey) }),
        }));
        if (!tree.length) return;
        const rect = this.button.root.getBoundingClientRect();
        this.actionMenuOpen = true;
        const menuKey = this.actionMenuKey;
        const generation = ++this.actionMenuGeneration;
        void showAppPopupMenu(rect.left, rect.bottom, menu(tree), {
            skipInspect: true,
            skipDefaults: true,
            isCurrent: () => this.actionMenuOpen
                && this.actionMenuGeneration === generation
                && this.actionMenuKey === menuKey,
        }).finally(() => {
            if (this.actionMenuGeneration === generation) this.actionMenuOpen = false;
        });
    }

    private async runSiteAction(id: string, tabId: string, menuKey: string): Promise<void> {
        if (this.props.model.state.get().activeTabId !== tabId || this.actionMenuKey !== menuKey) return;
        const outcome = await this.props.model.siteExtensions.runAction(id);
        if (outcome.status === "busy") {
            ui.notify(t("browser.siteActionBusy"), "warning");
            return;
        }
        if (outcome.status !== "choice-required"
            || this.props.model.state.get().activeTabId !== tabId
            || this.actionMenuKey !== menuKey) return;
        const rect = this.button.root.getBoundingClientRect();
        this.actionMenuOpen = true;
        const generation = ++this.actionMenuGeneration;
        await showAppPopupMenu(rect.left, rect.bottom, [
            { label: t("browser.siteActionChoose"), disabled: true },
            ...outcome.choices.map((choice, index) => ({
                label: choice.label,
                onClick: (): void => { void this.props.model.siteExtensions.chooseResult(outcome.token, index); },
            })),
        ], {
            skipInspect: true,
            skipDefaults: true,
            isCurrent: () => this.actionMenuOpen
                && this.actionMenuGeneration === generation
                && this.actionMenuKey === menuKey,
        });
        if (this.actionMenuGeneration === generation) this.actionMenuOpen = false;
    }
}
