import { BrowserWindow } from "electron";
import { openWindows } from "../../main/open-windows";
import { launchOperands, parseLaunchArguments } from "../../main/utils";
import type { LaunchInput } from "../../shared/launch-input";

let startupInputs: LaunchInput[] = parseLaunchArguments(launchOperands(process.argv), process.cwd());

export async function windowReady(window: BrowserWindow): Promise<void> {
    const openWindow = openWindows.findWindowDataByWindow(window);
    openWindow?.ready?.();
    return;
}

export async function getStartupInputs(): Promise<LaunchInput[]> {
    const inputs = startupInputs;
    startupInputs = [];
    return inputs;
}
