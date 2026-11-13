import { app, session, type Session, type WebContents } from "electron";
import { appPartition, fileAccessPersistPartition } from "./constants";
import { errMessage } from "../shared/utils";
import { boardTrustService } from "./board-trust-service";
import { getBoardRootForHost } from "./board-protocol-service";
import {
    audioWindowLoopbackGrant,
    audioWindowMicrophoneGrant,
    configureAudioWindowTargetResolver,
    recordingGrant,
    transcriptLoopbackGrant,
    voiceTypingGrant,
} from "./media-grants";
import {
    EXTERNAL_SCHEMES,
    PROMPTABLE,
    normalizeOrigin,
    sitePermissionStore,
    type BrowserPermissionKey,
    type PermissionDecision,
} from "./site-permission-store";

export interface PermissionPromptData {
    requestId: string;
    topLevelOrigin: string;
    permissions: Array<Exclude<BrowserPermissionKey, `openExternal:${string}`> | "openExternal">;
    externalScheme?: string;
}
export type PermissionPromptHandler = (webContents: WebContents, data: PermissionPromptData) => boolean;
type PermissionRequest = Parameters<Session["setPermissionRequestHandler"]>[0] extends (wc: WebContents, permission: infer P, cb: (allowed: boolean) => void, details: infer D) => void ? { webContents: WebContents; permission: P; details: D; callback: (allowed: boolean) => void } : never;
type PermissionCheck = Parameters<Session["setPermissionCheckHandler"]>[0] extends (wc: WebContents | null, permission: infer P, origin: string, details: infer D) => boolean ? { webContents: WebContents | null; permission: P; details: D; origin: string } : never;

const APP_ALLOW = new Set(["clipboard-read", "clipboard-sanitized-write", "fullscreen", "pointerLock"]);
const installedSessions = new WeakSet<Session>();
const pending = new Map<string, { callback: (allowed: boolean) => void; session: Session; webContents: WebContents; profileName: string | null; origin: string; keys: BrowserPermissionKey[] }>();
let appSession: Session;
let fileAccessSession: Session;
let promptHandler: PermissionPromptHandler | undefined;
let initialized = false;

export interface PermissionPolicyStartDependencies {
    promptHandler: PermissionPromptHandler;
    audioWindowTargetResolver: () => WebContents | undefined;
}

function topOriginFromRequest(wc: WebContents): string | undefined {
    try { return normalizeOrigin(wc.getURL()); } catch { return undefined; }
}

function requestKeys(permission: string, details: Electron.PermissionRequest): BrowserPermissionKey[] | undefined {
    if (permission === "media") {
        const media = details as Electron.MediaAccessPermissionRequest;
        const keys: BrowserPermissionKey[] = [];
        if (media.mediaTypes?.includes("video")) keys.push("camera");
        if (media.mediaTypes?.includes("audio")) keys.push("microphone");
        return keys.length ? keys : undefined;
    }
    if (permission === "openExternal") {
        const externalURL = (details as Electron.OpenExternalPermissionRequest).externalURL;
        try {
            const scheme = externalURL ? new URL(externalURL).protocol.slice(0, -1).toLowerCase() : "";
            return EXTERNAL_SCHEMES.has(scheme) ? [`openExternal:${scheme}`] : undefined;
        } catch { return undefined; }
    }
    return PROMPTABLE.has(permission as BrowserPermissionKey) ? [permission as BrowserPermissionKey] : undefined;
}

function requesterOrigin(value: string | undefined): string | undefined {
    if (!value) return undefined;
    try {
        const url = new URL(value);
        if (url.protocol === "board:" && url.hostname && !url.port && !url.username && !url.password) {
            return `board://${url.hostname.toLowerCase()}`;
        }
        return url.origin !== "null" ? url.origin : undefined;
    } catch { return undefined; }
}

