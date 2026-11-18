import { app } from "electron";
import { isTestInstance } from "./instance-options";

/**
 * Comma-separated certificate fingerprints, in Electron's `sha256/<base64>` form, that a test
 * instance accepts despite a certificate error. The UI suite sets it for its self-signed HTTPS
 * fixture server (`integration-test/lib/tls/`).
 */
export const TEST_TRUSTED_CERTIFICATES_ENV = "PERSEPHONE_TEST_TRUSTED_CERTIFICATES";

/**
 * In a test instance (`--test-instance`) only, accept a certificate error for a certificate whose
 * exact fingerprint is listed in {@link TEST_TRUSTED_CERTIFICATES_ENV}. Every other certificate
 * error keeps Chromium's default rejection, and an ordinary app never installs the handler.
 */
export function installTestCertificateTrust(): void {
    if (!isTestInstance()) return;
    const trusted = new Set((process.env[TEST_TRUSTED_CERTIFICATES_ENV] ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter((value) => value.startsWith("sha256/")));
    if (trusted.size === 0) return;
    app.on("certificate-error", (event, _webContents, _url, _error, certificate, callback) => {
        if (!trusted.has(certificate.fingerprint)) return;
        event.preventDefault();
        callback(true);
    });
}
