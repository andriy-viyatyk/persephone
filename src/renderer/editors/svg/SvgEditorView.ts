import { SvgEditor } from "./SvgEditor";
import { SvgBodyView } from "./SvgBodyView";
import { TextEditorPageView } from "../base/TextEditorPageView";
import { ImageActionsToolbarView, type ImageToolbarItem } from "../shared/ImageActionsToolbarView";
import { VanillaView } from "../../uikit/shared/vanilla-view";

const svgItems: ReadonlyArray<ImageToolbarItem> = [
    { kind: "action", action: "draw" },
    { kind: "action", action: "save" },
    { kind: "action", action: "copy" },
];

export class SvgEditorView extends VanillaView<{ model: SvgEditor }> {
    private readonly body: SvgBodyView;
    private readonly toolbar: ImageActionsToolbarView;
    private readonly pageView: TextEditorPageView<SvgEditor>;
    private model: SvgEditor;

    public constructor(props: { model: SvgEditor }) {
        const body = new SvgBodyView({ model: props.model });
        const toolbar = new ImageActionsToolbarView({ model: props.model, items: svgItems, namePrefix: "svg-" });
        const pageView = new TextEditorPageView({
            model: props.model,
            createParts: () => ({ body: body.root, rightToolbar: toolbar.root }),
        });
        super(props, pageView.root);
        this.model = props.model;
        this.body = this.child(body);
        this.toolbar = this.child(toolbar);
        this.pageView = this.child(pageView);
    }

    protected onMount(): void {
        this.body.mount();
        this.toolbar.mount();
        this.pageView.mount();
    }

    protected onUpdate(props: { model: SvgEditor }): void {
        this.pageView.update({ model: props.model, createParts: () => ({ body: this.body.root, rightToolbar: this.toolbar.root }) });
        this.model = props.model;
        this.body.update({ model: this.model });
        this.toolbar.update({ model: this.model, items: svgItems, namePrefix: "svg-" });
    }
}