function boardGrantForOrigin(origin: string | undefined) {
    if (!origin?.startsWith("board://")) return undefined;
    const host = origin.slice("board://".length);
    if (!host || host.includes("/") || host.includes(":")) return undefined;
    const root = getBoardRootForHost(host);
    return root ? boardTrustService.getGrantFromSnapshot(root) : undefined;
}

function boardPermissionAllowed(
    permission: string,
    grant: NonNullable<ReturnType<typeof boardTrustService.getGrantFromSnapshot>>,
    details: Electron.PermissionRequest | Electron.PermissionCheckHandlerHandlerDetails,
    isRequest: boolean,
): boolean {
    if (permission === "fullscreen" || permission === "pointerLock" || permission === "clipboard-sanitized-write") return true;
    const device = grant.deviceAccess();
    if (permission === "clipboard-read") return device.clipboardRead;
    if (permission === "geolocation") return device.geolocation;
    if (permission === "notifications") return device.notifications;
    if (permission === "media") {
        if (isRequest) {
            const mediaTypes = (details as Electron.MediaAccessPermissionRequest).mediaTypes;
            if (!mediaTypes?.length || mediaTypes.some((type) => type !== "video" && type !== "audio")) return false;
            return mediaTypes.every((type) => type === "video" ? device.camera : device.microphone);
        }
        const mediaType = (details as Electron.PermissionCheckHandlerHandlerDetails).mediaType;
        if (mediaType === "video") return device.camera;
        if (mediaType === "audio") return device.microphone;
    }
    return false;
}

function appSubframeAllowed(permission: string, origin: string | undefined, details: Electron.PermissionRequest | Electron.PermissionCheckHandlerHandlerDetails, isRequest: boolean): boolean {
    if (permission === "fullscreen" || permission === "pointerLock") return true;
    const grant = boardGrantForOrigin(origin);
    return !!grant && boardPermissionAllowed(permission, grant, details, isRequest);
}

function denySelection(ses: Session): void {
    ses.on("select-hid-device", (event, _details, callback) => { event.preventDefault(); callback(); });
    ses.on("select-serial-port", (event, _ports, _wc, callback) => { event.preventDefault(); callback(""); });
    ses.on("select-usb-device", (event, _details, callback) => { event.preventDefault(); callback(); });
}

function handleCheck(ses: Session, request: PermissionCheck): boolean {
    const { permission, origin, details } = request;
    if (ses === appSession) {
        if (details.isMainFrame === true) {
            if (APP_ALLOW.has(permission as string)) return true;
            if (permission !== "media" || request.webContents === null) return false;
            return details.mediaType === "audio"
                ? voiceTypingGrant.has(request.webContents.id) || audioWindowMicrophoneGrant.has(request.webContents.id, request.webContents.mainFrame)
                : details.mediaType === "video" && recordingGrant.has(request.webContents.id);
        }
        const requestingOrigin = requesterOrigin(origin);
        if (permission === "media" && details.securityOrigin) {
            const securityOrigin = requesterOrigin(details.securityOrigin);
            if (!requestingOrigin || securityOrigin !== requestingOrigin) return false;
        }
        return appSubframeAllowed(permission as string, requestingOrigin, details, false);
    }
    if (ses === fileAccessSession) return false;
    let top: string | undefined;
    if (request.webContents && !request.webContents.isDestroyed()) {
        try { top = normalizeOrigin(request.webContents.getURL()); } catch { top = undefined; }
    } else {
        top = normalizeOrigin(details.embeddingOrigin) ?? normalizeOrigin(origin);
    }
    if (!top) return false;
    if (permission === "fileSystem" || permission === "storage-access" || permission === "top-level-storage-access" || permission === "hid" || permission === "serial" || permission === "usb" || permission === "deprecated-sync-clipboard-read") return false;
    if (permission === "mediaKeySystem" || permission === "fullscreen" || permission === "pointerLock" || permission === "clipboard-sanitized-write") return true;
    if (permission === "media") {
        const key = details.mediaType === "video" ? "camera" : details.mediaType === "audio" ? "microphone" : undefined;
        if (!key) return false;
        return sitePermissionStore.get(ses, top, key) === "allow";
    }
    if (permission === "openExternal") return false;
    const key = permission as BrowserPermissionKey;
    if (!PROMPTABLE.has(key)) return false;
    return sitePermissionStore.get(ses, top, key) === "allow";
}

