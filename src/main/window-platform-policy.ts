import { isLinux } from "../shared/platform";

/** Window behavior that must account for Linux compositor restrictions. */
export const windowPlatformPolicy = {
    waitForReadyToShow: !isLinux,
    useWindowPosition: !isLinux,
    saveWindowPosition: !isLinux,
};
