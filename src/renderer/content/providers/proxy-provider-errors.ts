import type { ProviderOperation, ProviderResult, ProviderWireErrorCode } from "../../../ipc/module-service-channels";
import { ProviderUnavailableError, providerDeclarationFor } from "../registry";

/** A provider operation failed or returned a result that violated its contract. */
export class ProviderOperationError extends Error {
    constructor(readonly code: ProviderWireErrorCode, message: string) {
        super(message);
        this.name = "ProviderOperationError";
    }
}

export function providerResultError(result: ProviderResult): ProviderOperationError | undefined {
    if (result.ok !== false) return undefined;
    return new ProviderOperationError(result.error.code, result.error.message);
}

export function invalidProviderResult(operation: ProviderOperation | string): ProviderOperationError {
    return new ProviderOperationError(
        "provider-invalid-result",
        `Provider operation "${operation}" returned a malformed result.`,
    );
}

export function providerUnavailableError(type: string, error: unknown): ProviderUnavailableError {
    const unavailable = new ProviderUnavailableError(type, providerDeclarationFor(type));
    unavailable.cause = error;
    return unavailable;
}

export function mapProviderRequestError(type: string, error: unknown): Error {
    return error instanceof ProviderOperationError ? error : providerUnavailableError(type, error);
}
