import { app, session, type Session, type WebContents } from "electron";
import fs from "node:fs";
import path from "node:path";
import { appPartition, fileAccessPersistPartition } from "./constants";
import { getDataFolder } from "./utils";
import { errMessage } from "../shared/utils";
import type { BrowserSitePermissionKey } from "../ipc/browser-ipc";
import { boardTrustService } from "./board-trust-service";
import { getBoardRootForHost } from "./board-protocol-service";

export type BrowserPermissionKey =
    | "camera" | "microphone" | "geolocation" | "notifications" | "midi" | "midiSysex"
    | "clipboard-read" | "idle-detection" | "window-management" | "speaker-selection"
    | `openExternal:${string}`;
export type PermissionDecision = "allow" | "block";
export interface SitePermissionEntry {
    key: BrowserSitePermissionKey;
    decision: PermissionDecision | undefined;
}
export interface PermissionPromptData {
    requestId: string;
    topLevelOrigin: string;
    permissions: Array<Exclude<BrowserPermissionKey, `openExternal:${string}`> | "openExternal">;
    externalScheme?: string;
}
export type PermissionPromptHandler = (webContents: WebContents, data: PermissionPromptData) => boolean;
type PermissionStore = { version: 1; profiles: Record<string, Record<string, Record<string, PermissionDecision>>> };
type PermissionRequest = Parameters<Session["setPermissionRequestHandler"]>[0] extends (wc: WebContents, permission: infer P, cb: (allowed: boolean) => void, details: infer D) => void ? { webContents: WebContents; permission: P; details: D; callback: (allowed: boolean) => void } : never;
type PermissionCheck = Parameters<Session["setPermissionCheckHandler"]>[0] extends (wc: WebContents | null, permission: infer P, origin: string, details: infer D) => boolean ? { webContents: WebContents | null; permission: P; details: D; origin: string } : never;

const APP_ALLOW = new Set(["clipboard-read", "clipboard-sanitized-write", "fullscreen", "pointerLock"]);
const PROMPTABLE = new Set<BrowserPermissionKey>([
    "camera", "microphone", "geolocation", "notifications", "midi", "midiSysex",
    "clipboard-read", "idle-detection", "window-management", "speaker-selection",
]);
const EXTERNAL_SCHEMES = new Set(["http", "https", "mailto", "tel"]);
const SESSION_PROFILE_PATH = /[\\/]Partitions[\\/]browser-([^\\/]+)[\\/]?$/i;
const privateDecisions = new WeakMap<Session, Map<string, PermissionDecision>>();
const sessionProfiles = new WeakMap<Session, string | null>();
const installedSessions = new WeakSet<Session>();
const pending = new Map<string, { callback: (allowed: boolean) => void; session: Session; webContents: WebContents; profileName: string | null; origin: string; keys: BrowserPermissionKey[] }>();
const store: PermissionStore = { version: 1, profiles: Object.create(null) as PermissionStore["profiles"] };
let appSession: Session;
let fileAccessSession: Session;
let promptHandler: PermissionPromptHandler | undefined;
let initialized = false;
const recordingMediaGrants = new Map<number, number>();

/** Arm one app-main-frame, video-only permission request for a window source capture. */
export function armRecordingMediaGrant(webContentsId: number): void {
    recordingMediaGrants.set(webContentsId, Date.now() + 5000);
    setTimeout(() => {
        if ((recordingMediaGrants.get(webContentsId) ?? 0) <= Date.now()) recordingMediaGrants.delete(webContentsId);
    }, 5100);
}

export function clearRecordingMediaGrant(webContentsId: number): void {
    recordingMediaGrants.delete(webContentsId);
}

function hasRecordingMediaGrant(webContentsId: number): boolean {
    const expiresAt = recordingMediaGrants.get(webContentsId);
    if (!expiresAt || expiresAt <= Date.now()) {
        recordingMediaGrants.delete(webContentsId);
        return false;
    }
    return true;
}

