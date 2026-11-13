import { createContentsElement } from "../../uikit/shared/create-contents-element";
import { EnvVarsEditor } from "./EnvVarsEditor";
import { EnvVarsBodyView } from "./EnvVarsBodyView";
import { TextEditorPageView } from "../base/TextEditorPageView";
import { VanillaView } from "../../uikit/shared/vanilla-view";


export class EnvVarsEditorView extends VanillaView<{ model: EnvVarsEditor }> {
    private model: EnvVarsEditor | undefined;
    private body: EnvVarsBodyView | undefined;
    private pageView: TextEditorPageView<EnvVarsEditor> | undefined;

    public constructor(props: { model: EnvVarsEditor }) {
        super(props, createContentsElement());
    }

    protected onMount(): void {
        const model = this.props.model;
        this.model = model;
        const body = this.child(new EnvVarsBodyView({ model }));
        const pageView = this.child(new TextEditorPageView({
            model: this.props.model,
            createParts: () => ({ body: body.root }),
        }));
        this.body = body;
        this.pageView = pageView;
        this.root.append(body.root, pageView.root);
        body.mount();
        pageView.mount();
    }

    protected onUpdate(props: { model: EnvVarsEditor }): void {
        const model = props.model;
        const body = this.body;
        const pageView = this.pageView;
        if (!body || !pageView) return;
        pageView.update({ model, createParts: () => ({ body: body.root }) });
    }
}