function handleRequest(ses: Session, request: PermissionRequest): void {
    const { permission, callback, details, webContents } = request;
    if (ses === appSession) {
        if (details.isMainFrame === true) {
            // navigator.clipboard.readText() arrives here as "clipboard-read"; without this the
            // grid's context-menu Paste failed silently while Ctrl+V (a paste event) still worked.
            if (APP_ALLOW.has(permission as string)) { callback(true); return; }
            const media = details as Electron.MediaAccessPermissionRequest;
            // A chromeMediaSource "desktop" request arrives with an empty `mediaTypes` (verified on
            // Electron 43), so accept empty or video-only — never audio — while the one-shot grant is armed.
            const types = media.mediaTypes ?? [];
            const isVoiceTypingAudio = permission === "media" && details.isMainFrame === true
                && types.length === 1 && types[0] === "audio" && voiceTypingGrant.has(webContents.id);
            const isAudioWindowMicrophone = permission === "media" && details.isMainFrame === true
                && types.length === 1 && types[0] === "audio" && audioWindowMicrophoneGrant.has(webContents.id, webContents.mainFrame);
            const isScreenRecordingVideo = permission === "media" && types.every((type) => type === "video")
                && recordingGrant.has(webContents.id);
            // getDisplayMedia arrives as "media" with empty mediaTypes, not "display-capture" (verified on
            // Electron 43). The display-media handler consumes the Transcript grant, so it is only checked here.
            const isTranscriptDisplay = permission === "media" && types.length === 0 && process.platform === "win32"
                && transcriptLoopbackGrant.has(webContents.id, webContents.mainFrame);
            const isAudioWindowDisplay = permission === "media" && types.length === 0 && process.platform === "win32"
                && audioWindowLoopbackGrant.has(webContents.id, webContents.mainFrame);
            const allowed = isVoiceTypingAudio || isAudioWindowMicrophone || isScreenRecordingVideo || isTranscriptDisplay || isAudioWindowDisplay;
            if (isVoiceTypingAudio) voiceTypingGrant.clear(webContents.id);
            if (isAudioWindowMicrophone) audioWindowMicrophoneGrant.clear(webContents.id);
            if (isScreenRecordingVideo && allowed) recordingGrant.clear(webContents.id);
            callback(allowed);
            return;
        }
        const urlOrigin = requesterOrigin(details.requestingUrl);
        if (permission === "media") {
            const securityOrigin = requesterOrigin((details as Electron.MediaAccessPermissionRequest).securityOrigin);
            if (!urlOrigin || (securityOrigin && securityOrigin !== urlOrigin)) { callback(false); return; }
        }
        callback(appSubframeAllowed(permission as string, urlOrigin, details, true));
        return;
    }
    if (ses === fileAccessSession) { callback(false); return; }
    if (permission === "fileSystem") { callback(true); return; }
    if (permission === "mediaKeySystem" || permission === "fullscreen" || permission === "pointerLock" || permission === "clipboard-sanitized-write") { callback(true); return; }
    if (permission === "keyboardLock") { callback(details.isMainFrame); return; }
    if (permission === "storage-access" || permission === "top-level-storage-access" || permission === "display-capture") { callback(false); return; }
    const keys = requestKeys(permission as string, details as Electron.PermissionRequest);
    const origin = topOriginFromRequest(webContents);
    if (!keys || !origin) { callback(false); return; }
    const profileName = sitePermissionStore.profileNameFor(ses);
    const values = keys.map((key) => sitePermissionStore.get(ses, origin, key));
    if (values.every((value) => value === "allow")) { callback(true); return; }
    if (values.some((value) => value === "block")) { callback(false); return; }
    if (permission === "openExternal" && !details.isMainFrame) { callback(false); return; }
    if (!promptHandler) { callback(false); return; }
    const requestId = crypto.randomUUID();
    pending.set(requestId, { callback, session: ses, webContents, profileName, origin, keys });
    const externalScheme = keys[0]?.startsWith("openExternal:") ? keys[0].slice("openExternal:".length) : undefined;
    const permissions = keys.map((key) => key.startsWith("openExternal:") ? "openExternal" : key) as PermissionPromptData["permissions"];
    if (!promptHandler(webContents, { requestId, topLevelOrigin: origin, permissions, externalScheme })) {
        pending.delete(requestId);
        callback(false);
    }
}

