import type { EditorModel } from "../base/EditorModel";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import { ButtonView } from "../../uikit/Button/ButtonView";
import { t } from "../../../shared/i18n/t";
import { RestoreFailedEditor } from "./RestoreFailedEditor";
import "../../uikit/Button/Button.css";
import "./restore-failed.css";

export class RestoreFailedView extends VanillaView<{ model: EditorModel }> {
    private readonly model: RestoreFailedEditor;
    private readonly title = document.createElement("h2");
    private readonly error = document.createElement("p");
    private retryButton?: ButtonView;

    constructor(props: { model: EditorModel }) {
        const root = document.createElement("div");
        root.dataset.type = "restore-failed";
        super(props, root);
        if (!(props.model instanceof RestoreFailedEditor)) throw new Error("Invalid recovery editor");
        this.model = props.model;
    }

    protected onMount(): void {
        this.retryButton = this.child(new ButtonView(this.retryProps()));
        const close = this.child(new ButtonView({ name: "restore-failed-close", children: t("editors.restoreFailedClose"), onClick: () => { void this.model.closePage(); } }));
        const actions = document.createElement("div");
        actions.dataset.part = "actions";
        actions.append(this.retryButton.root, close.root);
        this.root.append(this.title, this.error, actions);
        this.retryButton.mount();
        close.mount();
        this.own(this.model.state.subscribe(() => this.render()));
        this.render();
    }

    private retryProps() {
        return { name: "restore-failed-retry", children: t("editors.restoreFailedRetry"), disabled: this.model.state.get().retrying, onClick: () => { void this.model.retry(); } };
    }

    private render(): void {
        const state = this.model.state.get();
        this.title.textContent = state.title;
        this.error.textContent = t("editors.restoreFailedError", { error: state.error });
        this.retryButton?.update(this.retryProps());
    }
}
