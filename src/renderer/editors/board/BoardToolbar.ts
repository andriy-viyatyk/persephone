import { app } from "../../api/app";
import { publishedBoards } from "../../api/published-boards";
import { boardInstallRegistry } from "../../api/board-install-registry";
import { listBoardUpdates } from "../../api/board-updates";
import { createLinkData } from "../../../shared/link-data";
import { fpNormalizeForCompare } from "../../core/utils/file-path";
import { createPanelElement } from "../../uikit/Panel/panel-style";
import { createTextElement, applyTextAttributes, resolveTextAttributes } from "../../uikit/Text/text-style";
import { IconButtonView } from "../../uikit/IconButton/IconButtonView";
import { DotView } from "../../uikit/Dot/DotView";
import { createIconElement } from "../../uikit/shared/slots";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import { openMenu, type MenuHandle } from "../../uikit/Menu/attach-menu";
import type { MenuItem } from "../../core/events/context-menu";
import { SwitchWidgetView } from "../base/PageToolbarView";
import { openBoardInfo } from "../board-info/open-board-info";
import type { BoardEditorModel } from "./BoardEditorModel";
import { BoardToolbarControls, type ToolbarAction } from "./BoardToolbarControls";
import "../../uikit/Panel/Panel.css";
import "../../uikit/Text/Text.css";
import "../../uikit/IconButton/IconButton.css";
import "../../uikit/Dot/Dot.css";
import "../../uikit/Menu/Menu.css";
import "./BoardToolbar.css";

