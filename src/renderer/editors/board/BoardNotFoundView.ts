import { createPanelElement } from "../../uikit/Panel/panel-style";
import { createTextElement } from "../../uikit/Text/text-style";
import { createIconElement } from "../../uikit/shared/slots";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import { t, untranslated } from "../../../shared/i18n/t";
import "../../uikit/Panel/Panel.css";
import "../../uikit/Text/Text.css";

interface BoardNotFoundViewProps {
    path: string;
}

/** Shown when the linked board folder is missing or is not a board. */
export class BoardNotFoundView extends VanillaView<BoardNotFoundViewProps> {
    private readonly pathElement: HTMLSpanElement;

    public constructor(props: BoardNotFoundViewProps) {
        const pathElement = createTextElement("", { size: "sm", color: "light" });
        super(props, createPanelElement({
            direction: "column",
            flex: true,
            align: "center",
            justify: "center",
            gap: "md",
            padding: "xl",
        }, [
            createIconElement("warning", { width: 32, height: 32 }),
            createTextElement(t("board.notFoundTitle"), { size: "lg" }),
            createTextElement(t(
                "board.notFoundMessage",
                { manifest: untranslated("board-manifest.json") },
            ),
                { color: "light", align: "center" },
            ),
            pathElement,
        ]));
        this.pathElement = pathElement;
    }

    protected onMount(): void {
        this.updatePath();
    }

    protected onUpdate(): void {
        this.updatePath();
    }

    private updatePath(): void {
        this.pathElement.textContent = this.props.path;
    }
}
