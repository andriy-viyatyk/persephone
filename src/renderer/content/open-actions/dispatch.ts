import type { ILinkAction, ILinkData } from "../../../shared/link-data";
import { openBrowserAction } from "./browser";
import { invokeCapabilityAction } from "./capability";
import { openFolderPageAction } from "./folder-page";
import { showNoticeAction } from "./notice";

type OpenAction = Exclude<ILinkAction, { kind: "content" }>;
type OpenActionKind = OpenAction["kind"];
type OpenActionExecutors = {
    [Kind in OpenActionKind]: (
        data: ILinkData,
        action: Extract<OpenAction, { kind: Kind }>,
    ) => Promise<void>;
};

const actionExecutors: OpenActionExecutors = {
    browser: openBrowserAction,
    "folder-page": openFolderPageAction,
    capability: invokeCapabilityAction,
    notice: showNoticeAction,
};

/** Clear untrusted input, run one pipeline step, then execute only its recorded action. */
export async function runOpenStep(
    data: ILinkData,
    step: () => Promise<void>,
): Promise<void> {
    data.action = undefined;
    await step();
    await dispatchOpenAction(data);
}

/** Consume and execute a non-content result once. */
export async function dispatchOpenAction(data: ILinkData): Promise<void> {
    const action = data.action;
    data.action = undefined;
    if (!action || action.kind === "content") return;
    switch (action.kind) {
        case "browser":
            await actionExecutors.browser(data, action);
            break;
        case "folder-page":
            await actionExecutors["folder-page"](data, action);
            break;
        case "capability":
            await actionExecutors.capability(data, action);
            break;
        case "notice":
            await actionExecutors.notice(data, action);
            break;
    }
    data.handled = true;
}
