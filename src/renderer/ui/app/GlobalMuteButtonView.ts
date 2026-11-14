import { globalMuteClient } from "../../api/global-mute";
import type { GlobalMuteSnapshot } from "../../../ipc/global-mute-channels";
import { errMessage } from "../../../shared/utils";
import { t } from "../../../shared/i18n/t";
import { app } from "../../api/app";
import { createIconElement } from "../../uikit/shared/slots";
import { VanillaView } from "../../uikit/shared/vanilla-view";

export class GlobalMuteButtonView extends VanillaView<object> {
    private revision = -1;

    public constructor(props: object) {
        super(props, document.createElement("button"));
        const button = this.root as HTMLButtonElement;
        button.type = "button";
        button.dataset.name = "global-mute";
        button.className = "global-mute-button";
        button.hidden = true;
        button.append(createIconElement("volume-muted"));
    }

    protected onMount(): void {
        this.listen(this.root, "click", () => {
            void globalMuteClient.releaseAll().catch((error: unknown) => app.ui.notify(t("shell.globalMuteReleaseFailed", { error: errMessage(error) }), "error"));
        });
        const applyMute = (snapshot: GlobalMuteSnapshot): void => {
            if (this.isDisposed) return;
            if (snapshot.revision <= this.revision) return;
            this.revision = snapshot.revision;
            const button = this.root as HTMLButtonElement;
            button.hidden = !snapshot.active;
            const holders = snapshot.holders.slice(0, 5).join(", ");
            const title = t("shell.globalMuteTooltip", { holders });
            button.title = title;
            button.setAttribute("aria-label", title);
        };
        this.own(globalMuteClient.subscribe(applyMute));
        void globalMuteClient.snapshot().then(applyMute).catch((error: unknown) => console.error("Failed to read global mute state:", errMessage(error)));
    }
}
