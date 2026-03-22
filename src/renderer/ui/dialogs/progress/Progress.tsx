import styled from "@emotion/styled";
import color from "../../../theme/color";
import { CircularProgress } from "../../../components/basic/CircularProgress";
import { progressState } from "./ProgressModel";

const HEADER_HEIGHT = 32;
const SYSTEM_BUTTONS_WIDTH = 130;

const ProgressRoot = styled.div({
    position: "absolute",
    left: 0, top: 0, right: 0, bottom: 0,
    zIndex: 200,
    pointerEvents: "none",
    "& .header-block": {
        position: "absolute",
        left: 0, top: 0,
        right: SYSTEM_BUTTONS_WIDTH,
        height: HEADER_HEIGHT,
        backgroundColor: color.background.overlay,
        pointerEvents: "auto",
        WebkitAppRegion: "drag",
    },
    "& .content-block": {
        position: "absolute",
        left: 0, top: HEADER_HEIGHT,
        right: 0, bottom: 0,
        backgroundColor: color.background.overlay,
        pointerEvents: "auto",
    },
    "& .progress-item": {
        position: "absolute",
        top: HEADER_HEIGHT + 40,
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        alignItems: "center",
        gap: 10,
        backgroundColor: color.background.dark,
        color: color.text.default,
        borderRadius: 6,
        padding: "10px 16px",
        boxShadow: `0 4px 12px ${color.shadow.default}`,
        fontSize: 13,
        pointerEvents: "auto",
    },
    "& .notification-item": {
        position: "absolute",
        top: HEADER_HEIGHT + 20,
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        alignItems: "center",
        backgroundColor: color.background.dark,
        color: color.text.default,
        borderRadius: 6,
        padding: "8px 14px",
        boxShadow: `0 4px 12px ${color.shadow.default}`,
        fontSize: 13,
    },
});

export function Progress() {
    const state = progressState.use();
    const hasProgress = state.items.length > 0;
    const hasLocks = state.locks.length > 0;
    const hasNotifications = state.notifications.length > 0;

    // Notifications (no overlay, just centered message)
    if (hasNotifications) {
        const item = state.notifications[0];
        return (
            <ProgressRoot key={item.id}>
                <div className="notification-item">{item.label}</div>
            </ProgressRoot>
        );
    }

    // Progress or screen lock (blocking overlay)
    if (hasProgress || hasLocks) {
        const item = hasProgress ? state.items[0] : null;
        return (
            <ProgressRoot>
                <div className="header-block" />
                <div className="content-block" />
                {item && (
                    <div className="progress-item">
                        <CircularProgress size={18} />
                        {item.label}
                    </div>
                )}
            </ProgressRoot>
        );
    }

    return null;
}
