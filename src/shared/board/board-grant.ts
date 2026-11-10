import { normalizePermissions, type BoardPermissionFlags, type NormalizedBoardPermissions } from "./board-permissions";

export type BoardFileSystemMode = false | "board" | "full";
export type BoardNetworkMode = false | "internet" | "full";

export interface BoardNetworkPolicy {
    network: BoardNetworkMode;
    appScripting: boolean;
    mcpUrl: string;
    boardRoot?: string;
}

export interface BoardDeviceAccess {
    camera: boolean;
    microphone: boolean;
    geolocation: boolean;
    notifications: boolean;
    clipboardRead: boolean;
}

export type BoardPermissionChange = {
    flag: keyof BoardPermissionFlags;
    kind: "added" | "removed" | "level";
    from?: boolean | string;
    to?: boolean | string;
};

export type BoardGrantItem =
    | { kind: "flag"; flag: keyof BoardPermissionFlags; value: true | "board" | "internet" | "full" }
    | { kind: "unrestricted" };

export interface BoardGrantComparison {
    item: BoardGrantItem;
    mark: "kept" | "added" | "removed";
}

export type BoardGrantInput = BoardGrant | NormalizedBoardPermissions;

const permissionRank: Record<string, number> = { false: 0, board: 1, internet: 1, full: 2 };

function permissionJson(input: BoardGrantInput | undefined): string | undefined {
    if (input === undefined) return undefined;
    return JSON.stringify(input instanceof BoardGrant ? input.toWire() : input);
}

export class BoardGrant {
    static readonly NONE = new BoardGrant({ kind: "flags", flags: {
        execute: false, service: false, fileSystem: false, openExternal: false, appScripting: false,
        network: false, clipboardRead: false, camera: false, microphone: false, computerAudio: false,
        geolocation: false, notifications: false, themes: false,
    } });

    private constructor(private readonly permissions: NormalizedBoardPermissions) {}

    static from(permissions: NormalizedBoardPermissions): BoardGrant {
        return new BoardGrant(permissions);
    }

    static fromManifest(rawPermissions: unknown): BoardGrant {
        return new BoardGrant(normalizePermissions(rawPermissions));
    }

    static deny(flag: string): Error {
        return new Error(`permission-denied: "${flag}" is not enabled in board-manifest.json`);
    }

    static same(a: BoardGrantInput | undefined, b: BoardGrantInput | undefined): boolean {
        return permissionJson(a) === permissionJson(b);
    }

    allows(flag: keyof BoardPermissionFlags): boolean {
        if (this.permissions.kind === "legacy") return flag !== "computerAudio" && (flag !== "service" || this.permissions.service);
        const value = this.permissions.flags[flag];
        return value === true || value === "full" || value === "board" || value === "internet";
    }

    fileSystemMode(): BoardFileSystemMode {
        return this.permissions.kind === "legacy" ? "full" : this.permissions.flags.fileSystem;
    }

    networkMode(): BoardNetworkMode {
        return this.permissions.kind === "legacy" ? "full" : this.permissions.flags.network;
    }

    networkPolicy(extras: { mcpUrl: string; boardRoot?: string }): BoardNetworkPolicy {
        return {
            network: this.networkMode(),
            appScripting: this.permissions.kind === "legacy" || this.permissions.flags.appScripting,
            mcpUrl: extras.mcpUrl,
            ...(extras.boardRoot !== undefined ? { boardRoot: extras.boardRoot } : {}),
        };
    }

    canRunService(): boolean {
        return this.permissions.kind === "legacy" ? this.permissions.service : this.permissions.flags.service;
    }

    deviceAccess(): BoardDeviceAccess {
        if (this.permissions.kind === "legacy") return { camera: false, microphone: false, geolocation: false, notifications: false, clipboardRead: true };
        const { camera, microphone, geolocation, notifications, clipboardRead } = this.permissions.flags;
        return { camera, microphone, geolocation, notifications, clipboardRead };
    }

    iframeFeatures(): string[] {
        const device = this.deviceAccess();
        const features = ["clipboard-write"];
        if (device.camera) features.push("camera");
        if (device.microphone) features.push("microphone");
        if (device.geolocation) features.push("geolocation");
        if (device.notifications) features.push("notifications");
        if (device.clipboardRead) features.push("clipboard-read");
        return features;
    }

