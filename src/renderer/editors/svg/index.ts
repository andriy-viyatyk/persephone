import { createContentsElement } from "../../uikit/shared/create-contents-element";
import { t } from "../../../shared/i18n/t";
import { TComponentState } from "../../core/state/state";
import { SvgEditor, defaultSvgEditorState } from "./SvgEditor";
import { SvgBodyView } from "./SvgBodyView";
import { TextChromeView } from "../base/TextChromeView";
import { IconButtonView, type IconButtonViewProps } from "../../uikit/IconButton/IconButtonView";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import { DrawIcon } from "../../theme/language-icons";
import { createIconComponentElement } from "../../theme/icons";
import { savePngViaDialog } from "../shared/image-export";
import { defineEditorModule } from "../base/editorRegistry";
import { notifyEditCapabilityFailure } from "../../api/capability-feedback";



interface SvgToolbarBitsViewProps {
    model: SvgEditor;
    copyImage: () => void;
}

class SvgToolbarBitsView extends VanillaView<SvgToolbarBitsViewProps> {
    private model: SvgEditor;
    private copyImage: () => void;
    private openDrawButton: IconButtonView | undefined;
    private saveButton: IconButtonView | undefined;
    private copyButton: IconButtonView | undefined;
    private drawIcon!: SVGElement;

    public constructor(props: SvgToolbarBitsViewProps) {
        super(props, createContentsElement());
        this.model = props.model;
        this.copyImage = props.copyImage;
    }

    protected onMount(): void {
        this.drawIcon = createIconComponentElement(DrawIcon);
        this.openDrawButton = this.child(new IconButtonView(this.openDrawButtonProps()));
        this.saveButton = this.child(new IconButtonView(this.saveButtonProps()));
        this.copyButton = this.child(new IconButtonView(this.copyButtonProps()));
        this.root.append(this.openDrawButton.root, this.saveButton.root, this.copyButton.root);
        this.openDrawButton.mount();
        this.saveButton.mount();
        this.copyButton.mount();
    }

    protected onUpdate(props: SvgToolbarBitsViewProps): void {
        this.model = props.model;
        this.copyImage = props.copyImage;
        this.openDrawButton?.update(this.openDrawButtonProps());
        this.saveButton?.update(this.saveButtonProps());
        this.copyButton?.update(this.copyButtonProps());
    }

    protected onDispose(): void {
        this.openDrawButton = undefined;
        this.saveButton = undefined;
        this.copyButton = undefined;
    }

    private readonly onOpenDraw = async (): Promise<void> => {
        try {
            await this.model.openInDrawingEditor();
        } catch (error) {
            notifyEditCapabilityFailure(error, "image.edit", "Failed to open SVG in Drawing Editor");
        }
    };

    private openDrawButtonProps(): IconButtonViewProps {
        return {
            name: "svg-open-draw",
            size: "sm",
            title: t("editors.openInDrawingEditor"),
            onClick: () => { void this.onOpenDraw(); },
            icon: this.drawIcon,
        };
    }

    private saveButtonProps(): IconButtonViewProps {
        return {
            name: "svg-save",
            size: "sm",
            title: t("editors.saveAsPng"),
            onClick: () => { void savePngViaDialog(this.model); },
            icon: "save",
        };
    }

    private copyButtonProps(): IconButtonViewProps {
        return {
            name: "svg-copy",
            size: "sm",
            title: t("editors.copyImageWithShortcut", { shortcut: "Ctrl+C" }),
            onClick: this.copyImage,
            icon: "copy",
        };
    }
}

export class SvgEditorView extends VanillaView<{ model: SvgEditor }> {
    private readonly body: SvgBodyView;
    private readonly toolbar: SvgToolbarBitsView;
    private readonly chrome: TextChromeView;
    private model: SvgEditor;

    public constructor(props: { model: SvgEditor }) {
        const model = props.model;
        const body = new SvgBodyView({ model });
        const toolbar = new SvgToolbarBitsView({
            model,
            copyImage: body.copyImage,
        });
        const chrome = new TextChromeView({
            model: props.model,
            children: body.root,
            rightToolbarContributions: toolbar.root,
        });
        super(props, chrome.root);
        this.model = model;
        this.body = this.child(body);
        this.toolbar = this.child(toolbar);
        this.chrome = this.child(chrome);
    }

    protected onMount(): void {
        this.body.mount();
        this.toolbar.mount();
        this.chrome.mount();
    }

    protected onUpdate(props: { model: SvgEditor }): void {
        this.model = props.model;
        this.body.update({ model: this.model });
        this.toolbar.update({ model: this.model, copyImage: this.body.copyImage });
        this.chrome.update({
            model: props.model,
            children: this.body.root,
            rightToolbarContributions: this.toolbar.root,
        });
    }
}

export const svgModule = defineEditorModule(SvgEditor, {
    createEditor: () =>
        new SvgEditor(new TComponentState({ ...defaultSvgEditorState })),
    View: SvgEditorView,

});

export { SvgEditor, defaultSvgEditorState };
export type { SvgEditorState, SvgQueueEvent } from "./SvgEditor";
