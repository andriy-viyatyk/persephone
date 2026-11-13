import { EditorFacadeBase } from "./EditorFacadeBase";
import type {
    IBoardInfoCatalogMatch,
    IBoardInfoEditor,
    IBoardInfoProperties,
    IBoardInfoVersion,
} from "../../api/types/board-info-editor";
import type { BoardInfoEditorModel } from "../../editors/board-info/BoardInfoEditorModel";
import { boardRegistry } from "../../api/boards/board-registry";
import { requestBoardTrust } from "../../api/boards/request-board-trust";
import { boardPermissionLines, FULL_ACCESS_DETAIL } from "../../api/boards/board-permission-copy";
import { BoardGrant } from "../../../shared/board/board-grant";
import type { BoardEditorKind } from "../../../shared/board/board-manifest-schema";
// After Phase 2 extraction, UI consumers use t(key) and agent-facing output uses englishMessage(key) with the same catalog key.
import { publishedBoards } from "../../api/boards/published-boards";
import { compareVersions } from "../../../shared/version-utils";
import type { IAiElementDeclaration, IAiMember, IAiVisible, IAiVisionDescriptor } from "ai-vision";
import {
    projectBoardManifestFields,
} from "./board-manifest-projection";

const BOARD_INFO_ELEMENTS: readonly IAiElementDeclaration[] = [
    { name: "board-info-browse", purpose: "Locate the install-location folder picker.", where: "install mode, beside the install-location field" },
    { name: "board-info-download", purpose: "Locate all matching catalog Download controls.", where: "on each catalog board tile, beside its details" },
    { name: "board-info-cancel", purpose: "Locate the active archive download's Cancel control.", where: "on the active downloading board tile" },
    { name: "board-info-retry", purpose: "Locate a failed catalog download's Retry control.", where: "on a failed catalog board tile" },
    { name: "board-info-register", purpose: "Locate the downloaded board Register board control.", where: "on a downloaded board tile" },
    { name: "board-info-delete", purpose: "Locate Delete download for an unregistered archive.", where: "on a downloaded unregistered board tile, beside Register board" },
    { name: "board-info-open", purpose: "Locate Open board in properties mode.", where: "properties mode, board action row" },
    { name: "board-info-uninstall", purpose: "Locate the catalog-install Uninstall control.", where: "properties mode, board action row for a catalog install" },
    { name: "board-info-unregister", purpose: "Locate the local-board Unregister control.", where: "properties mode, board action row for a local board" },
    { name: "board-info-versions-retry", purpose: "Locate Retry when published version history failed.", where: "published versions section, when loading failed" },
    { name: "board-info-version-install", purpose: "Locate repeated Update/Install version controls for update or rollback.", where: "on each published version row" },
];

const BOARD_INFO_MEMBERS: readonly IAiMember[] = [


    { name: "mode", kind: "property", summary: "Model-backed install or properties mode." },
    { name: "matches", kind: "property", summary: "Fresh catalog match snapshots with install, download, and trust status." },
    { name: "installDir", kind: "property", summary: "The selected parent directory for catalog downloads, or undefined before it is established." },
    { name: "properties", kind: "property", summary: "A copied installed-board snapshot. permissions is the main-owned GRANTED set; proposedPermissions and permissionChanges describe the live manifest separately." },
    { name: "reviewPermissionChange", kind: "method", signature: "reviewPermissionChange(): Promise<void>", summary: "Open the current board's permission-change dialog; this action does not choose or accept it." },
    { name: "versions", kind: "property", summary: "Copied published version snapshots, undefined until history loads successfully." },
    { name: "versionsState", kind: "property", summary: "Published-version loading state, or undefined when version history does not apply." },
    { name: "changeInstallDir", kind: "method", signature: "changeInstallDir(): Promise<void>", summary: "Open the native install-location folder picker and retain its selected directory." },
    { name: "setInstallDir", kind: "method", signature: "setInstallDir(dir: string): void", summary: "Set the install directory to an explicit filesystem path; installDir remains readable." },
    { name: "cancelDownload", kind: "method", signature: "cancelDownload(catalogId: string): void", summary: "Cancel the model-owned archive download after validating its current catalog id." },
];

