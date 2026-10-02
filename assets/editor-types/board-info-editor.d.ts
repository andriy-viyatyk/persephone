import type {
    IBoardCapabilityDeclaration,
    IBoardContentProviderDeclaration,
    IBoardSecondaryViewDeclaration,
    IBoardSettingDeclaration,
} from "./board-editor";

export type BoardInfoMode = "install" | "properties";

export type BoardInfoInstallState =
    | "available"
    | "downloading"
    | "error"
    | "downloaded"
    | "registered";

export type IBoardInfoContentProviderDeclaration = IBoardContentProviderDeclaration;
export type IBoardInfoCapabilityDeclaration = IBoardCapabilityDeclaration;

export interface IBoardInfoRegistrationIssue {
    readonly kind: "provider" | "scheme" | "capability" | "settings" | "browser-url-mask";
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
    readonly permissions?: import("../../../shared/board-manifest-utils").NormalizedBoardPermissions;
    readonly permissionLines?: readonly string[];
    readonly proposedPermissions?: import("../../../shared/board-manifest-utils").NormalizedBoardPermissions;
    readonly proposedPermissionLines?: readonly string[];
    readonly permissionChanges?: readonly { readonly flag: string; readonly kind: "added" | "removed" | "level"; readonly from?: boolean | string; readonly to?: boolean | string }[];
    readonly permissionChangePending?: boolean;
    readonly standalone?: boolean;
    readonly singleInstance?: boolean;
    readonly minAppVersion?: string;
    readonly minBridgeVersion?: string;
    readonly service?: string;
    readonly bridgeCompatibilityReason?: string;
    readonly fileMasks?: readonly string[];
    readonly browserUrlMasks?: readonly string[];
    readonly contentMasks?: readonly string[];
    readonly folderMasks?: readonly string[];
    /** Direct folder claims matching the folder itself; unlike `folderMasks`, not a file gate. */
    readonly folderEditorMasks?: readonly string[];
    /** Direct folder resolution priority for `folderEditorMasks`. */
    readonly folderEditorPriority?: number;
    readonly editorPriority?: number;
    readonly editorName?: string;
    readonly editorKind?: "simple" | "content-host" | "stream-host";
    readonly editorSources?: "local" | "any";
    readonly contentProviders?: readonly IBoardInfoContentProviderDeclaration[];
    readonly capabilities?: readonly IBoardInfoCapabilityDeclaration[];
    readonly settings?: readonly IBoardSettingDeclaration[];
    readonly secondaryViews?: readonly IBoardSecondaryViewDeclaration[];
    readonly guides?: string;
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
    /** Open the permission-change dialog for the current board without choosing its result. */
    reviewPermissionChange(): Promise<void>;
}
