import { alertsBarModel } from "../../../uikit/Notification/AlertsBar";
import { listAlerts, countAlerts, closeAlert, closeAllAlerts } from "../../../api/ui";
import type { IAlert, NotificationType } from "../../../api/types/ui";
import {
    choiceRule,
    numberRule,
    validateCallArguments,
    type IAiMember,
    type IAiVisionDescriptor,
} from "ai-vision";

const ALERT_TYPES: readonly NotificationType[] = ["info", "success", "warning", "error"];

const LIST_ARGUMENTS = [] as const;
const TYPE_ARGUMENTS = [
    choiceRule("type", ALERT_TYPES, 'ui.alerts.count("error")', { required: false }),
] as const;
const CLOSE_ARGUMENTS = [
    numberRule("key", "ui.alerts.close(1)"),
] as const;

const ALERTS_MEMBERS: readonly IAiMember[] = [
    { name: "list", kind: "method", signature: "list()", summary: "Read every held toast in insertion order, including whether it is currently visible." },
    { name: "count", kind: "method", signature: "count(type?: NotificationType)", summary: "Count held toasts, optionally filtered by severity." },
    { name: "close", kind: "method", signature: "close(key: number)", summary: "Dismiss one toast by key and settle its pending notify promise.", caution: "dismisses a visible user notification" },
    { name: "closeAll", kind: "method", signature: "closeAll(type?: NotificationType)", summary: "Dismiss all held toasts, optionally filtered by severity.", caution: "dismisses user notifications and may settle pending notify promises" },
];

export class AlertsNode {
    list(...args: unknown[]): IAlert[] {
        validateCallArguments("ui.alerts.list", args, LIST_ARGUMENTS, { maxArgs: 0 });
        return listAlerts();
    }

    count(...args: unknown[]): number {
        const [type] = validateCallArguments("ui.alerts.count", args, TYPE_ARGUMENTS, { maxArgs: 1 });
        return countAlerts(type);
    }

    close(...args: unknown[]): boolean {
        const [key] = validateCallArguments("ui.alerts.close", args, CLOSE_ARGUMENTS, { maxArgs: 1 });
        return closeAlert(key);
    }

    closeAll(...args: unknown[]): number {
        const [type] = validateCallArguments("ui.alerts.closeAll", args, TYPE_ARGUMENTS, { maxArgs: 1 });
        return closeAllAlerts(type);
    }

    get aiVision(): IAiVisionDescriptor {
        return ALERTS_DESCRIPTOR;
    }
}

export const ALERTS_DESCRIPTOR: IAiVisionDescriptor = {
    kind: "UiAlerts",
    summary: "Toast notifications held by this renderer window, including read and dismiss actions.",
    members: ALERTS_MEMBERS,
    help: "Use ui.alerts.list() after an action that may have reported a failure, and before concluding that the operation succeeded. list() returns every held alert in insertion order; visible is true only for the first three currently rendered toasts, and createdAt identifies when each alert was raised. Use count(\"error\") to check for failures without reading messages. Use close(key) or closeAll(type?) only when serving the user's explicit intent to clear notifications, such as errors caused by the action you just took; closing an alert also resolves the promise returned by ui.notify(). Alerts are scoped to this renderer window.",
    summarize: () => ({ kind: "UiAlerts", count: alertsBarModel.state.get().alerts.length }),
};

export const alertsNode = new AlertsNode();
