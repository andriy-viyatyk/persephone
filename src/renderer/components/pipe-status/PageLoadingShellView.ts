import type { IContentPipe } from "../../api/types/io.pipe";
import type { PageModel } from "../../api/pages/PageModel";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import { PipeStageListView } from "./PipeStageListView";
import "./PageLoadingShellView.css";

export interface PageLoadingShellViewProps {
    page: PageModel;
    onCancel: () => void;
    onRetry: () => void;
}

export class PageLoadingShellView extends VanillaView<PageLoadingShellViewProps> {
    private stageList: PipeStageListView | undefined;
    private boundPipe: IContentPipe | null = null;
    private releasePage: (() => void) | undefined;
    private releasePipe: (() => void) | undefined;
    private message: HTMLElement | undefined;
    private cancelButton: HTMLButtonElement | undefined;
    private retryButton: HTMLButtonElement | undefined;

    public constructor(props: PageLoadingShellViewProps) {
        super(props, document.createElement("section"));
        this.root.dataset.type = "page-loading-shell";
        this.root.dataset.name = "page-loading-shell";
        this.root.setAttribute("aria-busy", "true");
    }

    protected onMount(): void {
        this.message = document.createElement("p");
        this.message.dataset.part = "message";
        this.message.setAttribute("aria-live", "polite");
        const actions = document.createElement("div");
        actions.dataset.part = "actions";
        this.cancelButton = document.createElement("button");
        this.cancelButton.type = "button";
        this.cancelButton.dataset.name = "page-loading-cancel";
        this.cancelButton.textContent = "Cancel";
        this.listen(this.cancelButton, "click", () => this.props.onCancel());
        this.retryButton = document.createElement("button");
        this.retryButton.type = "button";
        this.retryButton.dataset.name = "page-loading-retry";
        this.retryButton.textContent = "Retry";
        this.listen(this.retryButton, "click", () => this.props.onRetry());
        actions.append(this.cancelButton, this.retryButton);
        this.root.append(this.message, actions);
        this.releasePage = this.props.page.state.subscribe(() => this.refresh());
        this.own(this.releasePage);
        this.refresh();
    }

    protected onUpdate(props: PageLoadingShellViewProps): void {
        this.releasePage?.();
        this.releasePipe?.();
        this.boundPipe = null;
        this.releasePage = props.page.state.subscribe(() => this.refresh());
        this.refresh();
    }

    protected onDispose(): void {
        this.releasePage?.();
        this.releasePipe?.();
        this.releasePage = undefined;
        this.releasePipe = undefined;
    }

    private refresh(): void {
        const state = this.props.page.state.get();
        const editor = this.props.page.mainEditorInstance;
        const host = editor?.contentHost as unknown as { pipe?: IContentPipe } | null | undefined;
        const pipe = host?.pipe ?? editor?.pipe ?? null;
        if (pipe !== this.boundPipe) {
            this.releasePipe?.();
            this.boundPipe = pipe;
            this.releasePipe = pipe?.onStatusChange(() => this.refresh()) ?? undefined;
        }
        if (!this.message || !this.cancelButton || !this.retryButton) return;
        const isError = state.restoreStatus === "error";
        this.root.dataset.state = isError ? "error" : "loading";
        this.root.setAttribute("aria-busy", String(!isError));
        this.message.textContent = isError
            ? state.restoreError ?? "Unable to load content."
            : "Loading content…";
        this.cancelButton.hidden = isError;
        this.retryButton.hidden = !isError;
        const stages = pipe?.stages ?? [];
        if (!this.stageList) {
            this.stageList = this.child(new PipeStageListView({ stages, density: "expanded" }));
            this.root.append(this.stageList.root);
            this.stageList.mount();
        } else {
            this.stageList.update({ stages, density: "expanded" });
        }
    }
}
