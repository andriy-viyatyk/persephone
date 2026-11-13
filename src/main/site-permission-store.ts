import type { Session } from "electron";
import type { BrowserSitePermissionKey } from "../ipc/browser-ipc";
import { JsonFileStore } from "./json-file-store";

export type BrowserPermissionKey =
    | "camera" | "microphone" | "geolocation" | "notifications" | "midi" | "midiSysex"
    | "clipboard-read" | "idle-detection" | "window-management" | "speaker-selection"
    | `openExternal:${string}`;
export type PermissionDecision = "allow" | "block";
export interface SitePermissionEntry {
    key: BrowserSitePermissionKey;
    decision: PermissionDecision | undefined;
}

type PermissionStoreData = { version: 1; profiles: Record<string, Record<string, Record<string, PermissionDecision>>> };

export const PROMPTABLE = new Set<BrowserPermissionKey>([
    "camera", "microphone", "geolocation", "notifications", "midi", "midiSysex",
    "clipboard-read", "idle-detection", "window-management", "speaker-selection",
]);
export const EXTERNAL_SCHEMES = new Set(["http", "https", "mailto", "tel"]);
const SESSION_PROFILE_PATH = /[\\/]Partitions[\\/]browser-([^\\/]+)[\\/]?$/i;

export function normalizeOrigin(value: string | undefined): string | undefined {
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

function sanitizePermissionStore(raw: unknown): PermissionStoreData | null {
    if (!raw || typeof raw !== "object" || (raw as PermissionStoreData).version !== 1
        || !(raw as PermissionStoreData).profiles || typeof (raw as PermissionStoreData).profiles !== "object") return null;
    const profiles = Object.create(null) as PermissionStoreData["profiles"];
    for (const [profile, origins] of Object.entries((raw as PermissionStoreData).profiles)) {
        if (!profile || !isSafeProfileName(profile) || !origins || typeof origins !== "object") continue;
        const validOrigins = Object.create(null) as PermissionStoreData["profiles"][string];
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
    return { version: 1, profiles };
}

function isSitePermissionKey(key: string): key is BrowserPermissionKey {
    if (PROMPTABLE.has(key as BrowserPermissionKey)) return true;
    const match = /^openExternal:([a-z][a-z0-9+.-]*)$/.exec(key);
    return Boolean(match && EXTERNAL_SCHEMES.has(match[1]));
}

function storageKey(origin: string, key: BrowserPermissionKey): string { return `${origin}\u0000${key}`; }

export class SitePermissionStore {
    private readonly permissionStore = new JsonFileStore<PermissionStoreData>("browser-permissions.json", {
        validate: sanitizePermissionStore,
        defaultValue: () => ({ version: 1, profiles: Object.create(null) as PermissionStoreData["profiles"] }),
        onSaveError: "warn",
    });
    private readonly privateDecisions = new WeakMap<Session, Map<string, PermissionDecision>>();
    private readonly sessionProfiles = new WeakMap<Session, string | null>();
    private readonly store: PermissionStoreData = { version: 1, profiles: Object.create(null) as PermissionStoreData["profiles"] };
    private appSession: Session | undefined;
    private fileAccessSession: Session | undefined;

    load(): void {
        this.store.profiles = this.permissionStore.loadSync().value.profiles;
    }

    setProtectedSessions(appSession: Session, fileAccessSession: Session): void {
        this.appSession = appSession;
        this.fileAccessSession = fileAccessSession;
    }

    get(ses: Session, origin: string, key: BrowserPermissionKey): PermissionDecision | undefined {
        const profileName = this.profileNameFor(ses);
        if (profileName !== null) return this.store.profiles[profileName]?.[origin]?.[key];
        return this.decisionMap(ses, profileName)?.get(storageKey(origin, key));
    }

    set(ses: Session, profileName: string | null, origin: string, key: BrowserPermissionKey, decision: PermissionDecision): void {
        if (profileName === null) {
            this.decisionMap(ses, profileName)?.set(storageKey(origin, key), decision);
            return;
        }
        this.store.profiles[profileName] ??= Object.create(null) as PermissionStoreData["profiles"][string];
        this.store.profiles[profileName][origin] ??= Object.create(null) as Record<string, PermissionDecision>;
        this.store.profiles[profileName][origin][key] = decision;
        this.writeStore();
    }

    reset(ses: Session, origin: string): boolean {
        const profileName = this.profileNameFor(ses);
        if (profileName === null) {
            const decisions = this.decisionMap(ses, profileName);
            for (const key of decisions?.keys() ?? []) {
                if (key.startsWith(`${origin}\u0000`)) decisions?.delete(key);
            }
            return true;
        }
        if (!this.store.profiles[profileName]?.[origin]) return true;
        delete this.store.profiles[profileName][origin];
        if (!Object.keys(this.store.profiles[profileName]).length) delete this.store.profiles[profileName];
        this.writeStore();
        return true;
    }

    list(ses: Session, origin: string): SitePermissionEntry[];
    list(profileName: string): Array<{ origin: string; permission: string; decision: PermissionDecision }>;
    list(sesOrProfile: Session | string, origin?: string): SitePermissionEntry[] | Array<{ origin: string; permission: string; decision: PermissionDecision }> {
        if (typeof sesOrProfile === "string") {
            const origins = this.store.profiles[sesOrProfile] ?? {};
            return Object.entries(origins).flatMap(([profileOrigin, permissions]) =>
                Object.entries(permissions).map(([permission, decision]) => ({ origin: profileOrigin, permission, decision })));
        }
        if (origin === undefined) return [];
        const ses = sesOrProfile;
        const profileName = this.profileNameFor(ses);
        const decisions = profileName === null
            ? Array.from(this.decisionMap(ses, profileName)?.entries() ?? [])
            : Object.entries(this.store.profiles[profileName]?.[origin] ?? {});
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

    hasSavedProfile(profileName: string): boolean {
        return Object.hasOwn(this.store.profiles, profileName);
    }

    remove(profileName: string): void;
    remove(profileName: string, origin: string, permission: string): void;
    remove(profileName: string, origin?: string, permission?: string): void {
        if (origin === undefined) {
            if (!this.store.profiles[profileName]) return;
            delete this.store.profiles[profileName];
            this.writeStore();
            return;
        }
        if (permission === undefined) return;
        const permissions = this.store.profiles[profileName]?.[origin];
        if (!permissions) return;
        delete permissions[permission];
        if (!Object.keys(permissions).length) delete this.store.profiles[profileName][origin];
        if (!Object.keys(this.store.profiles[profileName]).length) delete this.store.profiles[profileName];
        this.writeStore();
    }

    private isProtected(ses: Session): boolean {
        return ses === this.appSession || ses === this.fileAccessSession;
    }

    isProtectedSession(ses: Session): boolean {
        return this.isProtected(ses);
    }

    profileNameFor(ses: Session): string | null {
        let profile = this.sessionProfiles.get(ses);
        if (profile !== undefined) return profile;
        profile = null;
        if (ses.isPersistent()) {
            const storage = ses.getStoragePath();
            const match = storage?.match(SESSION_PROFILE_PATH);
            if (match) profile = match[1];
        }
        this.sessionProfiles.set(ses, profile);
        return profile;
    }

    private decisionMap(ses: Session, profileName: string | null): Map<string, PermissionDecision> | undefined {
        if (profileName !== null) return undefined;
        let decisions = this.privateDecisions.get(ses);
        if (!decisions) { decisions = new Map(); this.privateDecisions.set(ses, decisions); }
        return decisions;
    }

    private writeStore(): void {
        this.permissionStore.saveSync(this.store);
    }
}

export const sitePermissionStore = new SitePermissionStore();

export function getSitePermissionEntries(ses: Session, originValue: string): SitePermissionEntry[] {
    const origin = normalizeOrigin(originValue);
    if (!origin || sitePermissionStore.isProtectedSession(ses)) return [];
    return sitePermissionStore.list(ses, origin);
}

export function setSitePermissionDecision(
    ses: Session,
    originValue: string,
    key: string,
    decision: PermissionDecision,
): boolean {
    const origin = normalizeOrigin(originValue);
    if (!origin || sitePermissionStore.isProtectedSession(ses)
        || (decision !== "allow" && decision !== "block") || !isSitePermissionKey(key)) return false;
    const profileName = sitePermissionStore.profileNameFor(ses);
    if (key.startsWith("openExternal:") && !sitePermissionStore.get(ses, origin, key)) return false;
    sitePermissionStore.set(ses, profileName, origin, key, decision);
    return true;
}

export function resetSitePermissionDecisions(ses: Session, originValue: string): boolean {
    const origin = normalizeOrigin(originValue);
    if (!origin || sitePermissionStore.isProtectedSession(ses)) return false;
    return sitePermissionStore.reset(ses, origin);
}

export function listProfilePermissionDecisions(profileName: string): Array<{ origin: string; permission: string; decision: PermissionDecision }> {
    return sitePermissionStore.list(profileName) as Array<{ origin: string; permission: string; decision: PermissionDecision }>;
}

export function hasSavedProfilePermissionDecisions(profileName: string): boolean {
    return sitePermissionStore.hasSavedProfile(profileName);
}

export function removeProfilePermissionDecision(profileName: string, origin: string, permission: string): void {
    sitePermissionStore.remove(profileName, origin, permission);
}

export function clearProfilePermissionDecisions(profileName: string): void {
    sitePermissionStore.remove(profileName);
}
