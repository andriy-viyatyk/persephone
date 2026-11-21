import { USER_ACTIVATION_WINDOW_MS } from "../../shared/browser-navigation-policy";

/**
 * Recent user activation of one browser guest: a mouse press/release or key press inside the page.
 * Page actions Chrome gates on a gesture (opening a tab or window, a repeated download, handing a URL to
 * the host) consume it, so one gesture allows one such action.
 */
export class UserActivation {
    private at = 0;

    note(): void {
        this.at = Date.now();
    }

    isActive(): boolean {
        return Date.now() - this.at <= USER_ACTIVATION_WINDOW_MS;
    }

    consume(): boolean {
        const active = this.isActive();
        this.at = 0;
        return active;
    }
}
