import { t } from "../../../shared/i18n/t";
import { pages } from "../../api/pages";
import { HtmlEditor } from "./HtmlEditor";
import { HtmlBodyView } from "./HtmlBodyView";
import { TextEditorPageView } from "../base/TextEditorPageView";
import { ImageActionsToolbarView, type ImageToolbarItem } from "../shared/ImageActionsToolbarView";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import type { IconButtonProps } from "../../uikit/IconButton/IconButtonView";

const MENU_CLOSE_DELAY_MS = 250;

function htmlItems(model: HtmlEditor): ReadonlyArray<ImageToolbarItem> {
    const browserButtonProps: IconButtonProps = {
        name: "html-open-in-browser",
        size: "sm",
        title: t("editors.openInBrowserTitle"),
        icon: "globe",
        hidden: model.browserUrl() === undefined,
        onClick: () => {
            const url = model.browserUrl();
            if (url) void pages.openUrlInBrowserTab(url);
        },
    };
    return [
        { kind: "action", action: "copy" },
        { kind: "control", key: "open-in-browser", props: browserButtonProps },
        {
            kind: "menu",
            buttonName: "html-more",
            menuName: "html-image-menu",
            title: t("editors.moreImageActions"),
            icon: "more-vert",
            entries: [
                { kind: "action", action: "save-as-png" },
                { kind: "action", action: "open-in-image-view" },
                { kind: "action", action: "edit-image" },
            ],
        },
    ];
}

class HtmlToolbarBitsView extends VanillaView<{ model: HtmlEditor; items: ReadonlyArray<ImageToolbarItem> }> {
    private model: HtmlEditor;
    private readonly toolbar: ImageActionsToolbarView;
    private stateSubscription: (() => void) | undefined;
    private pipeSubscription: (() => void) | undefined;

    public constructor(props: { model: HtmlEditor; items: ReadonlyArray<ImageToolbarItem> }) {
        const toolbar = new ImageActionsToolbarView({
            model: props.model,
            items: props.items,
            namePrefix: "html-",
            menuActionDelayMs: MENU_CLOSE_DELAY_MS,
        });
        super(props, toolbar.root);
        this.model = props.model;
        this.toolbar = this.child(toolbar);
    }

    protected onMount(): void {
        this.toolbar.mount();
        this.bindModel();
    }

    protected onUpdate(props: { model: HtmlEditor; items: ReadonlyArray<ImageToolbarItem> }): void {
        if (props.model !== this.model) {
            this.model = props.model;
            this.bindModel();
        }
        this.toolbar.update({ model: this.model, items: props.items, namePrefix: "html-", menuActionDelayMs: MENU_CLOSE_DELAY_MS });
    }

    protected onDispose(): void {
        this.stateSubscription?.();
        this.pipeSubscription?.();
    }

    private bindModel(): void {
        this.stateSubscription?.();
        this.stateSubscription = this.model.state.subscribe(() => this.sync());
        this.pipeSubscription?.();
        this.pipeSubscription = this.model.host?.pipeState.subscribe(() => this.sync());
    }

    private sync(): void {
        this.toolbar.update({ model: this.model, items: htmlItems(this.model), namePrefix: "html-", menuActionDelayMs: MENU_CLOSE_DELAY_MS });
    }
}

export class HtmlEditorView extends VanillaView<{ model: HtmlEditor }> {
    private readonly body: HtmlBodyView;
    private readonly toolbar: HtmlToolbarBitsView;
    private readonly pageView: TextEditorPageView<HtmlEditor>;
    private model: HtmlEditor;

    public constructor(props: { model: HtmlEditor }) {
        const body = new HtmlBodyView({ model: props.model });
        const toolbar = new HtmlToolbarBitsView({ model: props.model, items: htmlItems(props.model) });
        const pageView = new TextEditorPageView({
            model: props.model,
            createParts: () => ({ body: body.root, rightToolbar: toolbar.root }),
        });
        super(props, pageView.root);
        this.body = this.child(body);
        this.toolbar = this.child(toolbar);
        this.pageView = this.child(pageView);
        this.model = props.model;
    }

    protected onMount(): void {
        this.body.mount();
        this.toolbar.mount();
        this.pageView.mount();
    }

    protected onUpdate(props: { model: HtmlEditor }): void {
        this.pageView.update({ model: props.model, createParts: () => ({ body: this.body.root, rightToolbar: this.toolbar.root }) });
        this.body.update(props);
        this.toolbar.update({ model: props.model, items: htmlItems(props.model) });
    }
}
