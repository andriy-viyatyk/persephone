import { capabilities } from "../../api/capabilities/CapabilitiesClient";
import { CapabilityError } from "../../api/capability-error";
import { notifyEditCapabilityFailure, openImageForEdit } from "../../api/capability-feedback";
import { ui } from "../../api/ui";
import { t } from "../../../shared/i18n/t";
import { errMessage } from "../../../shared/utils";
import type { ILinkAction, ILinkData } from "../../../shared/link-data";

export async function invokeCapabilityAction(
    _data: ILinkData,
    action: Extract<ILinkAction, { kind: "capability" }>,
): Promise<void> {
    if (action.id === "image.edit") {
        try {
            await openImageForEdit(action.payload);
        } catch (error) {
            notifyEditCapabilityFailure(error, "image.edit", t("api.failedToOpenImageForEditing"));
        }
        return;
    }

    try {
        await capabilities.invoke("http.request.open", action.payload, { version: 1 });
    } catch (error: unknown) {
        if (error instanceof CapabilityError && error.code === "no-handler") {
            ui.notify(t("api.noRestClientRegistered"), "warning");
        } else {
            ui.notify(t("api.failedToOpenRequestInRestClient", { error: errMessage(error) }), "error");
        }
    }
}
