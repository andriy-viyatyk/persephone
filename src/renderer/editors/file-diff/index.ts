import { createContentsElement } from "../../uikit/shared/create-contents-element";
import { TComponentState } from "../../core/state/state";
import { FileDiffEditor, defaultFileDiffEditorState } from "./FileDiffEditor";
import { FileDiffBodyView } from "./FileDiffBodyView";
import { FileDiffToolbarView } from "./FileDiffToolbarView";
import { TextChromeView } from "../base/TextChromeView";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import { defineEditorModule } from "../base/editorRegistry";


export class FileDiffEditorView extends VanillaView<{ model: FileDiffEditor }> {
    private model: FileDiffEditor | undefined;
    private body: FileDiffBodyView | undefined;
    private toolbar: FileDiffToolbarView | undefined;
    private chrome: TextChromeView | undefined;

    public constructor(props: { model: FileDiffEditor }) {
        super(props, createContentsElement());
    }

    protected onMount(): void {
        const model = this.props.model;
        this.model = model;
        const body = this.child(new FileDiffBodyView({ model }));
        const toolbar = this.child(new FileDiffToolbarView({ model }));
        const chrome = this.child(new TextChromeView({
            model: this.props.model,
            children: body.root,
            toolbarContributions: toolbar.root,
        }));
        this.body = body;
        this.toolbar = toolbar;
        this.chrome = chrome;
        this.root.append(body.root, toolbar.root, chrome.root);
        body.mount();
        toolbar.mount();
        chrome.mount();
    }

    protected onUpdate(props: { model: FileDiffEditor }): void {
        const model = props.model;
        if (model !== this.model) {
            throw new Error("File Diff view received a different model instance.");
        }
        const body = this.body;
        const toolbar = this.toolbar;
        const chrome = this.chrome;
        if (!body || !toolbar || !chrome) return;
        body.update({ model });
        toolbar.update({ model });
        chrome.update({
            model: props.model,
            children: body.root,
            toolbarContributions: toolbar.root,
        });
    }
}

export const fileDiffModule = defineEditorModule(FileDiffEditor, {
    createEditor: () =>
        new FileDiffEditor(new TComponentState({ ...defaultFileDiffEditorState })),
    View: FileDiffEditorView,
});

export { FileDiffEditor, defaultFileDiffEditorState };
export type { FileDiffEditorState, RevSel } from "./FileDiffEditor";

