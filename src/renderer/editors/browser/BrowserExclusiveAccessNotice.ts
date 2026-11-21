import { t } from "../../../shared/i18n/t";
import { VanillaView } from "../../uikit/shared/vanilla-view";

/** How long the notice stays up after a page enters fullscreen or locks the pointer (Chrome's
 *  exit bubble is up for a similar few seconds). */
const EXCLUSIVE_ACCESS_NOTICE_MS = 4000;

export type ExclusiveAccessKind = "fullscreen" | "pointer-lock";

/**
 * The host's notice when a page takes the whole screen or hides the mouse pointer: it names the page's
 * origin and the Esc key, so a full-screen page cannot pass off fake Persephone chrome or a fake
 * system prompt as real. Drawn by the host above the webview and ignores the mouse.
 *
 * In HTML fullscreen the `<webview>` element itself is the host document's fullscreen element, so it sits
 * in the top layer, above any z-index; the notice then joins the top layer as a manual popover, added
 * after the webview and so drawn over it.
 */
export class BrowserExclusiveAccessNotice extends VanillaView<Record<string, never>> {
    private hideTimer: ReturnType<typeof setTimeout> | undefined;

    public constructor() {
        super({}, document.createElement("div"));
        this.root.dataset.exclusiveAccessNotice = "";
        this.root.dataset.name = "browser-exclusive-access-notice";
        this.root.setAttribute("role", "status");
        this.root.hidden = true;
        this.own(() => clearTimeout(this.hideTimer));
    }

    protected onMount(): void {
        this.listen(document, "fullscreenchange", this.restack);
    }

    show(kind: ExclusiveAccessKind, origin: string): void {
        this.root.dataset.kind = kind;
        const name = origin || t("browser.exclusiveAccessThisPage");
        this.root.textContent = kind === "fullscreen"
            ? t("browser.fullscreenNotice", { origin: name })
            : t("browser.pointerLockNotice", { origin: name });
        this.root.hidden = false;
        this.restack();
        clearTimeout(this.hideTimer);
        this.hideTimer = setTimeout(() => this.hide(), EXCLUSIVE_ACCESS_NOTICE_MS);
    }

    /** Hide the notice; with `kind`, only when it is the one showing. */
    hide(kind?: ExclusiveAccessKind): void {
        if (kind && this.root.dataset.kind !== kind) return;
        clearTimeout(this.hideTimer);
        this.hideTimer = undefined;
        this.root.hidden = true;
        this.restack();
    }

    /** Over a fullscreen element only the top layer is visible: join it while shown and fullscreen. */
    private readonly restack = (): void => {
        const onTop = !this.root.hidden && !!document.fullscreenElement;
        if (this.root.matches(":popover-open")) this.root.hidePopover();
        if (!onTop) { this.root.removeAttribute("popover"); return; }
        this.root.popover = "manual";
        this.root.showPopover();
    };
}
