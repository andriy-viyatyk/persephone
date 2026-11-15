import { pages } from "../../api/pages";
import type { PageModel } from "../../api/pages/PageModel";
import { EditorId } from "../../../shared/editor-ids";
import { t } from "../../../shared/i18n/t";
import { IconButtonView } from "../../uikit/IconButton/IconButtonView";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import { pageHistoryControls } from "../../api/internal/PageHistoryControls";
import "./PageHistoryButtons.css";

function createButtonsRoot(): HTMLElement {
    const root = document.createElement("div");
    root.dataset.name = "page-history-buttons";
    return root;
}

type HistoryDirection = "back" | "forward";

export class PageHistoryButtonsView extends VanillaView<Record<string, never>> {
    private page: PageModel | undefined;
    private pageSubscription: (() => void) | undefined;
    private readonly goBack = (): void => pageHistoryControls.go("back");
    private readonly goForward = (): void => pageHistoryControls.go("forward");
    private readonly backButton = this.child(new IconButtonView({
        name: "page-history-back",
        size: "sm",
        icon: "arrow-left",
        "aria-label": t("shell.pageHistoryBackEmpty"),
        title: t("shell.pageHistoryBackEmpty"),
        onClick: this.goBack,
    }));
    private readonly forwardButton = this.child(new IconButtonView({
        name: "page-history-forward",
        size: "sm",
        icon: "arrow-right",
        "aria-label": t("shell.pageHistoryForwardEmpty"),
        title: t("shell.pageHistoryForwardEmpty"),
        onClick: this.goForward,
    }));

    public constructor() {
        super({}, createButtonsRoot());
    }

    protected onMount(): void {
        this.root.append(this.backButton.root, this.forwardButton.root);
        this.backButton.mount();
        this.forwardButton.mount();
        this.ownSubscription(pages.state.subscribe(() => this.sync()));
        this.sync();
        this.own(() => {
            this.pageSubscription?.();
            this.pageSubscription = undefined;
            this.page = undefined;
        });
    }

    protected onDispose(): void {
        this.pageSubscription?.();
        this.pageSubscription = undefined;
        this.page = undefined;
    }

    private sync(): void {
        if (this.isDisposed) return;
        const page = pages.query.activePage;
        if (page !== this.page) {
            this.pageSubscription?.();
            this.page = page;
            this.pageSubscription = page
                ? this.ownSubscription(page.state.subscribe(() => this.sync()))
                : undefined;
        }

        const isBrowser = page?.mainEditor?.editorId === EditorId.browserView;
        const snapshot = page?.history.snapshot();
        this.syncButton("back", !!page && !isBrowser && !!snapshot?.back.length, snapshot?.back.at(-1)?.title);
        this.syncButton("forward", !!page && !isBrowser && !!snapshot?.forward.length, snapshot?.forward.at(-1)?.title);
    }

    private syncButton(direction: HistoryDirection, enabled: boolean, title?: string): void {
        const back = direction === "back";
        const label = back
            ? title
                ? t("shell.pageHistoryBack", { title })
                : t("shell.pageHistoryBackEmpty")
            : title
                ? t("shell.pageHistoryForward", { title })
                : t("shell.pageHistoryForwardEmpty");
        const button = back ? this.backButton : this.forwardButton;
        button.update({
            name: back ? "page-history-back" : "page-history-forward",
            size: "sm",
            icon: back ? "arrow-left" : "arrow-right",
            disabled: !enabled,
            "aria-label": label,
            title: label,
            onClick: back ? this.goBack : this.goForward,
        });
    }
}
