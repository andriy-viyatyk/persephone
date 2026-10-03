/**
 * Per-profile browser network (US-1557).
 *
 * A browser profile's persistent partition (`persist:browser-<name>`) may be
 * put behind a SOCKS5/HTTP proxy. Electron does not persist `setProxy`, and the
 * partition is shared by every page of the profile in every window, so the
 * renderer applies the profile's network before each page mounts and this
 * service makes that idempotent.
 *
 * It also owns everything else that must follow a proxied (or Tor) session:
 *
 *  - `profile-src://<token>/?u=<url>` — app-rendered remote resources (the Link
 *    editor on a browser page's blank tab, the tab-strip favicons) fetched
 *    through the profile session. Same shape and guards as `tor-src://`, but
 *    the host is an opaque main-issued token, because a partition name such as
 *    `persist:browser-My Profile` is not a valid URL host.
 *  - the guest WebRTC policy, set when the guest webContents is created;
 *  - one-URL `session-src` handles for resources opened out of such a page.
 */
import { randomBytes } from "node:crypto";
import { app, session, webContents } from "electron";
import type { Session, WebContents } from "electron";
import {
    BrowserNetworkChannel,
    PROFILE_SRC_SCHEME,
    proxyRulesFor,
    validateProxyEndpoint,
} from "../ipc/browser-network-ipc";
import type { BrowserNetwork, BrowserNetworkApplyResult, EgressIpInfo } from "../ipc/browser-network-ipc";
import { applySessionProxy, lookupGeo, setSessionDirect } from "./session-proxy";
import { guardedIpcHandle } from "./ipc-sender-guard";
import { registerSessionSource } from "./session-src-protocol";
import { torService } from "./tor-service";
import { errMessage } from "../shared/utils";

/**
 * Shapes produced by `getPartitionString` for a profile page and an Incognito
 * page. Never matches Tor (`browser-tor-…`) or the app session.
 */
const PROFILE_PARTITION_RE = /^(?:persist:browser-.+|browser-incognito-[0-9a-f-]+)$/;
const TOKEN_RE = /^[a-f0-9]{32}$/;

/** Cap on the egress IP lookup, so an unreachable proxy cannot hang the dialog. */
const LOOKUP_TIMEOUT_MS = 20_000;
/** Keyless IP echo, used when no geo provider reports the address. */
const IP_ECHO_URL = "https://api.ipify.org?format=json";

interface ProxiedPartition {
    readonly rules: string;
    readonly token: string;
    /** Settles when `setProxy` has taken effect; concurrent callers await it too. */
    readonly ready: Promise<void>;
}

class BrowserNetworkService {
    private readonly proxied = new Map<string, ProxiedPartition>();
    private readonly partitionByToken = new Map<string, string>();

    async apply(partition: string, network: BrowserNetwork): Promise<BrowserNetworkApplyResult> {
        if (!PROFILE_PARTITION_RE.test(partition)) {
            throw new Error(`Not a browser profile partition: ${partition}`);
        }
        const ses = session.fromPartition(partition);
        const current = this.proxied.get(partition);

        if (network.kind === "direct") {
            // A partition this run never proxied is direct already (Electron starts direct).
            if (!current) return {};
            this.forget(partition, current);
            await setSessionDirect(ses);
            this.setGuestWebRtcPolicy(ses, false);
            return {};
        }

        const endpointError = validateProxyEndpoint(network.host, network.port);
        if (endpointError) throw new Error(endpointError);
        const rules = proxyRulesFor(network);

        // A second page of the same profile — join the first apply, never mount early.
        if (current?.rules === rules) {
            await current.ready;
            return { token: current.token };
        }

        if (current) this.forget(partition, current);
        const token = randomBytes(16).toString("hex");
        const ready = applySessionProxy(ses, rules);
        const entry: ProxiedPartition = { rules, token, ready };
        this.proxied.set(partition, entry);
        this.partitionByToken.set(token, partition);
        try {
            await ready;
        } catch (err) {
            if (this.proxied.get(partition) === entry) this.forget(partition, entry);
            throw err;
        }
        this.setGuestWebRtcPolicy(ses, true);
        return { token };
    }

    /** Drop an Incognito page's entry when the page closes; its session dies with it. */
    release(partition: string): void {
        if (!partition.startsWith("browser-incognito-")) return;
        const entry = this.proxied.get(partition);
        if (entry) this.forget(partition, entry);
    }

    /** True when `ses` is a browser profile session currently behind a proxy. */
    isProxiedSession(ses: Session): boolean {
        for (const partition of this.proxied.keys()) {
            if (session.fromPartition(partition) === ses) return true;
        }
        return false;
    }

    async checkIp(partition: string): Promise<EgressIpInfo> {
        if (!this.proxied.has(partition)) {
            return { ip: "", error: "This page is not using a proxy." };
        }
        const ses = session.fromPartition(partition);
        const info: EgressIpInfo = { ip: "" };

        const geo = await lookupGeo(ses);
        if (geo) Object.assign(info, geo);
        if (!info.ip) {
            try {
                const res = await ses.fetch(IP_ECHO_URL, {
                    cache: "no-store",
                    signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
                });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json() as { ip?: unknown };
                if (typeof data.ip === "string") info.ip = data.ip;
            } catch (err) {
                info.error = `Could not reach the network through the proxy: ${errMessage(err)}`;
            }
        }
        if (!info.ip && !info.error) info.error = "Could not determine the egress IP address.";
        return info;
    }