    items(): BoardGrantItem[] {
        if (this.permissions.kind === "legacy") return [{ kind: "unrestricted" }];
        return (Object.keys(this.permissions.flags) as (keyof BoardPermissionFlags)[])
            .filter((flag) => this.permissions.kind === "flags" && this.permissions.flags[flag] !== false)
            .map((flag) => ({ kind: "flag", flag, value: this.permissions.kind === "flags" ? this.permissions.flags[flag] as true | "board" | "internet" | "full" : true }));
    }

    diff(proposed: BoardGrantInput): BoardPermissionChange[] {
        const next = BoardGrant.asPermissions(proposed);
        if (this.permissions.kind === "legacy" || next.kind === "legacy") return [];
        const changes: BoardPermissionChange[] = [];
        for (const flag of Object.keys(this.permissions.flags) as (keyof BoardPermissionFlags)[]) {
            const from = this.permissions.flags[flag];
            const to = next.flags[flag];
            if (from === to) continue;
            const kind = from === false ? "added" : to === false ? "removed" : "level";
            changes.push({ flag, kind, from, to });
        }
        return changes;
    }

    compare(proposed: BoardGrantInput): BoardGrantComparison[] {
        const next = BoardGrant.asPermissions(proposed);
        const rows: BoardGrantComparison[] = [];
        if (this.permissions.kind === "legacy") rows.push({ item: { kind: "unrestricted" }, mark: next.kind === "legacy" ? "kept" : "removed" });
        const keys = this.permissions.kind === "flags" ? this.permissions.flags : next.kind === "flags" ? next.flags : undefined;
        if (keys) {
            for (const flag of Object.keys(keys) as (keyof BoardPermissionFlags)[]) {
                const from = this.permissions.kind === "flags" ? this.permissions.flags[flag] : false;
                const to = next.kind === "flags" ? next.flags[flag] : false;
                if (from !== false && from === to) {
                    rows.push({ item: { kind: "flag", flag, value: from }, mark: "kept" });
                    continue;
                }
                if (from !== false) rows.push({ item: { kind: "flag", flag, value: from }, mark: "removed" });
                if (to !== false) rows.push({ item: { kind: "flag", flag, value: to }, mark: "added" });
            }
        }
        if (next.kind === "legacy" && this.permissions.kind === "flags") rows.push({ item: { kind: "unrestricted" }, mark: "added" });
        return rows;
    }

    widensTo(proposed: BoardGrantInput): boolean {
        const next = BoardGrant.asPermissions(proposed);
        return this.permissions.kind !== next.kind
            || (this.permissions.kind === "legacy" && next.kind === "legacy" && next.service)
            || this.diff(next).some(({ kind }) => kind !== "removed");
    }

    reductionTo(proposed: BoardGrantInput): string[] | undefined {
        const next = BoardGrant.asPermissions(proposed);
        if (this.permissions.kind === "legacy" && next.kind === "legacy") {
            return this.permissions.service && !next.service ? ["service"] : undefined;
        }
        if (this.permissions.kind !== "flags" || next.kind !== "flags") return undefined;
        const reductions: string[] = [];
        for (const flag of Object.keys(this.permissions.flags) as (keyof BoardPermissionFlags)[]) {
            const oldValue = this.permissions.flags[flag];
            const newValue = next.flags[flag];
            if (oldValue === newValue) continue;
            const oldRank = typeof oldValue === "boolean" ? Number(oldValue) : permissionRank[String(oldValue)];
            const newRank = typeof newValue === "boolean" ? Number(newValue) : permissionRank[String(newValue)];
            if (newRank > oldRank) return undefined;
            reductions.push(`${flag}: ${oldValue} -> ${newValue}`);
        }
        return reductions.length ? reductions : undefined;
    }

    isDeclared(): boolean {
        return this.permissions.kind === "flags";
    }

    /** UI-only deprecation and transition check; enforcement must use permission methods or isDeclared(). */
    isLegacy(): boolean {
        return this.permissions.kind === "legacy";
    }

    toWire(): NormalizedBoardPermissions {
        return this.permissions;
    }

    clone(): NormalizedBoardPermissions {
        return this.permissions.kind === "legacy"
            ? { kind: "legacy", service: this.permissions.service }
            : { kind: "flags", flags: { ...this.permissions.flags } };
    }

    private static asPermissions(input: BoardGrantInput): NormalizedBoardPermissions {
        return input instanceof BoardGrant ? input.toWire() : input;
    }
}