function normalizeOrigin(value: string | undefined): string | undefined {
    if (!value) return undefined;
    try {
        const url = new URL(value);
        return (url.protocol === "http:" || url.protocol === "https:") && url.origin !== "null" ? url.origin : undefined;
    } catch { return undefined; }
}

function isSafeProfileName(profile: string): boolean {
    return profile.length <= 80
        && !/[\\/]/.test(profile)
        && !Array.from(profile).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
}

function profileNameFor(ses: Session): string | null {
    let profile = sessionProfiles.get(ses);
    if (profile !== undefined) return profile;
    profile = null;
    if (ses.isPersistent()) {
        const storage = ses.getStoragePath();
        const match = storage?.match(SESSION_PROFILE_PATH);
        if (match) profile = match[1];
    }
    sessionProfiles.set(ses, profile);
    return profile;
}

function decisionMap(ses: Session, profileName: string | null): Map<string, PermissionDecision> | undefined {
    if (profileName !== null) return undefined;
    let decisions = privateDecisions.get(ses);
    if (!decisions) { decisions = new Map(); privateDecisions.set(ses, decisions); }
    return decisions;
}

function storageKey(origin: string, key: BrowserPermissionKey): string { return `${origin}\u0000${key}`; }

function getDecision(ses: Session, profileName: string | null, origin: string, key: BrowserPermissionKey): PermissionDecision | undefined {
    if (profileName !== null) return store.profiles[profileName]?.[origin]?.[key];
    return decisionMap(ses, profileName)?.get(storageKey(origin, key));
}

function writeStore(): void {
    const filename = path.join(getDataFolder(), "browser-permissions.json");
    const temp = `${filename}.${process.pid}.tmp`;
    try {
        fs.mkdirSync(path.dirname(filename), { recursive: true });
        fs.writeFileSync(temp, JSON.stringify(store, null, 2), "utf8");
        fs.renameSync(temp, filename);
    } catch (error: unknown) {
        try { fs.rmSync(temp, { force: true }); } catch { /* best effort cleanup */ }
        console.warn(`Failed to save browser permission decisions: ${errMessage(error)}`);
    }
}

function hydrateStore(): void {
    try {
        const raw: unknown = JSON.parse(fs.readFileSync(path.join(getDataFolder(), "browser-permissions.json"), "utf8"));
        if (!raw || typeof raw !== "object" || (raw as PermissionStore).version !== 1 || !(raw as PermissionStore).profiles || typeof (raw as PermissionStore).profiles !== "object") return;
        const profiles = Object.create(null) as PermissionStore["profiles"];
        for (const [profile, origins] of Object.entries((raw as PermissionStore).profiles)) {
            if (!profile || !isSafeProfileName(profile) || !origins || typeof origins !== "object") continue;
            const validOrigins = Object.create(null) as PermissionStore["profiles"][string];
            for (const [origin, permissions] of Object.entries(origins)) {
                if (normalizeOrigin(origin) !== origin || !permissions || typeof permissions !== "object") continue;
                const validPermissions = Object.create(null) as Record<string, PermissionDecision>;
                for (const [key, decision] of Object.entries(permissions)) {
                    const supportedKey = PROMPTABLE.has(key as BrowserPermissionKey)
                        || Array.from(EXTERNAL_SCHEMES).some((scheme) => key === `openExternal:${scheme}`);
                    if (supportedKey && (decision === "allow" || decision === "block")) validPermissions[key] = decision;
                }
                if (Object.keys(validPermissions).length) validOrigins[origin] = validPermissions;
            }
            if (Object.keys(validOrigins).length) profiles[profile] = validOrigins;
        }
        store.profiles = profiles;
    } catch { /* Missing or invalid store means all sites are undecided. */ }
}

