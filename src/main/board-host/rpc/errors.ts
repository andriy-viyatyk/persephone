import { errMessage } from "../../../shared/utils";

export class BoardRpcError extends Error {
    public constructor(readonly code: string, message: string) {
        super(message);
        this.name = "BoardRpcError";
    }
}

export function asBoardRpcError(error: unknown): unknown {
    if (error instanceof BoardRpcError) return error;
    const code = (error as { code?: unknown } | null)?.code;
    return typeof code === "string" ? new BoardRpcError(code, errMessage(error)) : error;
}

export function fileAccessError(error: unknown): BoardRpcError {
    const existingCode = (error as { code?: unknown } | null)?.code;
    if (typeof existingCode === "string") return new BoardRpcError(existingCode, errMessage(error));
    const code = errMessage(error).startsWith("permission-denied:")
        ? "permission-denied"
        : existingCode === "ENOENT" ? "not-found" : "io-error";
    return new BoardRpcError(code, errMessage(error));
}