const BOARD_INFO_HELP = `Access via pages[i].editor after narrowing editor.id to "board-info".
This model-backed facade reports the Board Info install/properties surface and its eleven curated
page-scoped controls. mode is "install" until the model has state.boardRoot, then "properties";
the facade never reads BoardInfoEditorView, page text, or the DOM to calculate state.

matches, properties, and versions are fresh snapshots. matches includes catalog metadata, archive
size, and the visible available/downloading/error/downloaded/registered state, but never archive
URLs, hashes, or live model objects. properties recalculates trusted from the app trust registry.
versions is undefined until a catalog history succeeds, and [] means a successful empty history;
versionsState is undefined when catalog history does not apply. installDir is the selected download
parent; setInstallDir(dir) selects an explicit filesystem path and changeInstallDir() opens the native
folder picker. Displayed paths remain real and copyable. cancelDownload(catalogId)
delegates to the model's private board-install cancellation path and rejects ids not in current
matches; a valid id without an active download remains idempotent.

The screen's lifecycle actions remain on boards.*: use boards.downloadPublished(match.id, { dir:
installDir }) to download, boards.registerBoard(properties.root) to register, and
boards.openBoard(properties.root) to open. Use boards.getPublishedVersions(properties.catalogId)
for a read-only refresh, boards.checkPublishedUpdates() followed by
boards.installPublished(properties.catalogId, { version }) for update or rollback,
boards.uninstallBoard(properties.catalogId) for catalog uninstall/delete, and
boards.unregisterBoard(properties.root) for local unregister. The visible
board-info-version-install controls only locate Update/Install buttons; this facade adds no
update, rollback, installBoardVersion, download, register, uninstall, unregister, deleteDownload,
or openBoard member.

Downloading is inert and untrusted. Registration is the only trust-granting step and remains the
user click through "Trust this board?"; no facade method accepts or returns a trust decision, calls
boardRegistry.trust(), or bypasses that dialog. The separate environment-variable namespace collision
confirmation follows the trust prompt. All renderer dialog answers are made through the live
dialogs[0] adapter: this includes Trust this board?, the namespace-collision dialog, and generic
confirmations titled "Folder already exists", "Remove board", "Delete board", and "Board is open".
Trust this board? is implemented by src/renderer/ui/dialogs/TrustBoardDialog.ts and answered by
src/renderer/scripting/ai-vision/dialogs/trust-board.ts; the namespace-collision dialog uses the
NamespaceCollisionDialog adapter at src/renderer/scripting/ai-vision/dialogs/namespace-collision.ts;
and those generic confirmations use src/renderer/scripting/ai-vision/dialogs/confirmation.ts. The
install-location picker from fs.showFolderDialog() is native and is not a dialogs[0] entry; progress
displays are not trust decisions.

pages[i].content already returns the adopted file host's text, or "" without a host; this facade
adds no content or host getter. Board variables remain a separate credential surface:
app.boardVars.get() and the board-side persephone.var.get path already return values, list() returns
names, and this facade adds no value, setter, .env, or password path. Existing boards.* members
remain the lifecycle action paths; this facade only owns the folder picker and download cancellation.`;

function projectPermissionLines(permissions: NonNullable<IBoardInfoProperties["permissions"]>): string[] {
    return boardPermissionLines(BoardGrant.from(permissions)).flatMap(({ text, fullAccess }) =>
        fullAccess ? [text, "Full access", FULL_ACCESS_DETAIL] : [text]);
}

