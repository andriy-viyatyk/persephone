import { createContentsElement } from "../../uikit/shared/create-contents-element";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import { TextEditorPageView } from "../base/TextEditorPageView";
import { LinkEditor } from "./LinkEditor";
import { LinkBodyView } from "./LinkBody";
import { LinkActionView, LinkBreadcrumbView, LinkFooterView } from "./LinkToolbarViews";

export class LinkEditorView extends VanillaView<{ model: LinkEditor }> {
    private model: LinkEditor | undefined;
    private breadcrumb: LinkBreadcrumbView | undefined;
    private actions: LinkActionView | undefined;
    private footer: LinkFooterView | undefined;
    private body: LinkBodyView | undefined;
    private pageView: TextEditorPageView<LinkEditor> | undefined;

    public constructor(props: { model: LinkEditor }) {
        super(props, createContentsElement());
    }

    protected onMount(): void {
        const model = this.props.model;
        const breadcrumb = this.child(new LinkBreadcrumbView({ model }));
        const actions = this.child(new LinkActionView({ model }));
        const footer = this.child(new LinkFooterView({ model }));
        const body = this.child(new LinkBodyView({ model }));
        const pageView = this.child(new TextEditorPageView({
            model: this.props.model,
            createParts: () => ({ body: body.root, toolbar: breadcrumb.root, rightToolbar: actions.root, footer: footer.root }),
        }));

        this.model = model;
        this.breadcrumb = breadcrumb;
        this.actions = actions;
        this.footer = footer;
        this.body = body;
        this.pageView = pageView;
        this.root.append(breadcrumb.root, actions.root, footer.root, pageView.root);
        breadcrumb.mount();
        actions.mount();
        footer.mount();
        body.mount();
        pageView.mount();
    }

    protected onUpdate(props: { model: LinkEditor }): void {
        const model = props.model;
        this.pageView?.update({ model, createParts: () => ({
            body: this.body?.root,
            toolbar: this.breadcrumb?.root,
            rightToolbar: this.actions?.root,
            footer: this.footer?.root,
        }) });
    }

    protected onDispose(): void {
        this.model = undefined;
        this.breadcrumb = undefined;
        this.actions = undefined;
        this.footer = undefined;
        this.body = undefined;
        this.pageView = undefined;
    }
}
