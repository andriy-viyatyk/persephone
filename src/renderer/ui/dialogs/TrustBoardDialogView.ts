import { TDialogModel } from "../../core/state/model";
import { ButtonView } from "../../uikit/Button/ButtonView";
import { DialogContentView } from "../../uikit/Dialog/DialogContentView";
import { DialogView } from "../../uikit/Dialog/DialogView";
import { createPanelElement } from "../../uikit/Panel/panel-style";
import { createTextElement } from "../../uikit/Text/text-style";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import type { DialogViewProps } from "./dialog-view-registry";
import type { TrustBoardDialogProps } from "./TrustBoardDialog";
import { BOARD_PERMISSION_INTRODUCTION, FULL_ACCESS_DETAIL, LEGACY_PERMISSION_EXPLANATION, boardPermissionLines, permissionChangeLines } from "../../editors/board/board-permission-copy";
import "../../uikit/Button/Button.css";
import "../../uikit/Dialog/Dialog.css";

type TrustBoardDialogModel = TDialogModel<TrustBoardDialogProps, boolean>;

export class TrustBoardDialogView extends VanillaView<DialogViewProps> {
    private readonly model: TrustBoardDialogModel;
    private readonly dialogView: DialogView;
    private readonly contentView: DialogContentView;
    private readonly boardPathElement: HTMLSpanElement;
    private readonly cancelButton: ButtonView;
    private readonly trustButton: ButtonView;

    public constructor(props: DialogViewProps) {
        const model = props.model as TrustBoardDialogModel;
        const state = model.state.get();
        const boardPathElement = createTextElement(state.boardPath, { color: "light" });
        const declarationPanel = createPanelElement({ direction: "column", gap: "xs" }, [
            ...permissionSection(state.change?.granted ?? state.permissions, state.change ? "Granted permissions" : undefined),
            ...(state.change?.granted.kind === "legacy"
                ? [createTextElement(LEGACY_PERMISSION_EXPLANATION, { color: "light" })]
                : []),
            ...(state.change ? [
                createTextElement(state.change.legacyTransition ? "Unrestricted ->" : "Proposed permissions", { bold: true }),
                ...permissionSection(state.change.proposed),
                ...permissionChangeLines(state.change.changes).map((line) => createTextElement(line, { color: "warning" })),
            ] : []),
            ...(state.permissions.kind === "legacy" && !state.change
                ? [createTextElement(LEGACY_PERMISSION_EXPLANATION, { color: "light" })]
                : []),
            ...(state.capabilities.length > 0
                ? [createTextElement(`Capabilities: ${state.capabilities.map((id) => id || "<empty id>").join(", ")}`, { color: "light" })]
                : []),
        ]);
        const bodyPanel = createPanelElement(
            { direction: "column", gap: "md", paddingX: "xxl", paddingY: "xl" },
            [
                createTextElement(BOARD_PERMISSION_INTRODUCTION),
                createTextElement("Only trust boards you created or fully understand."),
                createTextElement(
                    "If you're not sure about a board, ask your AI agent to review its scripts before trusting it. "
                    + "The review checklist is in the guides (F1): \"Reviewing a board before you trust it\".",
                    { color: "warning" },
                ),
                boardPathElement,
                ...(state.permissions.kind === "flags" || state.permissions.kind === "legacy" || state.serviceDeclared || state.capabilities.length > 0 || state.change
                    ? [declarationPanel]
                    : []),
            ],
        );
        const cancelButton = new ButtonView({
            onClick: () => model.close(false),
            children: "Cancel",
        });
        const trustButton = new ButtonView({
            variant: "primary",
            onClick: () => model.close(true),
            children: "Trust Board",
        });
        const buttonsPanel = createPanelElement(
            { direction: "row", justify: "end", gap: "sm", padding: "md" },
            [cancelButton.root, trustButton.root],
        );
        const contentChildren = document.createDocumentFragment();
        contentChildren.append(bodyPanel, buttonsPanel);
        const contentView = new DialogContentView({
            title: "Trust this board?",
            icon: "warning",
            onClose: () => model.close(false),
            minWidth: 420,
            maxWidth: 640,
            children: contentChildren,
        });
        const dialogView = new DialogView({
            name: "trust-board-dialog",
            onEscape: () => model.close(false),
            children: contentView.root,
        });

        super(props, dialogView.root);
        this.model = model;
        this.dialogView = this.child(dialogView);
        this.contentView = this.child(contentView);
        this.cancelButton = this.child(cancelButton);
        this.trustButton = this.child(trustButton);
        this.boardPathElement = boardPathElement;
    }

    protected onMount(): void {
        this.cancelButton.mount();
        this.trustButton.mount();
        this.contentView.mount();
        this.dialogView.mount();
        this.bind(this.model.state, (next) => next.boardPath, (boardPath) => {
            this.boardPathElement.textContent = boardPath;
        });
    }
}

function permissionSection(permissions: TrustBoardDialogProps["permissions"], title?: string): HTMLElement[] {
    return [
        ...(title ? [createTextElement(title, { bold: true })] : []),
        ...boardPermissionLines(permissions).flatMap(({ text, fullAccess }) => fullAccess
            ? [createPanelElement({ direction: "row", align: "center", gap: "lg", wrap: true }, [
                createTextElement(text),
                createTextElement("Full access", { bold: true, color: "warning" }),
                createTextElement(FULL_ACCESS_DETAIL, { color: "light" }),
            ])]
            : [createTextElement(text, { color: "light" })]),
    ];
}
