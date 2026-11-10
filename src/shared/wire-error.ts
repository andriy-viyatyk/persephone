import { codedError, isCoded } from "./coded-error";
import { errMessage } from "./utils";

/** The one error shape that crosses a private process boundary. Observable error contracts
 *  (MCP JSON-RPC, HTTP status, CapabilityError, board-visible Error + code) are adapted from it
 *  at their boundary, never replaced by it. */
export interface WireError { code: string; message: string }

/** Code of a failure that carries no code of its own. `fromWireError` leaves `.code` unset for it,
 *  so an error that had no code before still has none after the round trip. */
export const WIRE_ERROR_DEFAULT_CODE = "error";

export function wireError(message: string, code: string = WIRE_ERROR_DEFAULT_CODE): WireError {
    return { code, message };
}

/** `code` is taken from a string `e.code`; otherwise `fallbackCode`. `message` is `errMessage(e, fallbackMessage)`. */
export function toWireError(e: unknown, fallbackMessage?: string, fallbackCode: string = WIRE_ERROR_DEFAULT_CODE): WireError {
    const code = isCoded(e) && e.code ? e.code : fallbackCode;
    return { code, message: errMessage(e, fallbackMessage) };
}

/** Tolerates a missing or non-object value (a malformed reply) and a bare string. */
export function fromWireError(value: unknown, fallbackMessage = "Request failed."): Error & { code?: string } {
    const source = value as { code?: unknown; message?: unknown } | string | null | undefined;
    const message = errMessage(source, fallbackMessage);
    const code = typeof source === "object" && source !== null ? source.code : undefined;
    return typeof code === "string" && code && code !== WIRE_ERROR_DEFAULT_CODE
        ? codedError(code, message)
        : new Error(message);
}
