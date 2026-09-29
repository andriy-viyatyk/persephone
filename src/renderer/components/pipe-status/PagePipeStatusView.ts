import { createComponentModelDriver, type ComponentModelDriver } from "../../core/state/model";
import color from "../../theme/color";
import { PopoverView, type PopoverViewProps } from "../../uikit/Popover/PopoverView";
import { ProgressBarView } from "../../uikit/ProgressBar/ProgressBarView";
import { SpinnerView } from "../../uikit/Spinner/SpinnerView";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import { initialPagePipeStatusState, PagePipeStatusModel, type PagePipeStatusProps, type PagePipeStatusState } from "./PagePipeStatusModel";
import { PipeStageListView } from "./PipeStageListView";
import "../../uikit/Popover/Popover.css";
import "../../uikit/ProgressBar/ProgressBar.css";
import "../../uikit/Spinner/Spinner.css";
import "./PagePipeStatusView.css";

export class PagePipeStatusView extends VanillaView<PagePipeStatusProps> {
    private readonly driver: ComponentModelDriver<PagePipeStatusState, PagePipeStatusProps, PagePipeStatusModel>;
    private readonly content = document.createElement("div");
    private readonly trigger = document.createElement("button");
    private readonly label = document.createElement("span");
    private readonly dismiss = document.createElement("button");
    private readonly spinner = this.child(new SpinnerView({ size: 14, color: color.icon.default }));
    private readonly progress = this.child(new ProgressBarView({ height: 2, "aria-label": "Content loading progress" }));
    private readonly popover: PopoverView;
    private stageList: PipeStageListView | undefined;
    private popoverOpen = false;

    public constructor(props: PagePipeStatusProps) {
        super(props, document.createElement("div"));
        this.root.dataset.type = "page-pipe-status";
        this.root.dataset.name = "page-pipe-status-root";
        this.trigger.type = "button";
        this.trigger.dataset.type = "page-pipe-status-trigger";
        this.trigger.dataset.name = "page-pipe-status";
        this.trigger.setAttribute("aria-haspopup", "dialog");
        this.label.dataset.part = "label";
        this.content.dataset.part = "content";
        this.dismiss.type = "button";
        this.dismiss.dataset.part = "dismiss";
        this.dismiss.setAttribute("aria-label", "Dismiss pipe error");
        this.dismiss.textContent = "×";
        this.popover = this.child(new PopoverView(this.popoverProps(false)));
        this.driver = createComponentModelDriver(props, PagePipeStatusModel, initialPagePipeStatusState);
        this.own(() => this.driver.dispose());
    }

    protected onMount(): void {
        this.trigger.append(this.spinner.root, this.label);
        this.content.append(this.trigger, this.progress.root, this.dismiss);
        this.root.append(this.content, this.popover.root);
        this.spinner.mount();
        this.progress.mount();
        this.popover.mount();
        this.driver.mount();
        this.ownSubscription(this.driver.model.state.subscribe(
            this.renderState,
            (state) => state,
        ));
        this.listen(this.trigger, "click", this.togglePopover);
        this.listen(this.dismiss, "click", (event) => {
            event.stopPropagation();
            this.driver.model.dismissError();
        });
        this.renderState(this.driver.model.state.get());
    }

    protected onUpdate(props: PagePipeStatusProps): void {
        this.driver.update(props);
    }

    private readonly renderState = (state: PagePipeStatusState): void => {
        if (this.isDisposed) return;
        this.root.hidden = !state.visible;
        this.root.dataset.status = state.summary?.state ?? "idle";
        this.root.dataset.state = this.popoverOpen ? "open" : "closed";
        this.label.textContent = state.label;
        this.spinner.root.hidden = state.kind !== "busy";
        this.progress.root.hidden = state.kind !== "busy";
        this.dismiss.hidden = state.kind !== "error";
        this.trigger.setAttribute("aria-label", `Pipe status: ${state.label}`);
        this.progress.update({
            name: "page-pipe-status-progress",
            height: 2,
            value: state.hasProgress ? state.loaded : undefined,
            max: state.hasProgress ? state.total : undefined,
            "aria-label": "Content loading progress",
        });
        this.stageList?.update({ stages: state.stages, density: "compact" });
        this.popover.update(this.popoverProps(this.popoverOpen));
    };

    private readonly togglePopover = (): void => {
        if (!this.driver.model.state.get().stages.length) return;
        this.popoverOpen = !this.popoverOpen;
        this.popover.setOpen(this.popoverOpen);
        this.root.dataset.state = this.popoverOpen ? "open" : "closed";
    };

    private popoverProps(open: boolean): PopoverViewProps {
        return {
            open,
            name: "page-pipe-status-popover",
            "data-type": "page-pipe-status-popover",
            "data-page-id": this.props.page.id,
            elementRef: this.trigger,
            placement: "bottom-end",
            offset: [0, 4],
            onClose: () => {
                this.stageList = undefined;
                this.popoverOpen = false;
                this.popover.setOpen(false);
                this.root.dataset.state = "closed";
            },
            contentView: (host) => {
                const view = new PipeStageListView({
                    stages: this.driver.model.state.get().stages,
                    density: "compact",
                });
                this.stageList = view;
                host.append(view.root);
                return view;
            },
        };
    }
}
