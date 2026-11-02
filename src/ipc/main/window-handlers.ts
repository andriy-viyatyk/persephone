import { BrowserWindow } from "electron";
import { openWindows } from "../../main/open-windows";
import { launchOperands, parseLaunchArguments } from "../../main/utils";
import type { LaunchInput } from "../../shared/launch-input";

let startupInputs: LaunchInput[] = parseLaunchArguments(launchOperands(process.argv), process.cwd());
let boardStartupInput: Extract<LaunchInput, { kind: "board" }> | undefined;
startupInputs = startupInputs.filter((input) => {
    if (input.kind !== "board") return true;
    boardStartupInput ??= input;
    return false;
});

export function takeBoardStartupInput(): Extract<LaunchInput, { kind: "board" }> | undefined {
    const input = boardStartupInput;
    boardStartupInput = undefined;
    return input;
}

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

export function takeStartupInputsForMain(): LaunchInput[] {
    const inputs = startupInputs;
    startupInputs = [];
    return inputs;
}