function copyDefined<T extends object, K extends keyof T>(source: T, keys: readonly K[]): Partial<Pick<T, K>> {
    const copy: Partial<Pick<T, K>> = {};
    for (const key of keys) {
        if (source[key] !== undefined) Object.assign(copy, { [key]: source[key] });
    }
    return copy;
}

export class BoardInfoEditorFacade extends EditorFacadeBase<BoardInfoEditorModel> implements IAiVisible, IBoardInfoEditor {
    constructor(
        private readonly editor: BoardInfoEditorModel,
        readonly id: "board-info",
        readonly name: string,
    ) {
        super(id, name);
        this.setEditor(editor);
    }

    get aiVision(): IAiVisionDescriptor {
        return this.describeEditor({
            kind: "BoardInfoEditor",
            summary: "Model-backed Board Info catalog, install, properties, and version facade.",
            members: BOARD_INFO_MEMBERS,
            identitySummaries: { id: "The concrete editor id: board-info.", name: "The editor's registry display name." },
            identityIndex: 0,
            help: BOARD_INFO_HELP,
            elements: BOARD_INFO_ELEMENTS,
            highlightOptions: { all: true },
            summarize: () => this.aiSummary(),
        });
    }

    get mode(): "install" | "properties" {
        return this.editor.mode;
    }

    get matches(): readonly IBoardInfoCatalogMatch[] {
        const state = this.editor.state.get();
        return state.matches.map((entry) => this.copyMatch(entry));
    }

    get installDir(): string | undefined {
        return this.editor.state.get().installDir;
    }

    get properties(): IBoardInfoProperties | undefined {
        const properties = this.editor.state.get().props;
        if (!properties) return undefined;
        const projected = projectBoardManifestFields(properties);
        return {
            name: projected.name ?? properties.name,
            ...copyDefined(projected, ["description", "author", "repository"]),
            ...copyDefined(properties, ["manifestVersion"]),
            ...(properties.permissions !== undefined
                ? {
                    permissions: projected.permissions ?? BoardGrant.from(properties.permissions).clone(),
                    permissionLines: projectPermissionLines(properties.permissions),
                }
                : {}),
            ...(properties.proposedPermissions !== undefined
                ? {
                    proposedPermissions: BoardGrant.from(properties.proposedPermissions).clone(),
                    proposedPermissionLines: projectPermissionLines(properties.proposedPermissions),
                }
                : {}),
            ...(properties.permissionChanges !== undefined
                ? { permissionChanges: properties.permissionChanges.map((change) => ({ ...change })) }
                : {}),
            ...copyDefined(properties, ["permissionChangePending"]),
            ...copyDefined(projected, ["standalone"]),
            ...copyDefined(projected, ["singleInstance", "singleInstanceMasks"]),
            ...copyDefined(projected, ["minAppVersion", "minBridgeVersion", "service"]),
            ...copyDefined(properties, ["bridgeCompatibilityReason"]),
            ...copyDefined(projected, [
                "fileMasks", "browserUrlMasks", "contentMasks", "folderMasks", "folderEditorMasks",
                "folderEditorPriority", "editorPriority", "editorName", "editorKind", "editorSources",
            ]),
            ...copyDefined(projected, ["contentProviders", "capabilities", "settings", "secondaryViews", "guides"]),
            ...(properties.registrationIssues !== undefined
                ? {
                    registrationIssues: properties.registrationIssues.map((issue) => ({
                        kind: issue.kind,
                        name: issue.name,
                        reason: issue.reason,
                        ...(issue.owner !== undefined ? { owner: issue.owner } : {}),
                    })),
                }
                : {}),
            root: properties.root,
            trusted: properties.missing ? false : boardRegistry.isTrusted(properties.root),
            isCatalogInstall: properties.isCatalogInstall,
            ...copyDefined(properties, ["catalogId", "installedVersion", "missing"]),
        };
    }