function saveDecision(ses: Session, profileName: string | null, origin: string, key: BrowserPermissionKey, decision: PermissionDecision): void {
    if (profileName === null) {
        decisionMap(ses, profileName)?.set(storageKey(origin, key), decision);
        return;
    }
    store.profiles[profileName] ??= Object.create(null) as PermissionStore["profiles"][string];
    store.profiles[profileName][origin] ??= Object.create(null) as Record<string, PermissionDecision>;
    store.profiles[profileName][origin][key] = decision;
    writeStore();
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
    return root ? boardTrustService.getGrantedPermissionsFromSnapshot(root) : undefined;
}

function boardPermissionAllowed(
    permission: string,
    grant: NonNullable<ReturnType<typeof boardTrustService.getGrantedPermissionsFromSnapshot>>,
    details: Electron.PermissionRequest | Electron.PermissionCheckHandlerHandlerDetails,
    isRequest: boolean,
): boolean {
    if (permission === "fullscreen" || permission === "pointerLock" || permission === "clipboard-sanitized-write") return true;
    if (grant.kind === "legacy") return APP_ALLOW.has(permission);
    if (permission === "clipboard-read") return grant.flags.clipboardRead;
    if (permission === "geolocation") return grant.flags.geolocation;
    if (permission === "notifications") return grant.flags.notifications;
    if (permission === "media") {
        if (isRequest) {
            const mediaTypes = (details as Electron.MediaAccessPermissionRequest).mediaTypes;
            if (!mediaTypes?.length || mediaTypes.some((type) => type !== "video" && type !== "audio")) return false;
            return mediaTypes.every((type) => type === "video" ? grant.flags.camera : grant.flags.microphone);
        }
        const mediaType = (details as Electron.PermissionCheckHandlerHandlerDetails).mediaType;
        if (mediaType === "video") return grant.flags.camera;
        if (mediaType === "audio") return grant.flags.microphone;
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
            return permission === "media" && request.webContents !== null
                && hasRecordingMediaGrant(request.webContents.id)
                && details.mediaType === "video";
        }
        const requestingOrigin = requesterOrigin(origin);
        if (permission === "media" && details.securityOrigin) {
            const securityOrigin = requesterOrigin(details.securityOrigin);
            if (!requestingOrigin || securityOrigin !== requestingOrigin) return false;
        }
        return appSubframeAllowed(permission as string, requestingOrigin, details, false);
    }
    if (ses === fileAccessSession) return false;
    const name = profileNameFor(ses);
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
        return getDecision(ses, name, top, key) === "allow";
    }
    if (permission === "openExternal") return false;
    const key = permission as BrowserPermissionKey;
    if (!PROMPTABLE.has(key)) return false;
    return getDecision(ses, name, top, key) === "allow";
}

