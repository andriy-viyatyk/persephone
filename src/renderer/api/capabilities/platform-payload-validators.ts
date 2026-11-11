import type { CapabilityId } from "../types/capabilities";
import { validateCertificateViewPayload } from "../certificate-view";
import { validateThemeEditPayload } from "../theme-edit";

/** The one place a platform capability's payload shape is checked, keyed by bare capability id. */
export const PLATFORM_PAYLOAD_VALIDATORS: Readonly<Record<string, (payload: unknown) => void>> = {
    "certificate.view": validateCertificateViewPayload,
    "theme.edit": validateThemeEditPayload,
};

export function validatePlatformPayload(bareId: string, payload: unknown): void {
    if (Object.hasOwn(PLATFORM_PAYLOAD_VALIDATORS, bareId)) PLATFORM_PAYLOAD_VALIDATORS[bareId](payload);
}

export function payloadRecord(payload: unknown, capability: CapabilityId): Record<string, unknown> {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new TypeError(`${capability} expects an object payload.`);
    }
    return payload as Record<string, unknown>;
}

export function payloadString(
    values: Record<string, unknown>,
    key: string,
    capability: CapabilityId,
): string {
    const value = values[key];
    if (typeof value !== "string") {
        throw new TypeError(`${capability} expects a string ${key}.`);
    }
    return value;
}

export function contentViewRepresentation(payload: unknown): string {
    const values = payloadRecord(payload, "content.view");
    const representation = values.representation;
    if (typeof representation !== "string" || !representation.trim()) {
        throw new TypeError("content.view expects a non-empty string representation.");
    }
    return representation;
}
