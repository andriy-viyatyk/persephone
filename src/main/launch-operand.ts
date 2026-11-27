import { fileURLToPath } from "node:url";

/** Convert a local file URL to a path while leaving ordinary path operands unchanged. */
export function launchOperandToLocalPath(operand: string): string | undefined {
    if (!/^file:/i.test(operand)) return operand;

    try {
        return fileURLToPath(new URL(operand));
    } catch {
        return undefined;
    }
}
