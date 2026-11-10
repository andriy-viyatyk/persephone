export interface BoardPermissionFlags {
    execute: boolean;
    service: boolean;
    fileSystem: false | "board" | "full";
    openExternal: boolean;
    appScripting: boolean;
    network: false | "internet" | "full";
    clipboardRead: boolean;
    camera: boolean;
    microphone: boolean;
    computerAudio: boolean;
    geolocation: boolean;
    notifications: boolean;
    themes: boolean;
}

export type NormalizedBoardPermissions =
    | { kind: "flags"; flags: BoardPermissionFlags }
    | { kind: "legacy"; service: boolean };

/** Parses raw manifest input only; this is not idempotent for normalized values. Use BoardGrant.fromManifest for raw values. */
export function normalizePermissions(raw: unknown): NormalizedBoardPermissions {
    if (Array.isArray(raw)) {
        return { kind: "legacy", service: raw.some((entry) => typeof entry === "string" && entry.trim() === "service") };
    }
    if (!raw || typeof raw !== "object") return { kind: "legacy", service: false };

    const source = raw as Record<string, unknown>;
    const fileSystem = source.fileSystem;
    const network = source.network;
    return {
        kind: "flags",
        flags: {
            execute: source.execute === true,
            service: source.service === true,
            fileSystem: fileSystem === "board" || fileSystem === "full" ? fileSystem : false,
            openExternal: source.openExternal === true,
            appScripting: source.appScripting === true,
            network: network === "internet" || network === "full" ? network : false,
            clipboardRead: source.clipboardRead === true,
            camera: source.camera === true,
            microphone: source.microphone === true,
            computerAudio: source.computerAudio === true,
            geolocation: source.geolocation === true,
            notifications: source.notifications === true,
            themes: source.themes === true,
        },
    };
}
