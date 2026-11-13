import { createContentsElement } from "../../uikit/shared/create-contents-element";
import { t } from "../../../shared/i18n/t";
import { MermaidEditor, type MermaidEditorState } from "./MermaidEditor";
import { MermaidBodyView } from "./MermaidBodyView";
import { TextEditorPageView } from "../base/TextEditorPageView";
import { ImageActionsToolbarView, type ImageToolbarItem } from "../shared/ImageActionsToolbarView";
import { DrawOrangeIcon } from "../../theme/language-icons";
import { createIconComponentElement } from "../../theme/icons";
import type { IconButtonProps } from "../../uikit/IconButton/IconButtonView";
import { notifyEditCapabilityFailure } from "../../api/capability-feedback";
import { VanillaView } from "../../uikit/shared/vanilla-view";

function mermaidItems(model: MermaidEditor, state: MermaidEditorState): ReadonlyArray<ImageToolbarItem> {
    const themeButtonProps: IconButtonProps = {
        name: "mermaid-theme",
        size: "sm",
        title: state.lightMode ? t("editors.switchToDarkTheme") : t("editors.switchToLightTheme"),
        onClick: model.toggleLightMode,
        icon: state.lightMode ? "moon" : "sun",
    };
    const convertButtonProps: IconButtonProps = {
        name: "mermaid-convert-excalidraw",
        size: "sm",
        title: t("editors.convertToExcalidraw"),
        disabled: !state.svgUrl,
        onClick: () => {
            void model.convertToExcalidraw().catch((error: unknown) => {
                notifyEditCapabilityFailure(error, "diagram.edit", "Failed to convert Mermaid diagram");
            });
        },
        icon: createIconComponentElement(DrawOrangeIcon),
    };
    return [
        { kind: "control", key: "theme", props: themeButtonProps },
        { kind: "action", action: "draw" },
        { kind: "control", key: "convert-excalidraw", props: convertButtonProps },
        { kind: "action", action: "save" },
        { kind: "action", action: "copy" },
    ];
}

class MermaidToolbarBitsView extends VanillaView<{ model: MermaidEditor; items: ReadonlyArray<ImageToolbarItem> }> {
    private readonly toolbar: ImageActionsToolbarView;
    private model: MermaidEditor;
    private stateSubscription: (() => void) | undefined;

    public constructor(props: { model: MermaidEditor; items: ReadonlyArray<ImageToolbarItem> }) {
        const toolbar = new ImageActionsToolbarView({ model: props.model, items: props.items, namePrefix: "mermaid-" });
        super(props, toolbar.root);
        this.model = props.model;
        this.toolbar = this.child(toolbar);
    }

    protected onMount(): void {
        this.toolbar.mount();
        this.bindModel();
    }

    protected onUpdate(props: { model: MermaidEditor; items: ReadonlyArray<ImageToolbarItem> }): void {
        if (props.model !== this.model) {
            this.model = props.model;
            this.bindModel();
        }
        this.toolbar.update({ model: this.model, items: props.items, namePrefix: "mermaid-" });
    }

    protected onDispose(): void {
        this.stateSubscription?.();
    }

    private bindModel(): void {
        this.stateSubscription?.();
        this.stateSubscription = this.model.state.subscribe(() => {
            this.toolbar.update({ model: this.model, items: mermaidItems(this.model, this.model.state.get()), namePrefix: "mermaid-" });
        });
    }
}

export class MermaidEditorView extends VanillaView<{ model: MermaidEditor }> {
    private model: MermaidEditor | undefined;
    private body: MermaidBodyView | undefined;
    private toolbar: MermaidToolbarBitsView | undefined;
    private pageView: TextEditorPageView<MermaidEditor> | undefined;

    public constructor(props: { model: MermaidEditor }) {
        super(props, createContentsElement());
    }

    protected onMount(): void {
        const model = this.props.model;
        this.model = model;
        const body = this.child(new MermaidBodyView({ model }));
        const toolbar = this.child(new MermaidToolbarBitsView({ model, items: mermaidItems(model, model.state.get()) }));
        const pageView = this.child(new TextEditorPageView({
            model,
            createParts: () => ({ body: body.root, rightToolbar: toolbar.root }),
        }));
        this.body = body;
        this.toolbar = toolbar;
        this.pageView = pageView;
        this.root.append(body.root, toolbar.root, pageView.root);
        body.mount();
        toolbar.mount();
        pageView.mount();
    }

    protected onUpdate(props: { model: MermaidEditor }): void {
        const model = props.model;
        const body = this.body;
        const toolbar = this.toolbar;
        const pageView = this.pageView;
        if (!body || !toolbar || !pageView) return;
        pageView.update({ model, createParts: () => ({ body: body.root, rightToolbar: toolbar.root }) });
        this.model = model;
        body.update({ model });
        toolbar.update({ model, items: mermaidItems(model, model.state.get()) });
    }

    protected onDispose(): void {
        this.model = undefined;
        this.body = undefined;
        this.toolbar = undefined;
        this.pageView = undefined;
    }
}