function handleRequest(ses: Session, request: PermissionRequest): void {
    const { permission, callback, details, webContents } = request;
    if (ses === appSession) {
        if (details.isMainFrame === true) {
            const media = details as Electron.MediaAccessPermissionRequest;
            // A chromeMediaSource "desktop" request arrives with an empty `mediaTypes` (verified on
            // Electron 43), so accept empty or video-only — never audio — while the one-shot grant is armed.
            const types = media.mediaTypes ?? [];
            const allowed = permission === "media" && types.every((type) => type === "video")
                && hasRecordingMediaGrant(webContents.id);
            if (allowed) clearRecordingMediaGrant(webContents.id);
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
    const profileName = profileNameFor(ses);
    const values = keys.map((key) => getDecision(ses, profileName, origin, key));
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
    if (ses === appSession) ses.setDisplayMediaRequestHandler((_request, callback) => callback({}));
    denySelection(ses);
}

export function setPermissionPromptHandler(handler: PermissionPromptHandler): void { promptHandler = handler; }

export function resolvePermissionRequest(requestId: string, decision: PermissionDecision): boolean {
    const request = pending.get(requestId);
    if (!request) return false;
    pending.delete(requestId);
    for (const key of request.keys) saveDecision(request.session, request.profileName, request.origin, key, decision);
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

function isSitePermissionKey(key: string): key is BrowserPermissionKey {
    if (PROMPTABLE.has(key as BrowserPermissionKey)) return true;
    const match = /^openExternal:([a-z][a-z0-9+.-]*)$/.exec(key);
    return Boolean(match && EXTERNAL_SCHEMES.has(match[1]));
}

export function getSitePermissionEntries(ses: Session, originValue: string): SitePermissionEntry[] {
    const origin = normalizeOrigin(originValue);
    if (!origin || ses === appSession || ses === fileAccessSession) return [];
    const profileName = profileNameFor(ses);
    const decisions = profileName === null
        ? Array.from(decisionMap(ses, profileName)?.entries() ?? [])
        : Object.entries(store.profiles[profileName]?.[origin] ?? {});
    const remembered: SitePermissionEntry[] = decisions.flatMap(([storedKey, decision]) => {
        const key = profileName === null
            ? storedKey.startsWith(`${origin}\u0000`) ? storedKey.slice(origin.length + 1) : ""
            : storedKey;
        return key && isSitePermissionKey(key) && (PROMPTABLE.has(key) || EXTERNAL_SCHEMES.has(key.slice("openExternal:".length)))
            ? [{ key: key as BrowserPermissionKey, decision }]
            : [];
    });
    const byKey = new Map(remembered.map(({ key, decision }) => [key, decision]));
    return [
        ...Array.from(PROMPTABLE).map((key) => ({ key, decision: byKey.get(key) })),
        ...remembered.filter(({ key }) => key.startsWith("openExternal:")) as SitePermissionEntry[],
    ];
}

export function setSitePermissionDecision(
    ses: Session,
    originValue: string,
    key: string,
    decision: PermissionDecision,
): boolean {
    const origin = normalizeOrigin(originValue);
    if (!origin || ses === appSession || ses === fileAccessSession
        || (decision !== "allow" && decision !== "block") || !isSitePermissionKey(key)) return false;
    const profileName = profileNameFor(ses);
    if (key.startsWith("openExternal:")
        && !getDecision(ses, profileName, origin, key)) return false;
    saveDecision(ses, profileName, origin, key, decision);
    return true;
}

export function resetSitePermissionDecisions(ses: Session, originValue: string): boolean {
    const origin = normalizeOrigin(originValue);
    if (!origin || ses === appSession || ses === fileAccessSession) return false;
    const profileName = profileNameFor(ses);
    if (profileName === null) {
        const decisions = decisionMap(ses, profileName);
        for (const key of decisions?.keys() ?? []) {
            if (key.startsWith(`${origin}\u0000`)) decisions?.delete(key);
        }
        return true;
    }
    if (!store.profiles[profileName]?.[origin]) return true;
    delete store.profiles[profileName][origin];
    if (!Object.keys(store.profiles[profileName]).length) delete store.profiles[profileName];
    writeStore();
    return true;
}

export function listProfilePermissionDecisions(profileName: string): Array<{ origin: string; permission: string; decision: PermissionDecision }> {
    const origins = store.profiles[profileName] ?? {};
    return Object.entries(origins).flatMap(([origin, permissions]) => Object.entries(permissions).map(([permission, decision]) => ({ origin, permission, decision })));
}

export function hasSavedProfilePermissionDecisions(profileName: string): boolean {
    return Object.hasOwn(store.profiles, profileName);
}

export function removeProfilePermissionDecision(profileName: string, origin: string, permission: string): void {
    const permissions = store.profiles[profileName]?.[origin];
    if (!permissions) return;
    delete permissions[permission];
    if (!Object.keys(permissions).length) delete store.profiles[profileName][origin];
    if (!Object.keys(store.profiles[profileName]).length) delete store.profiles[profileName];
    writeStore();
}

export function clearProfilePermissionDecisions(profileName: string): void {
    if (!store.profiles[profileName]) return;
    delete store.profiles[profileName];
    writeStore();
}

export function initPermissionPolicy(): void {
    if (initialized) return;
    initialized = true;
    hydrateStore();
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
        installSession(appSession);
        installSession(fileAccessSession);
    });
}
