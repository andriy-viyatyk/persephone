import { t } from "../../../shared/i18n/t";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import { createIconElement } from "../../uikit/shared/slots";
import { urlDisplayParts } from "./url-display";

interface BrowserUrlDisplayProps {
    /** The URL bar's text (already without userinfo). */
    url: string;
}

/**
 * The unfocused URL bar's rendering (passed to the field as `InputView`'s `display`): scheme and path
 * dimmed, the host in the normal text colour. The path gives way first, and a host too long for the
 * bar is cut on the left, so the registrable end of the host (`…example.com`) is always on screen.
 */
export class BrowserUrlDisplayView extends VanillaView<BrowserUrlDisplayProps> {
    private readonly scheme = document.createElement("span");
    private readonly host = document.createElement("span");
    private readonly hostText = document.createElement("bdi");
    private readonly rest = document.createElement("span");

    public constructor(props: BrowserUrlDisplayProps) {
        super(props, document.createElement("span"));
        this.root.dataset.urlDisplay = "";
        this.scheme.dataset.urlScheme = "";
        this.host.dataset.urlHost = "";
        this.rest.dataset.urlRest = "";
        this.host.append(this.hostText);
        this.root.append(this.scheme, this.host, this.rest);
    }

    protected onMount(): void { this.sync(); }
    protected onUpdate(): void { this.sync(); }

    /** Whether the URL has a formatted rendering (only `http(s):` URLs do). */
    static supports(url: string): boolean { return urlDisplayParts(url) !== undefined; }

    private sync(): void {
        const parts = urlDisplayParts(this.props.url);
        this.scheme.textContent = parts?.scheme ?? "";
        this.hostText.textContent = parts?.host ?? "";
        this.rest.textContent = parts?.rest ?? "";
    }
}

/** The "Not secure" marker shown at the start of the URL bar for a plain-`http:` page. */
export function createNotSecureChip(): HTMLSpanElement {
    const chip = document.createElement("span");
    chip.dataset.notSecureChip = "";
    chip.dataset.name = "url-not-secure";
    chip.title = t("browser.notSecureTitle");
    const label = document.createElement("span");
    label.textContent = t("browser.notSecure");
    chip.append(createIconElement("warning"), label);
    return chip;
}
