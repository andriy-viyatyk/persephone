import type { IPageHost } from "../../api/pages/IPageHost";
import { pageHistoryControls } from "../../api/internal/PageHistoryControls";
import { t } from "../../../shared/i18n/t";
import { IconButtonView, type IconButtonViewProps } from "../../uikit/IconButton/IconButtonView";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import type { EditorModelInstance as EditorModel } from "./EditorModel";
import "./PageHistoryButtons.css";

export interface PageHistoryButtonsViewProps {
    model: EditorModel;
}

type HistoryDirection = "back" | "forward";

/** Back / Forward for the page that owns this editor toolbar. Hidden on a host with no page
 *  history (an embedded Browser host) and on a Browser page, which keeps its own history. */
export class PageHistoryButtonsView extends VanillaView<PageHistoryButtonsViewProps> {
    private model: EditorModel;
    private page: IPageHost | null = null;
    private pageSubscription: (() => void) | undefined;
    private readonly goBack = (): void => this.go("back");
    private readonly goForward = (): void => this.go("forward");
    private readonly backButton = this.child(new IconButtonView(this.buttonProps("back", false)));
    private readonly forwardButton = this.child(new IconButtonView(this.buttonProps("forward", false)));

    public constructor(props: PageHistoryButtonsViewProps) {
        super(props, document.createElement("span"));
        this.model = props.model;
        this.root.dataset.part = "page-history";
    }

    protected onMount(): void {
        this.root.append(this.backButton.root, this.forwardButton.root);
        this.backButton.mount();
        this.forwardButton.mount();
        this.sync();
    }

    protected onUpdate(props: PageHistoryButtonsViewProps): void {
        this.model = props.model;
        this.sync();
    }

    protected onDispose(): void {
        this.pageSubscription?.();
        this.pageSubscription = undefined;
        this.page = null;
    }

    private go(direction: HistoryDirection): void {
        pageHistoryControls.go(direction, this.model.page ?? undefined);
    }

    private sync(): void {
        if (this.isDisposed) return;
        const page = this.model.page;
        if (page !== this.page) {
            this.pageSubscription?.();
            this.page = page;
            // Page state carries the history counts, so it is the one signal to follow.
            this.pageSubscription = page
                ? this.ownSubscription(page.state.subscribe(() => this.sync()))
                : undefined;
        }

        const history = page?.history;
        const visible = !!page && !!history && pageHistoryControls.isEligiblePage(page);
        this.root.hidden = !visible;
        if (!visible || !history) return;

        const snapshot = history.snapshot();
        this.backButton.update(this.buttonProps("back", history.canGoBack, snapshot.back.at(-1)?.title));
        this.forwardButton.update(this.buttonProps("forward", history.canGoForward, snapshot.forward.at(-1)?.title));
    }

    private buttonProps(direction: HistoryDirection, enabled: boolean, title?: string): IconButtonViewProps {
        const back = direction === "back";
        const label = back
            ? title ? t("shell.pageHistoryBack", { title }) : t("shell.pageHistoryBackEmpty")
            : title ? t("shell.pageHistoryForward", { title }) : t("shell.pageHistoryForwardEmpty");
        return {
            name: back ? "page-history-back" : "page-history-forward",
            size: "sm",
            icon: back ? "arrow-left" : "arrow-right",
            disabled: !enabled,
            "aria-label": label,
            title: label,
            onClick: back ? this.goBack : this.goForward,
        };
    }
}
