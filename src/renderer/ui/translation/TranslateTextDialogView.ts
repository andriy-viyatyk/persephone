import { TDialogModel } from "../../core/state/model";
import { ButtonView } from "../../uikit/Button/ButtonView";
import { DialogContentView } from "../../uikit/Dialog/DialogContentView";
import { DialogView } from "../../uikit/Dialog/DialogView";
import { ProgressBarView } from "../../uikit/ProgressBar/ProgressBarView";
import { SelectView } from "../../uikit/Select/SelectView";
import type { IListBoxItem } from "../../uikit/ListBox/types";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import { createPanelElement } from "../../uikit/Panel/panel-style";
import { createTextElement } from "../../uikit/Text/text-style";
import { t } from "../../../shared/i18n/t";
import type { DialogViewProps } from "../dialogs/dialog-view-registry";
import "../../uikit/Button/Button.css";
import "../../uikit/Dialog/Dialog.css";
import "../../uikit/ProgressBar/ProgressBar.css";
import "../../uikit/Select/Select.css";
import "./TranslateTextDialogView.css";

export interface TranslationChoice { code: string; label: string; installed: boolean; sizeBytes: number }
export interface TranslateTextDialogState {
    title: string;
    sourceChoices: TranslationChoice[];
    targetChoices: TranslationChoice[];
    source: string;
    target: string;
    detectionText: string;
    sourceEnabled: boolean;
    targetEnabled: boolean;
    progressVisible: boolean;
    progress: number;
    progressMax: number;
    progressText: string;
    busy: boolean;
}
export type TranslateTextDialogModel = TDialogModel<TranslateTextDialogState, "done" | undefined> & {
    setSource(value: string): void;
    setTarget(value: string): void;
    startTranslation(): void;
    cancelTranslation(): void;
};

function listItems(choices: TranslationChoice[]): IListBoxItem[] {
    return choices.map((choice) => ({ value: choice.code, label: choice.label }));
}

function selectedItem(choices: TranslationChoice[], value: string): IListBoxItem | null {
    const choice = choices.find((item) => item.code === value);
    return choice ? { value: choice.code, label: choice.label } : null;
}

export class TranslateTextDialogView extends VanillaView<DialogViewProps> {
    private readonly model: TranslateTextDialogModel;
    private readonly dialog: DialogView;
    private readonly content: DialogContentView;
    private readonly source: SelectView<IListBoxItem>;
    private readonly target: SelectView<IListBoxItem>;
    private readonly detected: HTMLSpanElement;
    private readonly status: HTMLDivElement;
    private readonly progress: ProgressBarView;
    private readonly start: ButtonView;
    private readonly cancel: ButtonView;

    public constructor(props: DialogViewProps) {
        const model = props.model as TranslateTextDialogModel;
        const state = model.state.get();
        const detected = createTextElement(state.detectionText, { size: "sm", color: "light" });
        const source = new SelectView<IListBoxItem>({ name: "translation-source", items: listItems(state.sourceChoices), value: selectedItem(state.sourceChoices, state.source), onChange: (item) => model.setSource(String(item.value)), "aria-label": t("translation.sourceLanguage") });
        const target = new SelectView<IListBoxItem>({ name: "translation-target", items: listItems(state.targetChoices), value: selectedItem(state.targetChoices, state.target), onChange: (item) => model.setTarget(String(item.value)), "aria-label": t("translation.targetLanguage") });
        const progress = new ProgressBarView({ name: "translation-progress", value: state.progress, max: state.progressMax || 1, "aria-label": t("translation.translating", { done: state.progress, total: state.progressMax }) });
        const status = document.createElement("div");
        status.dataset.part = "status";
        const start = new ButtonView({ name: "translation-start", children: t("translation.start"), onClick: model.startTranslation });
        const cancel = new ButtonView({ name: "translation-cancel", children: t("translation.cancel"), onClick: model.cancelTranslation });
        const picks = createPanelElement({ direction: "column", gap: "md" }, [
            createPanelElement({ direction: "column", gap: "xs" }, [createTextElement(t("translation.sourceLanguage"), { size: "sm" }), source.root]),
            createPanelElement({ direction: "column", gap: "xs" }, [createTextElement(t("translation.targetLanguage"), { size: "sm" }), target.root]),
        ]);
        const progressBox = createPanelElement({ direction: "column", gap: "sm" }, [status, progress.root]);
        progressBox.dataset.part = "progress";
        const buttons = createPanelElement({ direction: "row", justify: "end", gap: "sm", padding: "md" }, [start.root, cancel.root]);
        const body = createPanelElement({ direction: "column", gap: "md", paddingX: "xxl", paddingY: "xl" }, [detected, picks, progressBox, buttons]);
        body.dataset.type = "translate-text-dialog-body";
        const content = new DialogContentView({ title: t("translation.dialogTitle"), icon: "confirm", onClose: model.cancelTranslation, minWidth: 420, children: body });
        const dialog = new DialogView({ name: "translate-text-dialog", onEscape: model.cancelTranslation, children: content.root });
        super(props, dialog.root);
        this.model = model;
        this.dialog = this.child(dialog);
        this.content = this.child(content);
        this.source = this.child(source);
        this.target = this.child(target);
        this.detected = detected;
        this.status = status;
        this.progress = this.child(progress);
        this.start = this.child(start);
        this.cancel = this.child(cancel);
    }

    protected onMount(): void {
        this.source.mount(); this.target.mount(); this.progress.mount(); this.start.mount(); this.cancel.mount();
        this.content.mount(); this.dialog.mount();
        this.bind(this.model.state, (state) => state, () => this.sync());
        this.sync();
    }

    private sync(): void {
        const state = this.model.state.get();
        this.content.setTitle(state.title);
        this.detected.textContent = state.detectionText;
        this.status.textContent = state.progressText;
        this.source.update({ name: "translation-source", items: listItems(state.sourceChoices), value: selectedItem(state.sourceChoices, state.source), disabled: !state.sourceEnabled, onChange: (item) => this.model.setSource(String(item.value)), "aria-label": t("translation.sourceLanguage") });
        this.target.update({ name: "translation-target", items: listItems(state.targetChoices), value: selectedItem(state.targetChoices, state.target), disabled: !state.targetEnabled, onChange: (item) => this.model.setTarget(String(item.value)), "aria-label": t("translation.targetLanguage") });
        this.progress.update({ name: "translation-progress", value: state.progress, max: state.progressMax || 1, "aria-label": t("translation.translating", { done: state.progress, total: state.progressMax }) });
        this.progress.root.hidden = !state.progressVisible;
        this.status.hidden = !state.progressVisible;
        this.start.update({ name: "translation-start", children: t("translation.start"), disabled: state.busy || !state.source || !state.target, onClick: this.model.startTranslation });
        this.cancel.update({ name: "translation-cancel", children: t("translation.cancel"), onClick: this.model.cancelTranslation });
    }
}
