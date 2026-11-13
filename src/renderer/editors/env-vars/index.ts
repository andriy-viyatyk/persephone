import { createContentsElement } from "../../uikit/shared/create-contents-element";
import { TComponentState } from "../../core/state/state";
import { EnvVarsEditor, defaultEnvVarsEditorState } from "./EnvVarsEditor";
import { EnvVarsBodyView } from "./EnvVarsBodyView";
import { TextChromeView } from "../base/TextChromeView";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import { defineEditorModule } from "../base/editorRegistry";


export class EnvVarsEditorView extends VanillaView<{ model: EnvVarsEditor }> {
    private model: EnvVarsEditor | undefined;
    private body: EnvVarsBodyView | undefined;
    private chrome: TextChromeView | undefined;

    public constructor(props: { model: EnvVarsEditor }) {
        super(props, createContentsElement());
    }

    protected onMount(): void {
        const model = this.props.model;
        this.model = model;
        const body = this.child(new EnvVarsBodyView({ model }));
        const chrome = this.child(new TextChromeView({
            model: this.props.model,
            children: body.root,
        }));
        this.body = body;
        this.chrome = chrome;
        this.root.append(body.root, chrome.root);
        body.mount();
        chrome.mount();
    }

    protected onUpdate(props: { model: EnvVarsEditor }): void {
        const model = props.model;
        if (model !== this.model) {
            throw new Error("Env Vars view received a different model instance.");
        }
        const body = this.body;
        const chrome = this.chrome;
        if (!body || !chrome) return;
        chrome.update({ model: props.model, children: body.root });
    }
}


export const envVarsModule = defineEditorModule(EnvVarsEditor, {
    createEditor: () =>
        new EnvVarsEditor(new TComponentState({ ...defaultEnvVarsEditorState })),
    View: EnvVarsEditorView,
});

export { EnvVarsEditor, defaultEnvVarsEditorState };
export type { EnvVarsEditorState } from "./EnvVarsEditor";