export class BoardToolbarView extends VanillaView<{
    model: BoardEditorModel;
    onAction: (event: ToolbarAction) => void;
}> {
    private readonly model: BoardEditorModel;
    private readonly pathPanel = createPanelElement({
        direction: "row", align: "center", flex: true, width: 0, overflow: "hidden",
    });
    private readonly pathText = createTextElement("", { size: "sm", color: "light", truncate: true });
    /** Anchors the update dot over the … button; `relative` is what positions it. */
    private readonly morePanel = createPanelElement({
        position: "relative", direction: "row", align: "center",
    });
    private readonly explorerButton: IconButtonView;
    private readonly moreButton: IconButtonView;
    private readonly switchWidget: SwitchWidgetView;
    private readonly boardControls: BoardToolbarControls;
    private menu: MenuHandle | undefined;
    private dot: DotView | undefined;
    private boardRoot: string | undefined;

    public constructor(props: { model: BoardEditorModel; onAction: (event: ToolbarAction) => void }) {
        super(props, createPanelElement({
            name: "board-toolbar",
            direction: "row",
            align: "center",
            gap: "sm",
            // Board draws its own toolbar instead of the shared EditorToolbarView, so the
            // `background: "dark"` that view applies has to be repeated here or the board
            // toolbar sits one shade lighter than every other editor's.
            background: "dark",
            padding: "xs",
            shrink: false,
        }));
        this.model = props.model;
        this.explorerButton = new IconButtonView({
            name: "board-toolbar-explorer", size: "sm", title: "File Explorer",
            icon: createIconElement("nav-panel", { width: 14, height: 14 }),
            onClick: () => void this.model.page?.toggleNavigator(null, this.boardRoot),
        });
        // Reload / log / properties are recovery and inspection actions: on a board that
        // works they are never needed, and three permanent icons beside the board's OWN
        // controls read as if they belonged to the board. One … button keeps them one
        // click away without competing with what the board put there.
        this.moreButton = new IconButtonView({
            name: "board-toolbar-more", size: "sm", title: "Board actions",
            icon: createIconElement("more-horiz", { width: 14, height: 14 }),
            onClick: () => this.openBoardMenu(),
        });
        this.switchWidget = new SwitchWidgetView({ model: props.model });
        this.boardControls = new BoardToolbarControls({ model: props.model, onAction: props.onAction });
    }

    public setToolbarControls(
        controls: readonly import("../../../ipc/board-bridge-channels").BoardToolbarControlDescriptor[],
        frameGeneration: number,
        warning: (message: string) => void,
    ): void {
        this.boardControls.set(controls, frameGeneration, warning);
    }

    public updateToolbarControls(
        patches: readonly import("../../../ipc/board-bridge-channels").BoardToolbarControlPatch[],
        warning: (message: string) => void,
    ): void {
        this.boardControls.updateCatalog(patches, warning);
    }

    public clearToolbarControls(frameGeneration: number): void {
        this.boardControls.clear(frameGeneration);
    }

    protected onMount(): void {
        this.pathPanel.append(this.pathText);
        this.morePanel.append(this.moreButton.root);
        this.root.append(
            this.explorerButton.root,
            this.pathPanel,
            this.boardControls.root,
            this.morePanel,
            this.switchWidget.root,
        );
        this.child(this.explorerButton).mount();
        this.child(this.moreButton).mount();
        this.child(this.switchWidget).mount();
        this.child(this.boardControls).mount();
        this.own(publishedBoards.subscribeCatalog(this.sync));
        this.own(boardInstallRegistry.subscribeInstalled(this.sync));
        void publishedBoards.load();
        void boardInstallRegistry.load();
        this.bind(this.model.state, (state) => ({
            boardRoot: state.boardRoot,
            toolbarText: state.toolbarText,
        }), this.sync);
    }

    protected onUpdate(): void {
        this.sync();
    }

    protected onDispose(): void {
        this.menu?.dispose();
        this.menu = undefined;
        if (this.dot) {
            this.releaseChild(this.dot);
            this.dot = undefined;
        }
    }

    private readonly sync = (): void => {
        const state = this.model.state.get();
        this.boardRoot = state.boardRoot;
        const boardRoot = this.boardRoot;
        // The slot is the board's to fill and is EMPTY until it does. It used to fall back to
        // the board root, which spent the toolbar's whole flexible span on a path the user
        // already chose and cannot act on; the path is still one click away under
        // … → Board properties, and on the tab's Copy Board Path. `""` and `undefined` are
        // deliberately the same here, so `setText("")` clears rather than restoring a fallback.
        const slotText = state.toolbarText ?? "";
        this.pathText.textContent = slotText;
        // An empty inline element has no hover target, so the tooltip only exists when a board
        // has actually put something in the slot — where the path remains its documented title.
        this.pathText.title = slotText ? this.boardRoot ?? "" : "";
        applyTextAttributes(this.pathText, resolveTextAttributes({
            size: "sm", color: "light", truncate: true, hoverUnderline: false,
        }));
        const hasUpdate = !!boardRoot && listBoardUpdates().some((update) =>
            fpNormalizeForCompare(update.root) === fpNormalizeForCompare(boardRoot),
        );
        this.moreButton.update({
            name: "board-toolbar-more",
            size: "sm",
            title: hasUpdate ? "Board actions — update available" : "Board actions",
            icon: createIconElement("more-horiz", { width: 14, height: 14 }),
            onClick: () => this.openBoardMenu(),
        });
        // The dot is the only cue that an update exists now that Properties is one level
        // down, so an update landing while the menu is open must reach the open menu too.
        this.menu?.update({ name: "board-menu", items: this.menuItems(), placement: "bottom-end" });
        if (hasUpdate && !this.dot) {
            this.dot = this.child(new DotView({
                name: "board-toolbar-update-dot", color: "info", size: "xs", bordered: true,
            }));
            this.morePanel.append(this.dot.root);
            this.dot.mount();
        } else if (!hasUpdate && this.dot) {
            this.releaseChild(this.dot);
            this.dot = undefined;
        }
    };

    private menuItems(): MenuItem[] {
        const boardRoot = this.boardRoot;
        const hasUpdate = !!boardRoot && listBoardUpdates().some((update) =>
            fpNormalizeForCompare(update.root) === fpNormalizeForCompare(boardRoot),
        );
        return [
            { label: "Reload board", icon: "refresh", onClick: () => this.model.reloadBoard() },
            { label: "Open board log", icon: "log", onClick: () => void this.openLog() },
            {
                label: hasUpdate ? "Board properties — update available" : "Board properties",
                icon: "info",
                startGroup: true,
                onClick: () => void this.openProperties(),
            },
        ];
    }

    private openBoardMenu(): void {
        this.menu?.dispose();
        this.menu = openMenu(this.moreButton.root, {
            name: "board-menu",
            items: this.menuItems(),
            placement: "bottom-end",
            onClose: () => { this.menu = undefined; },
        });
    }

    private async openProperties(): Promise<void> {
        const id = this.model.page?.id;
        const page = id ? app.pages.pages.find((candidate) => candidate.id === id) : undefined;
        if (page) await openBoardInfo(page, { boardRoot: this.boardRoot });
    }

    private async openLog(): Promise<void> {
        const logPath = this.model.getSelectedBoardLogPath();
        if (logPath) await app.events.openRawLink.sendAsync(createLinkData(logPath));
    }

}
