import { createContentsElement } from "../../uikit/shared/create-contents-element";
import { t } from "../../../shared/i18n/t";
import { MonacoEditor } from "./MonacoEditor";
import { MonacoBodyView } from "./MonacoBodyView";
import { TextEditorPageView } from "../base/TextEditorPageView";
import { IconButtonView, type IconButtonViewProps } from "../../uikit/IconButton/IconButtonView";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import { TranscriptController } from "../../ui/transcript/TranscriptController";
import type { TranscriptState } from "../../ui/transcript/TranscriptController";
import { TranscriptToolbarContributionView } from "../../ui/transcript/TranscriptToolbarContributionView";
import { TranslateTextPageController } from "../../ui/translation/TranslateTextPageController";
import { TranslateTextToolbarContributionView } from "../../ui/translation/TranslateTextToolbarContributionView";



interface MonacoToolbarBitsProps { model: MonacoEditor; transcriptController: TranscriptController; translationController: TranslateTextPageController }

class MonacoToolbarBitsView extends VanillaView<MonacoToolbarBitsProps> {
    private model: MonacoEditor;
    private button: IconButtonView | undefined;
    private diagnosticsButton: IconButtonView | undefined;
    private projectActive = false;
    private stateSubscription: (() => void) | undefined;
    private readonly transcript: TranscriptToolbarContributionView;
    private readonly translate: TranslateTextToolbarContributionView;

    public constructor(props: MonacoToolbarBitsProps) {
        super(props, createContentsElement());
        this.model = props.model;
        this.transcript = this.child(new TranscriptToolbarContributionView({ controller: props.transcriptController }));
        this.translate = this.child(new TranslateTextToolbarContributionView({ controller: props.translationController, model: props.model, language: props.model.language ?? "plaintext" }));
    }

    protected onMount(): void {
        this.button = this.child(new IconButtonView(this.buttonProps()));
        this.root.append(this.button.root);
        this.button.mount();
        this.diagnosticsButton = this.child(new IconButtonView(this.diagnosticsButtonProps()));
        this.root.append(this.diagnosticsButton.root);
        this.diagnosticsButton.mount();
        this.diagnosticsButton.root.hidden = !this.projectActive;
        this.transcript.mount();
        this.root.append(this.transcript.root);
        this.translate.mount();
        this.root.append(this.translate.root);
        this.bindState();
        this.own(() => {
            this.stateSubscription?.();
            this.stateSubscription = undefined;
        });
    }

    protected onUpdate(props: MonacoToolbarBitsProps): void {
        if (props.model !== this.model) {
            this.model = props.model;
            this.bindState();
        }
        this.sync();
    }

    protected onDispose(): void {
        this.button = undefined;
        this.diagnosticsButton = undefined;
    }

    public updateProjectActive(active: boolean): void {
        this.projectActive = active;
        if (this.diagnosticsButton) this.diagnosticsButton.root.hidden = !active;
    }

    public updateTranscriptState(state: TranscriptState): void {
        this.transcript.updateState(state);
    }

    public updateTranslationAvailability(available: boolean): void {
        this.translate.setProviderAvailable(available);
    }

    private bindState(): void {
        this.stateSubscription?.();
        this.stateSubscription = this.model.state.subscribe<{ wordWrap: boolean; diagnostics: boolean }>(
            (values) => {
                if (this.isDisposed) return;
                this.sync(values.wordWrap, values.diagnostics);
            },
            (state) => ({ wordWrap: state.wordWrap, diagnostics: state.diagnostics }),
        );
    }

    private sync(wordWrap = this.model.wordWrap, diagnostics = this.model.diagnostics): void {
        this.button?.update(this.buttonProps(wordWrap));
        this.diagnosticsButton?.update(this.diagnosticsButtonProps(diagnostics));
    }

    private diagnosticsButtonProps(diagnostics = this.model.diagnostics): IconButtonViewProps {
        return {
            name: "text-ts-diagnostics-toggle",
            size: "sm",
            active: diagnostics,
            title: diagnostics ? t("editors.turnTsDiagnosticsOff") : t("editors.turnTsDiagnosticsOn"),
            icon: "warning",
            onClick: this.model.toggleDiagnostics,
        };
    }

    private buttonProps(wordWrap = this.model.wordWrap): IconButtonViewProps {
        return {
            name: "text-word-wrap-toggle",
            size: "sm",
            active: wordWrap,
            title: wordWrap ? t("editors.turnWordWrapOff") : t("editors.turnWordWrapOn"),
            icon: "wrap-text",
            onClick: this.model.toggleWordWrap,
        };
    }
}

export class MonacoEditorView extends VanillaView<{ model: MonacoEditor }> {
    private readonly body: MonacoBodyView;
    private readonly toolbar: MonacoToolbarBitsView;
    private readonly pageView: TextEditorPageView<MonacoEditor>;
    private readonly transcriptController: TranscriptController;
    private readonly translationController: TranslateTextPageController;

    public constructor(props: { model: MonacoEditor }) {
        const model = props.model;
        const body = new MonacoBodyView({ model });
        const toolbarRef: { current?: MonacoToolbarBitsView } = {};
        const transcriptController = new TranscriptController(() => body.getEditor(), (state) => toolbarRef.current?.updateTranscriptState(state));
        const translationController = new TranslateTextPageController(
            () => body.getEditor(),
            () => model,
            (available) => {
                toolbarRef.current?.updateTranslationAvailability(available);
                body.setTranslationAvailability(available);
            },
        );
        const unsubscribeProject = body.onProjectActiveChange((active) => toolbarRef.current?.updateProjectActive(active));
        body.setTranslationHandler(() => { void translationController.start("selection"); });
        const toolbarView = new MonacoToolbarBitsView({ model, transcriptController, translationController });
        toolbarRef.current = toolbarView;
        const pageView = new TextEditorPageView({
            model: props.model,
            createParts: () => ({ body: body.root, rightToolbar: toolbarView.root }),
        });
        super(props, pageView.root);
        this.transcriptController = transcriptController;
        this.translationController = translationController;
        this.body = this.child(body);
        this.toolbar = this.child(toolbarView);
        this.pageView = this.child(pageView);
        this.own(unsubscribeProject);
    }

    protected onMount(): void {
        this.body.mount();
        this.toolbar.mount();
        this.toolbar.updateProjectActive(this.body.getProjectActive());
        this.pageView.mount();
    }

    protected onUpdate(props: { model: MonacoEditor }): void {
        const model = props.model;
        this.pageView.update({ model, createParts: () => ({ body: this.body.root, rightToolbar: this.toolbar.root }) });
        this.body.update({ model });
        this.toolbar.update({ model, transcriptController: this.transcriptController, translationController: this.translationController });
    }
}
