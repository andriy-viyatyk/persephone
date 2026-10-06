import type { CertificateViewPayload } from "./types/capabilities";

const MAX_CERTIFICATE_CHAIN_BYTES = 256 * 1024;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** Validate the platform-owned shape and size contract before any certificate handler runs. */
export function validateCertificateViewPayload(payload: unknown): asserts payload is CertificateViewPayload {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new TypeError("certificate.view expects an object payload.");
    }

    const values = payload as Record<string, unknown>;
    if (typeof values.title !== "string" || !values.title.trim()) {
        throw new TypeError("certificate.view expects a non-empty title.");
    }
    if (!Array.isArray(values.certificates) || values.certificates.length === 0) {
        throw new TypeError("certificate.view expects at least one certificate.");
    }
    if (values.source !== undefined) {
        if (!values.source || typeof values.source !== "object" || Array.isArray(values.source)
            || typeof (values.source as Record<string, unknown>).url !== "string") {
            throw new TypeError("certificate.view expects source.url to be a string when source is provided.");
        }
    }

    let totalBytes = 0;
    for (const certificate of values.certificates) {
        if (typeof certificate !== "string" || certificate.length === 0 || !BASE64_PATTERN.test(certificate)) {
            throw new TypeError("certificate.view expects each certificate to be canonical base64.");
        }
        const der = atob(certificate);
        if (btoa(der) !== certificate) {
            throw new TypeError("certificate.view expects each certificate to be canonical base64.");
        }
        if (der.charCodeAt(0) !== 0x30) {
            throw new TypeError("certificate.view expects each certificate to contain DER data beginning with 0x30.");
        }
        totalBytes += der.length;
        if (totalBytes > MAX_CERTIFICATE_CHAIN_BYTES) {
            throw new TypeError("certificate.view certificate chain exceeds the 256 KiB decoded size limit.");
        }
    }
}

/** Convert leaf-first base64 DER certificates to a PEM bundle with 64-column lines. */
export function certificatesToPem(certificates: readonly string[]): string {
    return certificates.map((certificate) => {
        const lines = certificate.match(/.{1,64}/g) ?? [];
        return ["-----BEGIN CERTIFICATE-----", ...lines, "-----END CERTIFICATE-----"].join("\n");
    }).join("\n");
}
