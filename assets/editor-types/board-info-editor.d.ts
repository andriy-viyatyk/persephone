export type BoardInfoMode = "install" | "properties";

export type BoardInfoInstallState =
    | "available"
    | "downloading"
    | "error"
    | "downloaded"
    | "registered";

export interface IBoardInfoContentProviderDeclaration {
    readonly type: string;
    readonly schemes?: readonly string[];
}

export interface IBoardInfoCapabilityDeclaration {
    readonly id: string;
    readonly version?: number;
    readonly priority?: number;
    readonly accepts?: readonly string[];
    readonly payloadSchema?: unknown;
    readonly title?: string;
    readonly headless?: boolean;
}

export interface IBoardInfoRegistrationIssue {
    readonly kind: "provider" | "scheme" | "capability";
    readonly name: string;
    readonly reason: string;
    readonly owner?: string;
}

/** A copied catalog record shown by Board Info. Archive URL and hash are intentionally absent. */
export interface IBoardInfoCatalogMatch {
    readonly id: string;
    readonly version: string;
    readonly name: string;
    readonly description?: string;
    readonly fileMasks?: readonly string[];
    readonly folderMasks?: readonly string[];
    /** Direct folder claims matching the folder itself; unlike `folderMasks`, not a file gate. */
    readonly folderEditorMasks?: readonly string[];
    /** Direct folder resolution priority for `folderEditorMasks`. */
    readonly folderEditorPriority?: number;
    readonly editorName?: string;
    readonly editorKind?: "simple" | "content-host" | "stream-host";
    readonly standalone?: boolean;
    readonly minAppVersion?: string;
    readonly screenshotUrl?: string;
    readonly size: number;
    readonly installState: BoardInfoInstallState;
    readonly root?: string;
    readonly received?: number;
    readonly total?: number;
    readonly error?: string;
}

/** Copied properties metadata; absent manifest and association fields remain omitted. */
export interface IBoardInfoProperties {
    readonly name: string;
    readonly description?: string;
    readonly author?: string;
    readonly repository?: string;
    readonly manifestVersion?: string;
    readonly permissions?: readonly string[];
    readonly minBridgeVersion?: string;
    readonly service?: string;
    readonly bridgeCompatibilityReason?: string;
    readonly fileMasks?: readonly string[];
    readonly folderMasks?: readonly string[];
    /** Direct folder claims matching the folder itself; unlike `folderMasks`, not a file gate. */
    readonly folderEditorMasks?: readonly string[];
    /** Direct folder resolution priority for `folderEditorMasks`. */
    readonly folderEditorPriority?: number;
    readonly editorName?: string;
    readonly editorKind?: "simple" | "content-host" | "stream-host";
    readonly contentProviders?: readonly IBoardInfoContentProviderDeclaration[];
    readonly capabilities?: readonly IBoardInfoCapabilityDeclaration[];
    readonly registrationIssues?: readonly IBoardInfoRegistrationIssue[];
    readonly root: string;
    readonly trusted: boolean;
    readonly isCatalogInstall: boolean;
    readonly catalogId?: string;
    readonly installedVersion?: string;
    readonly missing?: boolean;
}

/** A copied published version, with compatibility and installed status for this board. */
export interface IBoardInfoVersion {
    readonly version: string;
    readonly date?: string;
    readonly notes?: string;
    readonly minAppVersion?: string;
    readonly compatible: boolean;
    readonly installed: boolean;
}

/**
 * Typed Board Info state and its two screen-local actions.
 *
 * `matches` is always a real snapshot array. `properties` is absent outside a loaded board,
 * while `versions` is absent until a catalog version history succeeds; a successful empty history
 * is represented by `versions: []`. `versionsState` is absent when no catalog history applies.
 */
export interface IBoardInfoEditor {
    readonly id: "board-info";
    readonly name: string;
    readonly mode: BoardInfoMode;
    readonly matches: readonly IBoardInfoCatalogMatch[];
    readonly installDir: string | undefined;
    readonly properties: IBoardInfoProperties | undefined;
    readonly versions: readonly IBoardInfoVersion[] | undefined;
    readonly versionsState: "idle" | "loading" | "error" | undefined;
    changeInstallDir(): Promise<void>;
    cancelDownload(catalogId: string): void;
}
