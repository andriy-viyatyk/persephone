import { isCapabilityErrorCode, type CapabilityErrorCode } from "../../shared/capability-constants";
import { toCodedError, type CodedError } from "../../shared/coded-error";

/** A typed failure from a capability invocation. */
export class CapabilityError extends Error implements CodedError<CapabilityErrorCode> {
    readonly name = "CapabilityError";
    readonly cause?: unknown;

    constructor(
        readonly code: CapabilityErrorCode,
        message: string,
        readonly requestId?: string,
        cause?: unknown,
    ) {
        super(message);
        this.cause = cause;
    }
}

export function noHandlerError(id: string, version?: number): CapabilityError {
    const suffix = version === undefined ? "" : ` at version ${version}`;
    return new CapabilityError("no-handler", `No capability handler matches "${id}"${suffix}.`);
}

export function toCapabilityError(error: unknown, fallbackMessage: string): CapabilityError {
    if (error instanceof CapabilityError) return error;
    const coded = toCodedError<CapabilityErrorCode>(error, "rejected", { accepts: isCapabilityErrorCode, fallbackMessage });
    return new CapabilityError(coded.code, coded.message, undefined, error);
}
