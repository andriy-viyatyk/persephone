import { TComponentState } from "../../core/state/state";
import { t } from "../../../shared/i18n/t";
import { MonacoEditor, defaultMonacoEditorState } from "./MonacoEditor";
import { MonacoBodyView } from "./MonacoBodyView";
import { TextChromeView } from "../base/TextChromeView";
import { IconButtonView, type IconButtonViewProps } from "../../uikit/IconButton/IconButtonView";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import type { EditorModule } from "../base/editorRegistry";
import type { EditorModel } from "../base/EditorModel";
import { TranscriptController } from "../../ui/transcript/TranscriptController";
import type { TranscriptState } from "../../ui/transcript/TranscriptController";
import { TranscriptToolbarContributionView } from "../../ui/transcript/TranscriptToolbarContributionView";
import { TranslateTextPageController } from "../../ui/translation/TranslateTextPageController";
import { TranslateTextToolbarContributionView } from "../../ui/translation/TranslateTextToolbarContributionView";

function requireMonacoModel(model: EditorModel): MonacoEditor {
    if (!(model instanceof MonacoEditor)) throw new Error("Monaco view received an invalid model.");
    return model;
}

function createContentsRoot(): HTMLSpanElement {
    const root = document.createElement("span");
    root.style.display = "contents";
    return root;
}

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
        super(props, createContentsRoot());
        this.model = props.model;
        this.transcript = this.child(new TranscriptToolbarContributionView({ controller: props.transcriptController }));
        this.translate = this.child(new TranslateTextToolbarContributionView({ controller: props.translationController, model: props.model, language: props.model.contentHost?.state.get().language ?? "plaintext" }));
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

export class MonacoEditorView extends VanillaView<{ model: EditorModel }> {
    private readonly body: MonacoBodyView;
    private readonly toolbar: MonacoToolbarBitsView;
    private readonly chrome: TextChromeView;
    private readonly transcriptController: TranscriptController;
    private readonly translationController: TranslateTextPageController;

    public constructor(props: { model: EditorModel }) {
        const model = requireMonacoModel(props.model);
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
        const chrome = new TextChromeView({
            model: props.model,
            children: body.root,
            rightToolbarContributions: toolbarView.root,
        });
        super(props, chrome.root);
        this.transcriptController = transcriptController;
        this.translationController = translationController;
        this.body = this.child(body);
        this.toolbar = this.child(toolbarView);
        this.chrome = this.child(chrome);
        this.own(unsubscribeProject);
    }

    protected onMount(): void {
        this.body.mount();
        this.toolbar.mount();
        this.toolbar.updateProjectActive(this.body.getProjectActive());
        this.chrome.mount();
    }

    protected onUpdate(props: { model: EditorModel }): void {
        const model = requireMonacoModel(props.model);
        this.body.update({ model });
        this.toolbar.update({ model, transcriptController: this.transcriptController, translationController: this.translationController });
        this.chrome.update({
            model: props.model,
            children: this.body.root,
            rightToolbarContributions: this.toolbar.root,
        });
    }
}

export const monacoModule: EditorModule = {
    createEditor: () =>
        new MonacoEditor(new TComponentState({ ...defaultMonacoEditorState })),
    View: MonacoEditorView,
};

export { MonacoEditor, defaultMonacoEditorState };
export type {
    MonacoEditorState,
    MonacoQueueEvent,
    MonacoQueueRequest,
} from "./MonacoEditor";
