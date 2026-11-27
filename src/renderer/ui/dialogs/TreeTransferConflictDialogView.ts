import { ButtonView } from "../../uikit/Button/ButtonView";
import { CheckboxView } from "../../uikit/Checkbox/CheckboxView";
import { DialogContentView } from "../../uikit/Dialog/DialogContentView";
import { DialogView } from "../../uikit/Dialog/DialogView";
import { createPanelElement } from "../../uikit/Panel/panel-style";
import { createTextElement } from "../../uikit/Text/text-style";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import type { DialogViewProps } from "../../api/dialogs/dialog-view-registry";
import type { TreeTransferConflictDialogModel } from "../../api/dialogs/TreeTransferConflictDialog";
import { t } from "../../../shared/i18n/t";
import "../../uikit/Button/Button.css";
import "../../uikit/Checkbox/Checkbox.css";
import "../../uikit/Dialog/Dialog.css";

export class TreeTransferConflictDialogView extends VanillaView<DialogViewProps> {
    private readonly model: TreeTransferConflictDialogModel;
    private readonly dialog: DialogView;
    private readonly content: DialogContentView;
    private readonly checkbox: CheckboxView;
    private readonly buttons: ButtonView[];

    constructor(props: DialogViewProps) {
        const model = props.model as TreeTransferConflictDialogModel;
        const conflict = model.state.get().conflict;
        const checkbox = new CheckboxView({
            name: "tree-transfer-conflict-apply-all", checked: false,
            children: t("dialogs.treeTransferApplyToAll"), onChange: model.setApplyToAll,
        });
        const details = createTextElement(t("dialogs.treeTransferConflictDetails", {
            source: conflict.source.title, destination: conflict.destinationPath,
        }), { size: "sm" });
        const body = createPanelElement({ direction: "column", gap: "lg", padding: "xl" }, [details, checkbox.root]);
        const buttons = [
            new ButtonView({ name: "tree-transfer-overwrite", children: t("dialogs.buttonOverwrite"), onClick: () => { void model.choose("overwrite"); } }),
            new ButtonView({ name: "tree-transfer-keep-both", children: t("dialogs.treeTransferKeepBoth"), onClick: () => { void model.choose("keep-both"); } }),
            new ButtonView({ name: "tree-transfer-skip", children: t("dialogs.treeTransferSkip"), onClick: () => { void model.choose("skip"); } }),
            new ButtonView({ name: "tree-transfer-cancel", children: t("dialogs.buttonCancel"), onClick: model.cancel }),
        ];
        const panel = createPanelElement({ direction: "row", justify: "end", gap: "sm", padding: "md" }, buttons.map((button) => button.root));
        const content = new DialogContentView({
            title: t("dialogs.treeTransferConflictTitle"), onClose: model.cancel, children: [body, panel],
        });
        const dialog = new DialogView({ name: "tree-transfer-conflict-dialog", children: content.root, onEscape: model.cancel, onBackdropClick: model.cancel });
        super(props, dialog.root);
        this.model = model;
        this.dialog = this.child(dialog);
        this.content = this.child(content);
        this.checkbox = this.child(checkbox);
        this.buttons = buttons.map((button) => this.child(button));
        this.own(() => model.disposeView());
    }

    protected onMount(): void {
        this.checkbox.mount();
        this.buttons.forEach((button) => button.mount());
        this.content.mount();
        this.dialog.mount();
    }

    protected onDispose(): void {
        // Owned child views are disposed by VanillaView after the dialog lifecycle ends.
    }
}
