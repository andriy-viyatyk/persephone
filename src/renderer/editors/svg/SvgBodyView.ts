import { ImageViewportView } from "../../uikit/ImageViewport/ImageViewportView";
import type { ImageViewportProps } from "../../uikit/ImageViewport/ImageViewportView";
import {
    createPanelElement,
    type PanelStyleProps,
} from "../../uikit/Panel/panel-style";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import type { SvgEditor } from "./SvgEditor";

export interface SvgBodyViewProps {
    model: SvgEditor;

}

function rootPanelProps(): PanelStyleProps {
    return {
        name: "svg-root",
        direction: "column",
        flex: true,
        height: 0,
    };
}

function viewportProps(model: SvgEditor, content: string): ImageViewportProps {
    return {
        src: `data:image/svg+xml,${encodeURIComponent(content)}`,
        alt: "SVG Preview",
        onCopyToClipboard: (blob) => model.imageActions.copy(blob),
    };
}

export class SvgBodyView extends VanillaView<SvgBodyViewProps> {
    private model: SvgEditor;
    private viewport!: ImageViewportView;
    private hostSubscription: (() => void) | undefined;
    private boundModel: SvgEditor | undefined;
    private boundHost: SvgEditor["host"] = null;
    private queueSubscription: (() => void) | undefined;

    public constructor(props: SvgBodyViewProps) {
        super(props, createPanelElement(rootPanelProps()));
        this.model = props.model;
    }

    protected onMount(): void {
        this.model = this.props.model;
        const content = this.model.host?.state.get().content ?? "";
        this.viewport = this.child(new ImageViewportView(
            viewportProps(this.model, content),
        ));
        this.root.append(this.viewport.root);
        this.viewport.mount();
        this.bindToHostIfNeeded();
        this.queueSubscription = this.ownSubscription(this.model.queue.subscribe(() => {
            // Deliberate no-op: drain the focus queue to keep its lifecycle clean.
        }));
    }

    protected onUpdate(props: SvgBodyViewProps): void {

        const modelChanged = this.model !== props.model;
        if (modelChanged) {
            this.queueSubscription?.();
            this.queueSubscription = undefined;
            this.model = props.model;
            this.queueSubscription = this.ownSubscription(this.model.queue.subscribe(() => {
                // Deliberate no-op: drain the focus queue to keep its lifecycle clean.
            }));
        }

        this.bindToHostIfNeeded();
        this.viewport.update(
            viewportProps(this.model, this.model.host?.state.get().content ?? ""),
        );
    }

    private bindToHostIfNeeded(): void {
        const host = this.model.host;
        if (this.model === this.boundModel && host === this.boundHost && this.hostSubscription) return;

        this.hostSubscription?.();
        this.hostSubscription = undefined;
        this.boundModel = this.model;
        this.boundHost = host;
        if (!host) return;

        this.hostSubscription = this.ownSubscription(host.state.subscribe(
            (content: string) => {
                this.viewport.update(viewportProps(this.model, content));
            },
            (state) => state.content,
        ));
    }
}
