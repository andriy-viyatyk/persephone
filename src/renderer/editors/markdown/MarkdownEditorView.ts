import { createContentsElement } from "../../uikit/shared/create-contents-element";
import { t } from "../../../shared/i18n/t";
import { MarkdownEditor } from "./MarkdownEditor";
import { MarkdownBodyView } from "./MarkdownBodyView";
import { TextEditorPageView } from "../base/TextEditorPageView";
import { ButtonView, type ButtonViewProps } from "../../uikit/Button/ButtonView";
import { IconButtonView, type IconButtonViewProps } from "../../uikit/IconButton/IconButtonView";
import { VanillaView } from "../../uikit/shared/vanilla-view";



class MarkdownToolbarBitsView extends VanillaView<{ model: MarkdownEditor }> {
    private model: MarkdownEditor;
    private button: IconButtonView | undefined;
    private stateSubscription: (() => void) | undefined;

    public constructor(props: { model: MarkdownEditor }) {
        super(props, createContentsElement());
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

    protected onUpdate(props: { model: MarkdownEditor }): void {
        if (props.model !== this.model) {
            this.model = props.model;
            this.bindState();
        }
        this.sync(this.model.state.get().compactMode);
    }

    protected onDispose(): void {
        this.button = undefined;
    }

    private bindState(): void {
        this.stateSubscription?.();
        this.stateSubscription = this.model.state.subscribe<boolean>(
            (compactMode) => this.sync(compactMode),
            (state) => state.compactMode,
        );
    }

    private sync(compactMode: boolean): void {
        this.button?.update(this.buttonProps(compactMode));
    }

    private buttonProps(compactMode = this.model.state.get().compactMode): IconButtonViewProps {
        return {
            name: "markdown-compact-toggle",
            size: "sm",
            active: compactMode,
            title: compactMode ? "Normal View" : "Compact View",
            icon: compactMode ? "normal-view" : "compact-view",
            onClick: this.model.toggleCompact,
        };
    }
}

class MarkdownBackButtonView extends VanillaView<{ model: MarkdownEditor }> {
    private model: MarkdownEditor;
    private button: ButtonView | undefined;
    private boundPage: MarkdownEditor["page"] = null;
    private pageSubscription: (() => void) | undefined;

    public constructor(props: { model: MarkdownEditor }) {
        super(props, createContentsElement());
        this.model = props.model;
    }

    protected onMount(): void {
        this.bindPageState();
        this.own(() => {
            this.pageSubscription?.();
            this.pageSubscription = undefined;
        });
    }

    protected onUpdate(props: { model: MarkdownEditor }): void {
        this.model = props.model;
        this.bindPageState();
    }

    protected onDispose(): void {
        this.button = undefined;
        this.boundPage = null;
    }

    private bindPageState(): void {
        const page = this.model.page;
        if (page !== this.boundPage) {
            this.pageSubscription?.();
            this.pageSubscription = undefined;
            this.boundPage = page;
            if (page) {
                this.pageSubscription = page.state.subscribe<number>(
                    (navBackCount) => this.sync(navBackCount),
                    (state) => state.navBackCount,
                );
            }
        }
        this.sync(page?.state.get().navBackCount ?? 0);
    }

    private sync(navBackCount: number): void {
        if (navBackCount <= 0) {
            if (this.button) {
                this.releaseChild(this.button);
                this.button = undefined;
            }
            return;
        }

        const props: ButtonViewProps = {
            name: "markdown-back",
            variant: "ghost",
            size: "sm",
            title: t("editors.back"),
            icon: "arrow-left",
            onClick: () => { void this.model.navigateBack(); },
            children: t("editors.back"),
        };
        if (!this.button) {
            this.button = this.child(new ButtonView(props));
            this.root.append(this.button.root);
            this.button.mount();
        } else {
            this.button.update(props);
        }
    }
}

export class MarkdownEditorView extends VanillaView<{ model: MarkdownEditor }> {
    private readonly body: MarkdownBodyView;
    private readonly backButton: MarkdownBackButtonView;
    private readonly toolbar: MarkdownToolbarBitsView;
    private readonly pageView: TextEditorPageView<MarkdownEditor>;
    private model: MarkdownEditor;

    public constructor(props: { model: MarkdownEditor }) {
        const model = props.model;
        const body = new MarkdownBodyView({ model });
        const backButton = new MarkdownBackButtonView({ model });
        const toolbar = new MarkdownToolbarBitsView({ model });
        const pageView = new TextEditorPageView({
            model: props.model,
            createParts: () => ({ body: body.root, toolbar: backButton.root, rightToolbar: toolbar.root }),
        });
        super(props, pageView.root);
        this.model = model;
        this.body = this.child(body);
        this.backButton = this.child(backButton);
        this.toolbar = this.child(toolbar);
        this.pageView = this.child(pageView);
    }

    protected onMount(): void {
        this.body.mount();
        this.backButton.mount();
        this.toolbar.mount();
        this.pageView.mount();
    }

    protected onUpdate(props: { model: MarkdownEditor }): void {
        const model = props.model;
        this.pageView.update({ model, createParts: () => ({ body: this.body.root, toolbar: this.backButton.root, rightToolbar: this.toolbar.root }) });
    }
}
