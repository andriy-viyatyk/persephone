import type { EditorModelInstance as EditorModel } from "./EditorModel";
import { TextChromeView } from "./TextChromeView";
import type { SlotContent } from "../../uikit/shared/fill-slot";
import { VanillaView } from "../../uikit/shared/vanilla-view";

export interface TextEditorPageParts {
    body: SlotContent;
    toolbar?: SlotContent;
    rightToolbar?: SlotContent;
    footer?: SlotContent;
}

export interface TextEditorPageViewProps<M extends EditorModel> {
    model: M;
    createParts(model: M): TextEditorPageParts;
}

export class TextEditorPageView<M extends EditorModel> extends VanillaView<TextEditorPageViewProps<M>> {
    private readonly model: M;
    private readonly parts: TextEditorPageParts;
    private readonly chrome: TextChromeView;

    public constructor(props: TextEditorPageViewProps<M>) {
        const parts = props.createParts(props.model);
        const chrome = new TextChromeView({
            model: props.model,
            children: parts.body,
            toolbarContributions: parts.toolbar,
            rightToolbarContributions: parts.rightToolbar,
            footerContributions: parts.footer,
        });
        super(props, chrome.root);
        this.model = props.model;
        this.parts = parts;
        this.chrome = this.child(chrome);
    }

    protected onMount(): void {
        this.chrome.mount();
    }

    protected onUpdate(props: TextEditorPageViewProps<M>): void {
        if (props.model !== this.model) {
            throw new Error("Text editor page view received a different model instance.");
        }
        this.chrome.update({
            model: this.model,
            children: this.parts.body,
            toolbarContributions: this.parts.toolbar,
            rightToolbarContributions: this.parts.rightToolbar,
            footerContributions: this.parts.footer,
        });
    }
}
