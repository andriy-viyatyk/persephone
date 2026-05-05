import styled from "@emotion/styled";
import color from "../../theme/color";
import { Panel } from "../Panel";
import { Spinner } from "../Spinner";
import { Text } from "../Text";
import { progressState } from "./progressModel";

const HEADER_HEIGHT = 32;
const SYSTEM_BUTTONS_WIDTH = 130;

const Root = styled.div(
    {
        position: "absolute",
        inset: 0,
        zIndex: 200,
        pointerEvents: "none",
    },
    { label: "ProgressOverlay" },
);

const HeaderBlock = styled.div({
    position: "absolute",
    top: 0,
    left: 0,
    right: SYSTEM_BUTTONS_WIDTH,
    height: HEADER_HEIGHT,
    backgroundColor: color.background.overlay,
    pointerEvents: "auto",
    WebkitAppRegion: "drag",
});

const ContentBlock = styled.div({
    position: "absolute",
    top: HEADER_HEIGHT,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: color.background.overlay,
    pointerEvents: "auto",
});

const PillSlot = styled.div<{ topPx: number; clickable?: boolean }>(
    ({ topPx, clickable }) => ({
        position: "absolute",
        top: topPx,
        left: "50%",
        transform: "translateX(-50%)",
        pointerEvents: clickable ? "auto" : undefined,
    }),
);

type Mode = "notification" | "progress" | "locked";

export function ProgressOverlay() {
    const state = progressState.use();
    const hasNotifications = state.notifications.length > 0;
    const hasProgress = state.items.length > 0;
    const hasLocks = state.locks.length > 0;

    if (hasNotifications) {
        const item = state.notifications[0];
        return (
            <Root key={item.id} data-type="progress-overlay" data-mode="notification">
                <PillSlot topPx={HEADER_HEIGHT + 20}>
                    <Panel
                        align="center"
                        background="dark"
                        rounded="lg"
                        shadow
                        paddingX="xl"
                        paddingY="md"
                    >
                        <Text>{item.label}</Text>
                    </Panel>
                </PillSlot>
            </Root>
        );
    }

    if (hasProgress || hasLocks) {
        const mode: Mode = hasProgress ? "progress" : "locked";
        const item = hasProgress ? state.items[0] : null;
        return (
            <Root data-type="progress-overlay" data-mode={mode}>
                <HeaderBlock />
                <ContentBlock />
                {item && (
                    <PillSlot topPx={HEADER_HEIGHT + 40} clickable>
                        <Panel
                            direction="row"
                            align="center"
                            gap="lg"
                            background="dark"
                            rounded="lg"
                            shadow
                            paddingX="xl"
                            paddingY="lg"
                        >
                            <Spinner size={18} />
                            <Text>{item.label}</Text>
                        </Panel>
                    </PillSlot>
                )}
            </Root>
        );
    }

    return null;
}