/** The app session is often created (and installed) before `appSession` is assigned, so the display-media
 *  handler is registered here, once the app session is known, rather than in installSession(). */
function installAppDisplayMedia(ses: Session): void {
    ses.setDisplayMediaRequestHandler((request, callback) => {
        const transcriptGrant = request.videoRequested && request.audioRequested && transcriptLoopbackGrant.consume(request.frame);
        const audioGrant = request.videoRequested && request.audioRequested && audioWindowLoopbackGrant.consume(request.frame);
        if (process.platform !== "win32" || !request.videoRequested || !request.audioRequested || (!transcriptGrant && !audioGrant)) {
            callback({});
            return;
        }
        callback({ video: request.frame, audio: "loopback" });
    });
}

function installSession(ses: Session): void {
    if (installedSessions.has(ses)) return;
    installedSessions.add(ses);
    ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
        let completed = false;
        const respond = (allowed: boolean): void => {
            if (completed) return;
            completed = true;
            callback(allowed);
        };
        try {
            handleRequest(ses, { webContents, permission, callback: respond, details } as PermissionRequest);
        } catch (error: unknown) {
            console.warn(`Browser permission request failed closed: ${errMessage(error)}`);
            respond(false);
        }
    });
    ses.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
        try {
            return handleCheck(ses, { webContents, permission, origin: requestingOrigin, details } as PermissionCheck);
        } catch (error: unknown) {
            console.warn(`Browser permission check failed closed: ${errMessage(error)}`);
            return false;
        }
    });
    ses.setDevicePermissionHandler(() => false);
    denySelection(ses);
}

export function resolvePermissionRequest(requestId: string, decision: PermissionDecision): boolean {
    const request = pending.get(requestId);
    if (!request) return false;
    pending.delete(requestId);
    for (const key of request.keys) sitePermissionStore.set(request.session, request.profileName, request.origin, key, decision);
    request.callback(decision === "allow");
    return true;
}

export function settlePermissionRequestsForWebContents(contents: WebContents): void {
    for (const [id, request] of pending) {
        if (request.webContents === contents) {
            pending.delete(id);
            request.callback(false);
        }
    }
}

export function initPermissionPolicy(dependencies: PermissionPolicyStartDependencies): void {
    if (initialized) return;
    initialized = true;
    promptHandler = dependencies.promptHandler;
    configureAudioWindowTargetResolver(dependencies.audioWindowTargetResolver);
    sitePermissionStore.load();
    app.on("session-created", installSession);
    app.on("web-contents-created", (_event, contents) => {
        contents.on("select-bluetooth-device", (event, _devices, callback) => {
            event.preventDefault();
            callback("");
        });
        contents.once("destroyed", () => settlePermissionRequestsForWebContents(contents));
    });
    app.on("ready", () => {
        appSession = session.fromPartition(appPartition);
        fileAccessSession = session.fromPartition(fileAccessPersistPartition);
        sitePermissionStore.setProtectedSessions(appSession, fileAccessSession);
        installSession(appSession);
        installAppDisplayMedia(appSession);
        installSession(fileAccessSession);
    });
}
