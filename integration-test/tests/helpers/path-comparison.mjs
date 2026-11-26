import { isWindows } from "../../../src/shared/platform.ts";

export function comparablePath(value) {
    return isWindows
        ? value.replace(/[\\/]+/g, "\\").toLowerCase()
        : value;
}

export function samePath(left, right) {
    if (typeof left !== "string" || typeof right !== "string") return false;
    const comparableLeft = comparablePath(left);
    const comparableRight = comparablePath(right);
    return isWindows
        ? comparableLeft.replace(/\\+$/, "") === comparableRight.replace(/\\+$/, "")
        : comparableLeft === comparableRight;
}
