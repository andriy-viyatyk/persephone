import { TDialogModel } from "../../core/state/model";
import { ButtonView } from "../../uikit/Button/ButtonView";
import { DialogContentView } from "../../uikit/Dialog/DialogContentView";
import { DialogView } from "../../uikit/Dialog/DialogView";
import { createPanelElement } from "../../uikit/Panel/panel-style";
import { createTextElement } from "../../uikit/Text/text-style";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import type { DialogViewProps } from "./dialog-view-registry";
import type { RegisterToolsetDialogProps } from "./RegisterToolsetDialog";
import { t } from "../../../shared/i18n/t";
import "../../uikit/Button/Button.css";
import "../../uikit/Dialog/Dialog.css";

type RegisterToolsetDialogModel = TDialogModel<RegisterToolsetDialogProps, boolean>;

export class RegisterToolsetDialogView extends VanillaView<DialogViewProps> {
    private readonly model: RegisterToolsetDialogModel;
    private readonly dialogView: DialogView;
    private readonly contentView: DialogContentView;
    private readonly detailsElement: HTMLSpanElement;
    private readonly toolElements = new Map<string, HTMLSpanElement>();
    private readonly cancelButton: ButtonView;
    private readonly registerButton: ButtonView;

    public constructor(props: DialogViewProps) {
        const model = props.model as RegisterToolsetDialogModel;
        const state = model.state.get();
        const detailsElement = createTextElement(t("dialogs.toolsetDetails", { name: state.toolsetName, root: state.toolsetRoot }), { color: "light" });
        const bodyPanel = createPanelElement(
            { direction: "column", gap: "md", paddingX: "xxl", paddingY: "xl" },
            [
                createTextElement(
                    t("dialogs.toolsetIntroduction"),
                ),
                createTextElement(t("dialogs.toolsetCaution")),
                createTextElement(
                    t("dialogs.toolsetReviewHint"),
                    { color: "warning" },
                ),
                detailsElement,
            ],
        );
        const cancelButton = new ButtonView({
            onClick: () => model.close(false),
            children: t("dialogs.toolsetCancel"),
        });
        const registerButton = new ButtonView({
            variant: "primary",
            onClick: () => model.close(true),
            children: t("dialogs.toolsetRegister"),
        });
        const buttonsPanel = createPanelElement(
            { direction: "row", justify: "end", gap: "sm", padding: "md" },
            [cancelButton.root, registerButton.root],
        );
        const contentChildren = document.createDocumentFragment();
        contentChildren.append(bodyPanel, buttonsPanel);
        const contentView = new DialogContentView({
            title: t("dialogs.toolsetTitle"),
            icon: "warning",
            onClose: () => model.close(false),
            minWidth: 440,
            maxWidth: 680,
            children: contentChildren,
        });
        const dialogView = new DialogView({
            name: "register-toolset-dialog",
            onEscape: () => model.close(false),
            children: contentView.root,
        });

        super(props, dialogView.root);
        this.model = model;
        this.dialogView = this.child(dialogView);
        this.contentView = this.child(contentView);
        this.cancelButton = this.child(cancelButton);
        this.registerButton = this.child(registerButton);
        this.detailsElement = detailsElement;
    }

    protected onMount(): void {
        this.cancelButton.mount();
        this.registerButton.mount();
        this.contentView.mount();
        this.dialogView.mount();
        this.bind(this.model.state, (state) => t("dialogs.toolsetDetails", { name: state.toolsetName, root: state.toolsetRoot }), (value) => {
            this.detailsElement.textContent = value;
        });
        this.bind(this.model.state, (state) => state.tools, (tools) => {
            this.syncTools(tools);
        });
    }

    private syncTools(tools: RegisterToolsetDialogProps["tools"]): void {
        const names = new Set(tools.map((tool) => tool.name));
        for (const [name, element] of this.toolElements) {
            if (names.has(name)) continue;
            element.remove();
            this.toolElements.delete(name);
        }
        tools.forEach((tool) => {
            let element = this.toolElements.get(tool.name);
            if (!element) {
                element = createTextElement("", { color: "light" });
                this.toolElements.set(tool.name, element);
                this.detailsElement.parentElement?.append(element);
            }
            element.textContent = t("dialogs.toolsetEntry", { name: tool.name, description: tool.description });
            this.detailsElement.parentElement?.append(element);
        });
    }
}