    /** One-URL `session-src` handle for a proxied profile or live Tor page, else undefined. */
    sessionSource(partition: string, url: string): string | undefined {
        if (!/^https?:$/.test(safeProtocol(url))) return undefined;
        if (this.proxied.has(partition)) {
            return registerSessionSource(session.fromPartition(partition), url, undefined, true);
        }
        if (torService.isActiveTorPartition(partition)) {
            return registerSessionSource(session.fromPartition(partition), url, partition, true);
        }
        return undefined;
    }

    /** Proxied partition behind a `profile-src` token, or undefined when revoked/unknown. */
    partitionForToken(token: string): string | undefined {
        if (!TOKEN_RE.test(token)) return undefined;
        return this.partitionByToken.get(token);
    }

    /**
     * Guests of proxied/Tor sessions must not reveal local or public addresses
     * over non-proxied UDP. Called for each new webview guest before its first
     * navigation — the proxy is armed before the page mounts, so the session
     * is already known to be routed.
     */
    handleWebContentsCreated = (contents: WebContents): void => {
        if (contents.getType() !== "webview") return;
        if (this.isProxiedSession(contents.session) || torService.isTorSession(contents.session)) {
            contents.setWebRTCIPHandlingPolicy("disable_non_proxied_udp");
        }
    };

    /** Re-apply the WebRTC policy to guests that already exist when a profile's route changes. */
    private setGuestWebRtcPolicy(ses: Session, proxied: boolean): void {
        for (const contents of webContents.getAllWebContents()) {
            if (contents.getType() !== "webview" || contents.session !== ses) continue;
            contents.setWebRTCIPHandlingPolicy(proxied ? "disable_non_proxied_udp" : "default");
        }
    }

    private forget(partition: string, entry: ProxiedPartition): void {
        this.proxied.delete(partition);
        this.partitionByToken.delete(entry.token);
    }
}

export const browserNetworkService = new BrowserNetworkService();

// ── profile-src:// ─────────────────────────────────────────────────────────

/** Register the handler on the app renderer's session. Call once at startup. */
export function registerProfileSrcProtocol(partition: string): void {
    session.fromPartition(partition).protocol.handle(PROFILE_SRC_SCHEME, handleProfileSrc);
}

async function handleProfileSrc(request: Request): Promise<Response> {
    let token: string;
    let target: string | null;
    try {
        const parsed = new URL(request.url);
        token = parsed.host;
        // `?u=` rather than a path segment, as in `tor-src://` — Chromium may
        // rewrite percent-escapes in standard-scheme paths.
        target = parsed.searchParams.get("u");
    } catch {
        return new Response("Malformed profile-src URL", { status: 400 });
    }
    if (!target) return new Response("Missing 'u' target parameter", { status: 400 });

    // The token is the capability: it exists only while its profile is proxied,
    // so a stale tile fails instead of loading over another route.
    const partition = browserNetworkService.partitionForToken(token);
    if (!partition) return new Response("No proxied profile for this token", { status: 403 });
    if (!/^https?:$/.test(safeProtocol(target))) {
        return new Response("Only http(s) targets are allowed", { status: 403 });
    }

    let upstream: Response;
    try {
        upstream = await session.fromPartition(partition).fetch(target);
    } catch (err) {
        return new Response(`Profile fetch failed: ${errMessage(err)}`, { status: 502 });
    }

    // Body and content type only; upstream cookies stay out of the app session.
    // CORS lets the favicon cache read the bytes with renderer `fetch()`.
    const headers = new Headers({ "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" });
    const contentType = upstream.headers.get("content-type");
    if (contentType) headers.set("Content-Type", contentType);
    return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers,
    });
}

/** Protocol of `url`, or "" when it does not parse. Never throws. */
function safeProtocol(url: string): string {
    try {
        return new URL(url).protocol;
    } catch {
        return "";
    }
}

// ── IPC Registration ───────────────────────────────────────────────────────

export function initBrowserNetworkHandlers(): void {
    app.on("web-contents-created", (_event, contents) => {
        browserNetworkService.handleWebContentsCreated(contents);
    });

    guardedIpcHandle(
        BrowserNetworkChannel.apply,
        (_event, partition: string, network: BrowserNetwork) =>
            browserNetworkService.apply(partition, network),
    );

    guardedIpcHandle(BrowserNetworkChannel.checkIp, (_event, partition: string) =>
        browserNetworkService.checkIp(partition),
    );

    guardedIpcHandle(BrowserNetworkChannel.release, (_event, partition: string) =>
        browserNetworkService.release(partition),
    );

    guardedIpcHandle(
        BrowserNetworkChannel.sessionSource,
        (_event, partition: string, url: string) =>
            browserNetworkService.sessionSource(partition, url),
    );
}
