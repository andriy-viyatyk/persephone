import { TComponentState } from "../../core/state/state";
import { MonacoEditor, defaultMonacoEditorState } from "./MonacoEditor";
import { MonacoBodyView } from "./MonacoBodyView";
import { TextChromeView } from "../base/TextChromeView";
import { IconButtonView, type IconButtonViewProps } from "../../uikit/IconButton/IconButtonView";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import type { EditorModule } from "../base/editorRegistry";
import type { EditorModel } from "../base/EditorModel";

function requireMonacoModel(model: EditorModel): MonacoEditor {
    if (!(model instanceof MonacoEditor)) throw new Error("Monaco view received an invalid model.");
    return model;
}

function createContentsRoot(): HTMLSpanElement {
    const root = document.createElement("span");
    root.style.display = "contents";
    return root;
}

class MonacoToolbarBitsView extends VanillaView<{ model: MonacoEditor }> {
    private model: MonacoEditor;
    private button: IconButtonView | undefined;
    private stateSubscription: (() => void) | undefined;

    public constructor(props: { model: MonacoEditor }) {
        super(props, createContentsRoot());
        this.model = props.model;
    }

    protected onMount(): void {
        this.button = this.child(new IconButtonView(this.buttonProps()));
        this.root.append(this.button.root);
        this.button.mount();
        this.bindState();
        this.own(() => {
            this.stateSubscription?.();
            this.stateSubscription = undefined;
        });
    }

    protected onUpdate(props: { model: MonacoEditor }): void {
        if (props.model !== this.model) {
            this.model = props.model;
            this.bindState();
        }
        this.sync(this.model.wordWrap);
    }

    protected onDispose(): void {
        this.button = undefined;
    }

    private bindState(): void {
        this.stateSubscription?.();
        this.stateSubscription = this.model.state.subscribe<boolean>(
            (wordWrap) => {
                if (this.isDisposed) return;
                this.sync(wordWrap);
            },
            (state) => state.wordWrap,
        );
    }

    private sync(wordWrap: boolean): void {
        this.button?.update(this.buttonProps(wordWrap));
    }

    private buttonProps(wordWrap = this.model.wordWrap): IconButtonViewProps {
        return {
            name: "text-word-wrap-toggle",
            size: "sm",
            active: wordWrap,
            title: wordWrap ? "Turn Word Wrap off" : "Turn Word Wrap on",
            icon: "wrap-text",
            onClick: this.model.toggleWordWrap,
        };
    }
}

export class MonacoEditorView extends VanillaView<{ model: EditorModel }> {
    private readonly body: MonacoBodyView;
    private readonly toolbar: MonacoToolbarBitsView;
    private readonly chrome: TextChromeView;

    public constructor(props: { model: EditorModel }) {
        const model = requireMonacoModel(props.model);
        const body = new MonacoBodyView({ model });
        const toolbar = new MonacoToolbarBitsView({ model });
        const chrome = new TextChromeView({
            model: props.model,
            children: body.root,
            rightToolbarContributions: toolbar.root,
        });
        super(props, chrome.root);
        this.body = this.child(body);
        this.toolbar = this.child(toolbar);
        this.chrome = this.child(chrome);
    }

    protected onMount(): void {
        this.body.mount();
        this.toolbar.mount();
        this.chrome.mount();
    }

    protected onUpdate(props: { model: EditorModel }): void {
        const model = requireMonacoModel(props.model);
        this.body.update({ model });
        this.toolbar.update({ model });
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
