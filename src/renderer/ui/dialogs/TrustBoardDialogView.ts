import { TDialogModel } from "../../core/state/model";
import { ButtonView } from "../../uikit/Button/ButtonView";
import { DialogContentView } from "../../uikit/Dialog/DialogContentView";
import { DialogView } from "../../uikit/Dialog/DialogView";
import { createPanelElement } from "../../uikit/Panel/panel-style";
import { createTextElement } from "../../uikit/Text/text-style";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import type { DialogViewProps } from "./dialog-view-registry";
import type { TrustBoardDialogProps, TrustBoardDialogResult } from "./TrustBoardDialog";
import {
    BOARD_PERMISSION_INTRODUCTION,
    LEGACY_PERMISSION_EXPLANATION,
    PERMISSION_CHANGE_TITLE,
    legacyBoardDeprecationWarning,
    permissionChangeMessage,
} from "../../editors/board/board-permission-copy";
import { createBoardPermissionChangeList, createBoardPermissionList } from "../../editors/board/board-permission-list";
import { t } from "../../../shared/i18n/t";
import "../../uikit/Button/Button.css";
import "../../uikit/Dialog/Dialog.css";

type TrustBoardDialogModel = TDialogModel<TrustBoardDialogProps, TrustBoardDialogResult>;

/** One dialog, two modes: "Trust this board?" for a new board (Cancel / Trust Board), and
 *  "Board permissions changed" for a trusted board whose manifest widened its permissions
 *  (Unregister board / Accept; closing it removes the board from its page). */
export class TrustBoardDialogView extends VanillaView<DialogViewProps> {
    private readonly model: TrustBoardDialogModel;
    private readonly dialogView: DialogView;
    private readonly contentView: DialogContentView;
    private readonly boardPathElement: HTMLSpanElement;
    private readonly buttons: ButtonView[];

    public constructor(props: DialogViewProps) {
        const model = props.model as TrustBoardDialogModel;
        const state = model.state.get();
        const change = state.change;
        const boardPathElement = createTextElement(state.boardPath, { color: "light" });

        const body = change
            ? [
                createTextElement(permissionChangeMessage(state.boardName)),
                createTextElement(t("dialogs.trustReviewHint"), { color: "warning" }),
                boardPathElement,
                createBoardPermissionChangeList(change.granted, change.proposed),
            ]
            : [
                createTextElement(BOARD_PERMISSION_INTRODUCTION),
                createTextElement(t("dialogs.trustOnlyBoards")),
                createTextElement(t("dialogs.trustReviewHint"), { color: "warning" }),
                boardPathElement,
                createPanelElement({ direction: "column", gap: "sm" }, [
                    createBoardPermissionList(state.permissions),
                    ...(state.permissions.kind === "legacy"
                        ? [
                            createTextElement(LEGACY_PERMISSION_EXPLANATION, { color: "light" }),
                            createTextElement(legacyBoardDeprecationWarning(state.boardName), { color: "warning" }),
                        ]
                        : []),
                    ...(state.capabilities.length > 0
                        ? [createTextElement(t("dialogs.trustCapabilities", { capabilities: state.capabilities.map((id) => id || "<empty id>").join(", ") }), { color: "light" })]
                        : []),
                ]),
            ];
        const bodyPanel = createPanelElement({ direction: "column", gap: "md", paddingX: "xxl", paddingY: "xl" }, body);

        const buttons = change
            ? [
                new ButtonView({ variant: "danger", onClick: () => model.close("unregister"), children: t("dialogs.trustUnregister") }),
                new ButtonView({ variant: "primary", onClick: () => model.close("accept"), children: t("dialogs.trustAccept") }),
            ]
            : [
                new ButtonView({ onClick: () => model.close(false), children: t("dialogs.trustCancel") }),
                new ButtonView({ variant: "primary", onClick: () => model.close(true), children: t("dialogs.trustBoard") }),
            ];
        const buttonsPanel = createPanelElement(
            { direction: "row", justify: "end", gap: "sm", padding: "md" },
            buttons.map((button) => button.root),
        );
        const contentChildren = document.createDocumentFragment();
        contentChildren.append(bodyPanel, buttonsPanel);
        const contentView = new DialogContentView({
            title: change ? PERMISSION_CHANGE_TITLE : t("dialogs.trustTitle"),
            icon: "warning",
            // Closing the change dialog takes the board off its page (see requestBoardTrust).
            onClose: () => model.close(change ? undefined : false),
            minWidth: 420,
            maxWidth: 640,
            children: contentChildren,
        });
        const dialogView = new DialogView({
            name: change ? "board-permission-change-dialog" : "trust-board-dialog",
            onEscape: () => model.close(change ? undefined : false),
            children: contentView.root,
        });

        super(props, dialogView.root);
        this.model = model;
        this.dialogView = this.child(dialogView);
        this.contentView = this.child(contentView);
        this.buttons = buttons.map((button) => this.child(button));
        this.boardPathElement = boardPathElement;
    }

    protected onMount(): void {
        for (const button of this.buttons) button.mount();
        this.contentView.mount();
        this.dialogView.mount();
        this.bind(this.model.state, (next) => next.boardPath, (boardPath) => {
            this.boardPathElement.textContent = boardPath;
        });
    }
}
