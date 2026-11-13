import type { LaunchInput } from "../shared/launch-input";
import { launchOperands, parseLaunchArguments } from "./utils";

let startupInputs: LaunchInput[] = parseLaunchInputs(process.argv, process.cwd());
let boardStartupInput: Extract<LaunchInput, { kind: "board" }> | undefined;
startupInputs = startupInputs.filter((input) => {
    if (input.kind !== "board") return true;
    boardStartupInput ??= input;
    return false;
});

export function parseLaunchInputs(commandLine: string[], workingDirectory: string): LaunchInput[] {
    return parseLaunchArguments(launchOperands(commandLine), workingDirectory);
}

export function takeBoardStartupInput(): Extract<LaunchInput, { kind: "board" }> | undefined {
    const input = boardStartupInput;
    boardStartupInput = undefined;
    return input;
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
