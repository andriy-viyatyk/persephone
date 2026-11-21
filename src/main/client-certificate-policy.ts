/**
 * TLS client-certificate selection.
 *
 * When a server asks for a client certificate and the app does not answer,
 * Electron silently sends the first matching certificate from the Windows
 * store. A personal or smart-card certificate is a strong identifier, so a Tor,
 * Incognito or proxied page must never send one: those sessions get no
 * certificate. Persistent, direct sessions (the normal browser profiles, the
 * app session) keep Electron's choice, which certificate sign-in on managed
 * machines relies on — an origin-named picker for them is a recorded follow-up
 * (US-2142, Deferred).
 */
import { app, session, type WebContents } from "electron";
import { appPartition } from "./constants";
import { browserNetworkService } from "./browser-network-service";
import { torService } from "./tor-service";

/** True when `contents` may use Electron's default certificate selection. */
function allowsDefaultSelection(contents: WebContents | null): boolean {
    if (!contents || contents.isDestroyed()) return false;
    const ses = contents.session;
    if (torService.isTorSession(ses) || browserNetworkService.isProxiedSession(ses)) return false;
    // In-memory sessions are Incognito and Tor pages (and their popups). The app
    // window's own session is in-memory too, but is not a web page.
    return ses.isPersistent() || ses === session.fromPartition(appPartition);
}

/** Register the policy. Call once during main-process setup, before `ready`. */
export function installClientCertificatePolicy(): void {
    app.on("select-client-certificate", (event, webContents, _url, _list, callback) => {
        if (allowsDefaultSelection(webContents)) return;
        event.preventDefault();
        callback();
    });
}
