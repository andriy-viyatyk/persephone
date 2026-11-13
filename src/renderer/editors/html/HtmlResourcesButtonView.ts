import { pages } from "../../api/pages";
import { ui } from "../../api/ui";
import { toFileUrl } from "../../content/link-utils";
import { fpDirname } from "../../core/utils/file-path";
import { extractHtmlResources } from "../../core/utils/html-resources";
import { t } from "../../../shared/i18n/t";
import type { TextFileModel } from "../content-host/TextFileModel";
import type { IconButtonProps } from "../../uikit/IconButton/IconButtonView";
import { ToggledIconButton } from "../../uikit/shared/toggled-icon-button";
import { VanillaView } from "../../uikit/shared/vanilla-view";

export class HtmlResourcesButtonView extends VanillaView<{ host: TextFileModel }> {
    private readonly host: TextFileModel;
    private readonly button: ToggledIconButton;

    public constructor(props: { host: TextFileModel }) {
        super(props, document.createElement("span"));
        this.host = props.host;
        this.button = new ToggledIconButton(this.root, (button) => this.child(button), (button) => this.releaseChild(button));
    }

    protected onMount(): void {
        this.root.dataset.part = "text-show-resources";
        this.root.style.display = "contents";
        this.bind(this.host.state, (state) => state.language, () => this.sync());
    }

    protected onDispose(): void {
        this.button.dispose();
    }

    private sync(): void {
        const buttonProps: IconButtonProps = {
            name: "text-show-resources",
            size: "sm",
            title: t("editors.showResources"),
            icon: "web-scraper",
            onClick: () => { void this.showResources(); },
        };
        this.button.sync(this.host.state.get().language === "html", buttonProps);
    }

    private async showResources(): Promise<void> {
        const { content, filePath, title } = this.host.state.get();
        const baseUrl = filePath ? toFileUrl(`${fpDirname(filePath)}/`) : undefined;
        const links = extractHtmlResources(content, { baseUrl });
        if (links.length === 0) {
            ui.notify(t("editors.noResourcesFoundInHtml"), "info");
            return;
        }
        pages.lifecycle.openLinks(links, (title || "HTML") + " — Resources");
    }
}