    get versions(): readonly IBoardInfoVersion[] | undefined {
        const state = this.editor.state.get();
        if (!state.versions) return undefined;
        const installedVersion = state.props?.installedVersion;
        return state.versions.map((version) => ({
            version: version.version,
            ...(version.date !== undefined ? { date: version.date } : {}),
            ...(version.notes !== undefined ? { notes: version.notes } : {}),
            ...(version.minAppVersion !== undefined ? { minAppVersion: version.minAppVersion } : {}),
            compatible: publishedBoards.isCompatible(version.minAppVersion),
            installed: installedVersion !== undefined
                && compareVersions(installedVersion, version.version) === 0,
        }));
    }

    get versionsState(): "idle" | "loading" | "error" | undefined {
        return this.editor.state.get().versionsState;
    }

    changeInstallDir(): Promise<void> {
        return this.editor.changeInstallDir();
    }

    setInstallDir(dir: string): void {
        this.editor.setInstallDir(dir);
    }

    async reviewPermissionChange(): Promise<void> {
        const root = this.editor.state.get().props?.root;
        if (root) await requestBoardTrust(root);
    }

    cancelDownload(catalogId: string): void {
        const matches = this.editor.state.get().matches;
        const entry = matches.find((match) => match.id === catalogId);
        if (!entry) {
            const validIds = matches.map((match) => match.id).join(", ") || "(none)";
            throw new Error(
                `Unknown Board Info catalog id ${JSON.stringify(catalogId)}. Valid ids: ${validIds}.`,
            );
        }
        this.editor.cancelDownload(entry);
    }

    private copyMatch(
        entry: {
            id: string;
            version: string;
            name: string;
            description?: string;
            fileMasks?: string[];
            folderMasks?: string[];
            folderEditorMasks?: string[];
            folderEditorPriority?: number;
            editorName?: string;
            editorKind?: BoardEditorKind;
            standalone?: boolean;
            minAppVersion?: string;
            screenshotUrl?: string;
            archive: { size: number };
        },
    ): IBoardInfoCatalogMatch {
        const status = this.editor.installStateOf(entry);

        return {
            id: entry.id,
            version: entry.version,
            name: entry.name,
            ...(entry.description !== undefined ? { description: entry.description } : {}),
            ...(entry.fileMasks !== undefined ? { fileMasks: [...entry.fileMasks] } : {}),
            ...(entry.folderMasks !== undefined ? { folderMasks: [...entry.folderMasks] } : {}),
            ...(entry.folderEditorMasks !== undefined
                ? { folderEditorMasks: [...entry.folderEditorMasks] }
                : {}),
            ...(entry.folderEditorPriority !== undefined
                ? { folderEditorPriority: entry.folderEditorPriority }
                : {}),
            ...(entry.editorName !== undefined ? { editorName: entry.editorName } : {}),
            ...(entry.editorKind !== undefined ? { editorKind: entry.editorKind } : {}),
            ...(entry.standalone !== undefined ? { standalone: entry.standalone } : {}),
            ...(entry.minAppVersion !== undefined ? { minAppVersion: entry.minAppVersion } : {}),
            ...(entry.screenshotUrl !== undefined ? { screenshotUrl: entry.screenshotUrl } : {}),
            size: entry.archive.size,
            installState: status.installState,
            ...(status.root !== undefined ? { root: status.root } : {}),
            ...(status.received !== undefined ? { received: status.received } : {}),
            ...(status.total !== undefined ? { total: status.total } : {}),
            ...(status.error !== undefined ? { error: status.error } : {}),
        };
    }

    private aiSummary(): Record<string, unknown> {
        const state = this.editor.state.get();
        const summary: Record<string, unknown> = {
            kind: "BoardInfoEditor",
            id: this.id,
            name: this.name,
            mode: this.mode,
            matchCount: state.matches.length,
            propertiesPresent: state.props !== undefined,
        };
        if (state.installDir !== undefined) summary.installDir = state.installDir;
        if (state.versionsState !== undefined) summary.versionsState = state.versionsState;
        return summary;
    }
}
