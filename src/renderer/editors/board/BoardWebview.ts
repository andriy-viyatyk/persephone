import color from "../../theme/color";
import { pagesModel } from "../../api/pages";
import { CapabilityError } from "../../api/capability-error";
import { isFocusInSidebar } from "../../core/utils/focus-utils";
import { createPanelElement } from "../../uikit/Panel/panel-style";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import "../../uikit/Panel/Panel.css";
import type { BoardEditorModel } from "./BoardEditorModel";
import type { ToolbarAction } from "./chrome/board-chrome-protocol";
import { ensureBoardThemeSubscription } from "./board-theme";
import { BoardFrameSession } from "./frame/BoardFrameSession";
import { BoardFrameEndpoint } from "./frame/BoardFrameEndpoint";
import { BoardFrameComposition } from "./frame/board-frame-composition";
import { RETIRE_MESSAGES } from "./frame/board-frame-retire-messages";

export interface BoardWebviewProps {
    model: BoardEditorModel;
    boardRoot: string;
    entry?: string;
    view?: string;
    isMain?: boolean;
}


/** Hosts a cross-origin board iframe without granting it Node integration. */
export class BoardWebview extends VanillaView<BoardWebviewProps> {
    private session: BoardFrameSession | undefined;
    private composition: BoardFrameComposition | undefined;

    constructor(props: BoardWebviewProps) {
        super(props, createPanelElement({
            direction: "column",
            flex: true,
            width: "100%",
            height: 0,
            background: "default",
        }));
    }

    protected onMount(): void {
        const isMain = this.props.isMain ?? true;
        this.session = new BoardFrameSession({
            model: this.props.model,
            boardRoot: this.props.boardRoot,
            entry: this.props.entry ?? "index.html",
            view: this.props.view ?? "main",
            isMain,
            pageVisible: () => this.getPageVisibility(),
            mountFrame: (frame, generation) => this.mountFrame(frame, generation),
        });
        const endpoint = new BoardFrameEndpoint(this.session, {
            retireError: (method, reason) => {
                if (method === "save") return new Error(RETIRE_MESSAGES[reason].save);
                if (method === "aiVision.request") return new Error(RETIRE_MESSAGES[reason].aiVision);
                const [code, text] = RETIRE_MESSAGES[reason].capability;
                return new CapabilityError(code, text);
            },
        });
        this.composition = new BoardFrameComposition(this.session, endpoint, {
            model: this.props.model, boardRoot: this.props.boardRoot, isMain,
            focusFrame: () => this.focusFrame(), getPageVisibility: () => this.getPageVisibility(),
        });
        ensureBoardThemeSubscription();
        void this.composition.start();
    }

    protected onDispose(): void {
        void this.session?.retire("dispose");
        this.composition?.dispose();
    }

    private mountFrame(frame: HTMLIFrameElement, generation: number): void {
        frame.style.flex = "1";
        frame.style.width = "100%";
        frame.style.border = "none";
        frame.style.backgroundColor = color.background.default;
        this.composition?.mountFrame(frame, generation);
        this.root.append(frame);
    }

    private getPageVisibility(): boolean {
        const pageId = this.props.model.page?.id;
        return pageId ? pagesModel.query.isPageVisible(pageId) : false;
    }

    private focusFrame(): void {
        if (!isFocusInSidebar()) this.session?.frame?.contentWindow?.focus();
    }

    public sendToolbarControl(event: ToolbarAction): void {
        this.composition?.sendToolbarControl(event);

    }
    public sendStatusBarAction(event: { id: string }, generation: number): void {
        this.composition?.sendStatusBarAction(event, generation);

    }
}
