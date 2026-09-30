// Windows single sign-on for Microsoft work and school accounts (US-1581).
//
// On an Entra-joined device, Conditional Access can require proof that the sign-in comes from
// that device. Edge, Chrome and Firefox get it from Windows (IProofOfPossessionCookieInfoManager)
// and send it with requests to the Microsoft sign-in origins. Persephone gets it through the
// `sso-cookies` subcommand of persephone-snip.exe (snip-tool/src/sso_cookies.rs) and adds it in
// the network logger's request hook, the only onBeforeSendHeaders listener a session can have.
//
// The returned values are credentials: they are never logged, cached, stored or sent to the
// renderer, and the request log records the headers with them removed.

import { spawn } from "child_process";
import type { Session } from "electron";
import { getSnipToolPath } from "./snip-service";

/** Exact origins that receive the proof — Chromium's defaults for its Windows SSO provider. */
const SSO_ORIGINS = new Set(["https://login.microsoftonline.com", "https://login.live.com"]);

/** Longest a request waits for Windows before it goes out without the proof. */
const SSO_TIMEOUT_MS = 3000;

let enabled = false;

/** Session → whether it belongs to a normal (saved) browser profile. */
const eligibleSessions = new WeakMap<Session, boolean>();

interface SsoCookie {
    name: string;
    data: string;
}

/** Set from the renderer's `browser.windows-sso` setting. */
export function setWindowsSsoEnabled(value: boolean): void {
    enabled = value === true;
}

/**
 * Only browser profile sessions (`persist:browser-<profile>`) qualify. Incognito and Tor
 * partitions are in-memory, and the app's own sessions live elsewhere, so both are excluded
 * by the session itself rather than by anything a page reports.
 */
function isEligibleSession(ses: Session): boolean {
    let eligible = eligibleSessions.get(ses);
    if (eligible === undefined) {
        const storage = ses.isPersistent() ? ses.getStoragePath() : null;
        eligible = !!storage && /[\\/]Partitions[\\/]browser-[^\\/]+[\\/]?$/i.test(storage);
        eligibleSessions.set(ses, eligible);
    }
    return eligible;
}

/** Whether this request should carry the Windows sign-in proof. */
export function wantsWindowsSso(ses: Session, url: string, resourceType: string): boolean {
    if (!enabled || process.platform !== "win32") return false;
    // Sign-in happens in page and frame navigations; its scripts and XHRs do not need the proof.
    if (resourceType !== "mainFrame" && resourceType !== "subFrame") return false;
    let origin: string;
    try {
        origin = new URL(url).origin;
    } catch {
        return false;
    }
    return SSO_ORIGINS.has(origin) && isEligibleSession(ses);
}

/** Ask Windows for the proof for `url`. Resolves to no cookies on any failure or timeout. */
function getSsoCookies(url: string): Promise<SsoCookie[]> {
    return new Promise((resolve) => {
        let settled = false;
        const finish = (cookies: SsoCookie[]) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(cookies);
        };

        let child: ReturnType<typeof spawn>;
        try {
            child = spawn(getSnipToolPath(), ["sso-cookies", url], {
                stdio: ["ignore", "pipe", "ignore"],
                windowsHide: true,
            });
        } catch {
            resolve([]);
            return;
        }
        const timer = setTimeout(() => {
            child.kill();
            finish([]);
        }, SSO_TIMEOUT_MS);

        const chunks: Buffer[] = [];
        child.stdout?.on("data", (chunk: Buffer) => { chunks.push(chunk); });
        child.on("error", () => finish([]));
        child.on("close", (code) => {
            if (code !== 0) {
                finish([]);
                return;
            }
            try {
                const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
                const cookies = Array.isArray(parsed?.cookies) ? parsed.cookies : [];
                finish(cookies.filter((c: SsoCookie) =>
                    typeof c?.name === "string" && c.name && typeof c.data === "string"));
            } catch {
                finish([]);
            }
        });
    });
}

/** Header names this module may add, lower-cased; used to redact the request log. */
const injectedHeaders = new WeakMap<Record<string, string>, { headers: string[]; cookies: string[] }>();

/**
 * Return `headers` with the Windows sign-in proof added, as Chromium does: every `x-ms-*`
 * item becomes its own header (value without cookie attributes), anything else joins the
 * Cookie header.
 */
export async function addWindowsSsoHeaders(
    url: string,
    headers: Record<string, string>,
): Promise<Record<string, string>> {
    const cookies = await getSsoCookies(url);
    if (!cookies.length) return headers;

    const result = { ...headers };
    const added = { headers: [] as string[], cookies: [] as string[] };
    const extraCookies: string[] = [];
    for (const { name, data } of cookies) {
        const value = data.split(";")[0].trim();
        if (name.toLowerCase().startsWith("x-ms-")) {
            result[name] = value;
            added.headers.push(name.toLowerCase());
        } else {
            extraCookies.push(`${name}=${value}`);
            added.cookies.push(name);
        }
    }
    if (extraCookies.length) {
        const cookieKey = Object.keys(result).find(k => k.toLowerCase() === "cookie") ?? "Cookie";
        result[cookieKey] = [result[cookieKey], ...extraCookies].filter(Boolean).join("; ");
    }
    injectedHeaders.set(result, added);
    return result;
}

/** A copy of `headers` safe to record: the Windows sign-in proof removed. */
export function redactWindowsSsoHeaders(headers: Record<string, string>): Record<string, string> {
    const added = injectedHeaders.get(headers);
    if (!added) return { ...headers };
    const copy: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
        const lower = key.toLowerCase();
        if (added.headers.includes(lower)) continue;
        if (lower === "cookie" && added.cookies.length) {
            const kept = value.split(/;\s*/).filter(pair => !added.cookies.includes(pair.split("=")[0]));
            if (kept.length) copy[key] = kept.join("; ");
            continue;
        }
        copy[key] = value;
    }
    return copy;
}
