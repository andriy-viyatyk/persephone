import { createPanelElement } from "../../uikit/Panel/panel-style";
import type { MenuItem } from "../../uikit/Menu/types";
import { t } from "../../../shared/i18n/t";
import { ImageActionsToolbarView, type ImageToolbarItem } from "../shared/ImageActionsToolbarView";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import type { ImageEditor } from "./ImageEditor";

export interface ImageToolbarViewProps {
    model: ImageEditor;
    copyImage: () => void;
}
function imageItems(model: ImageEditor): ReadonlyArray<ImageToolbarItem> {
    const saveOriginalMenuItem: MenuItem = {
        id: "save-original",
        label: t("editors.saveOriginal"),
        onClick: () => { void model.saveOriginal(); },
    };
    return [
        {
            kind: "menu",
            buttonName: "image-save",
            menuName: "image-save-menu",
            title: t("editors.saveImageEllipsis"),
            icon: "save",
            entries: [
                { kind: "action", action: "save-as-png" },
                { kind: "entry", key: "save-original", item: saveOriginalMenuItem },
            ],
        },
        { kind: "action", action: "draw" },
        { kind: "action", action: "copy" },
    ];
}
export class ImageToolbarView extends VanillaView<ImageToolbarViewProps> {
    private model: ImageEditor;
    private readonly toolbar: ImageActionsToolbarView;
    private stateSubscription: (() => void) | undefined;

    public constructor(props: ImageToolbarViewProps) {
        const toolbar = new ImageActionsToolbarView({
            model: props.model,
            items: imageItems(props.model),
            namePrefix: "image-",
            onCopyToClipboard: props.copyImage,
        }, createPanelElement({ direction: "row", align: "center", gap: "sm" }));
        super(props, toolbar.root);
        this.model = props.model;
        this.toolbar = this.child(toolbar);
    }
    protected onMount(): void {
        this.toolbar.mount();
        this.bindState();
    }
    protected onUpdate(props: ImageToolbarViewProps): void {
        const modelChanged = this.model !== props.model;
        this.model = props.model;
        this.toolbar.update({
            model: props.model,
            items: imageItems(props.model),
            namePrefix: "image-",
            onCopyToClipboard: props.copyImage,
        });
        if (modelChanged) this.bindState();
    }
    protected onDispose(): void {
        this.stateSubscription?.();
    }
    private bindState(): void {
        this.stateSubscription?.();
        this.stateSubscription = this.model.state.subscribe(() => {
            this.toolbar.update({
                model: this.model,
                items: imageItems(this.model),
                namePrefix: "image-",
                onCopyToClipboard: this.props.copyImage,
            });
        }, (state) => state.url);
    }
}
