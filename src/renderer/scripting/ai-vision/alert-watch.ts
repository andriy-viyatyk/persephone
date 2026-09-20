import { alertsBarModel } from "../../uikit/Notification/AlertsBar";
import type { AlertData } from "../../uikit/Notification/AlertItem";
import { logAlertRaised } from "./event-log";

/**
 * Push newly raised error/warning toasts into the agent event feed.
 *
 * The subscription lives here rather than in `AlertsBar` on purpose: UIKit is agnostic of the
 * ai-vision layer, and US-1464 established that this layer imports the alerts model and never
 * the reverse. Watching the model also catches every producer — `ui.notify`, the unhandled
 * rejection handler, anything that reaches `addAlert` — instead of only the one entry point a
 * call-site hook would cover.
 */

/** Keys already reported, so a re-render or a dismissal elsewhere never re-announces one. */
const reported = new Set<number>();

export function initAlertEventFeed(): void {
    alertsBarModel.state.subscribe<AlertData[]>((alerts) => {
        const live = new Set<number>();
        for (const alert of alerts) {
            live.add(alert.key);
            if (reported.has(alert.key)) continue;
            reported.add(alert.key);
            if (alert.type === "error" || alert.type === "warning") {
                logAlertRaised(alert.key, alert.type, alert.message);
            }
        }
        // `getAlertId()` wraps at a million, so keys are reused eventually. Forgetting a key once
        // its alert is gone keeps the set bounded and makes a reused key report again, which is
        // correct: it is a different notification.
        for (const key of reported) {
            if (!live.has(key)) reported.delete(key);
        }
    }, (state) => state.alerts);
}
