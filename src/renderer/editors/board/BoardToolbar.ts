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
import { SwitchWidgetView } from "../base/PageToolbarView";
import { openBoardInfo } from "../board-info/open-board-info";
import type { BoardEditorModel } from "./BoardEditorModel";
import { BoardToolbarControls, type ToolbarAction } from "./BoardToolbarControls";
import "../../uikit/Panel/Panel.css";
import "../../uikit/Text/Text.css";
import "../../uikit/IconButton/IconButton.css";
import "../../uikit/Dot/Dot.css";
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
    private readonly propertiesPanel = createPanelElement({
        position: "relative", direction: "row", align: "center",
    });
    private readonly explorerButton: IconButtonView;
    private readonly reloadButton: IconButtonView;
    private readonly logButton: IconButtonView;
    private readonly propertiesButton: IconButtonView;
    private readonly switchWidget: SwitchWidgetView;
    private readonly boardControls: BoardToolbarControls;
    private dot: DotView | undefined;
    private boardRoot: string | undefined;

    public constructor(props: { model: BoardEditorModel; onAction: (event: ToolbarAction) => void }) {
        super(props, createPanelElement({
            name: "board-toolbar",
            direction: "row",
            align: "center",
            gap: "sm",
            padding: "xs",
            shrink: false,
        }));
        this.model = props.model;
        this.explorerButton = new IconButtonView({
            name: "board-toolbar-explorer", size: "sm", title: "File Explorer",
            icon: createIconElement("nav-panel", { width: 14, height: 14 }),
            onClick: () => void this.model.page?.toggleNavigator(null, this.boardRoot),
        });
        this.reloadButton = new IconButtonView({
            name: "board-toolbar-reload", size: "sm", title: "Reload board",
            icon: createIconElement("refresh", { width: 14, height: 14 }),
            onClick: () => this.model.reloadBoard(),
        });
        this.logButton = new IconButtonView({
            name: "board-toolbar-log", size: "sm", title: "Open board log",
            icon: createIconElement("log", { width: 14, height: 14 }),
            onClick: () => void this.openLog(),
        });
        this.propertiesButton = new IconButtonView({
            name: "board-toolbar-properties", size: "sm", title: "Board properties",
            icon: createIconElement("info", { width: 14, height: 14 }),
            onClick: () => void this.openProperties(),
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
        this.propertiesPanel.append(this.propertiesButton.root);
        this.root.append(
            this.explorerButton.root,
            this.pathPanel,
            this.boardControls.root,
            this.reloadButton.root,
            this.logButton.root,
            this.propertiesPanel,
            this.switchWidget.root,
        );
        this.child(this.explorerButton).mount();
        this.child(this.reloadButton).mount();
        this.child(this.logButton).mount();
        this.child(this.propertiesButton).mount();
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
        if (this.dot) {
            this.releaseChild(this.dot);
            this.dot = undefined;
        }
    }

    private readonly sync = (): void => {
        const state = this.model.state.get();
        this.boardRoot = state.boardRoot;
        this.pathText.textContent = state.toolbarText === "" || state.toolbarText === undefined
            ? this.boardRoot ?? ""
            : state.toolbarText;
        this.pathText.title = this.boardRoot ?? "";
        applyTextAttributes(this.pathText, resolveTextAttributes({
            size: "sm", color: "light", truncate: true, hoverUnderline: false,
        }));
        const hasUpdate = !!this.boardRoot && listBoardUpdates().some((update) =>
            fpNormalizeForCompare(update.root) === fpNormalizeForCompare(this.boardRoot!),
        );
        this.propertiesButton.update({
            name: "board-toolbar-properties",
            size: "sm",
            title: hasUpdate ? "Board properties — update available" : "Board properties",
            icon: createIconElement("info", { width: 14, height: 14 }),
            onClick: () => void this.openProperties(),
        });
        if (hasUpdate && !this.dot) {
            this.dot = this.child(new DotView({
                name: "board-toolbar-update-dot", color: "info", size: "xs", bordered: true,
            }));
            this.propertiesPanel.append(this.dot.root);
            this.dot.mount();
        } else if (!hasUpdate && this.dot) {
            this.releaseChild(this.dot);
            this.dot = undefined;
        }
    };

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
