import { createContentsElement } from "../../uikit/shared/create-contents-element";
import { FileDiffEditor } from "./FileDiffEditor";
import { FileDiffBodyView } from "./FileDiffBodyView";
import { FileDiffToolbarView } from "./FileDiffToolbarView";
import { TextEditorPageView } from "../base/TextEditorPageView";
import { VanillaView } from "../../uikit/shared/vanilla-view";


export class FileDiffEditorView extends VanillaView<{ model: FileDiffEditor }> {
    private model: FileDiffEditor | undefined;
    private body: FileDiffBodyView | undefined;
    private toolbar: FileDiffToolbarView | undefined;
    private pageView: TextEditorPageView<FileDiffEditor> | undefined;

    public constructor(props: { model: FileDiffEditor }) {
        super(props, createContentsElement());
    }

    protected onMount(): void {
        const model = this.props.model;
        this.model = model;
        const body = this.child(new FileDiffBodyView({ model }));
        const toolbar = this.child(new FileDiffToolbarView({ model }));
        const pageView = this.child(new TextEditorPageView({
            model: this.props.model,
            createParts: () => ({ body: body.root, toolbar: toolbar.root }),
        }));
        this.body = body;
        this.toolbar = toolbar;
        this.pageView = pageView;
        this.root.append(body.root, toolbar.root, pageView.root);
        body.mount();
        toolbar.mount();
        pageView.mount();
    }

    protected onUpdate(props: { model: FileDiffEditor }): void {
        const model = props.model;
        const body = this.body;
        const toolbar = this.toolbar;
        const pageView = this.pageView;
        if (!body || !toolbar || !pageView) return;
        pageView.update({ model, createParts: () => ({ body: body.root, toolbar: toolbar.root }) });
        body.update({ model });
        toolbar.update({ model });
    }
}
