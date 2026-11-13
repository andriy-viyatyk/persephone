import type {
    IBoardCapabilityDeclaration,
    IBoardContentProviderDeclaration,
    IBoardManifest,
    IBoardSecondaryViewDeclaration,
    IBoardSettingDeclaration,
    IBoardSettingOption,
} from "../../api/types/board-editor";
import { isBoardEditorKind, type NormalizedBoardManifest } from "../../../shared/board/board-manifest-schema";
import { BoardGrant } from "../../../shared/board/board-grant";

type BoardManifestFieldsSource = Partial<Pick<NormalizedBoardManifest,
    | "name"
    | "description"
    | "author"
    | "repository"
    | "standalone"
    | "minAppVersion"
    | "permissions"
    | "minBridgeVersion"
    | "service"
    | "singleInstance"
    | "singleInstanceMasks"
    | "contentProviders"
    | "capabilities"
    | "settings"
    | "fileMasks"
    | "browserUrlMasks"
    | "contentMasks"
    | "folderMasks"
    | "folderEditorMasks"
    | "folderEditorPriority"
    | "editorPriority"
    | "editorName"
    | "editorKind"
    | "editorSources"
    | "secondaryViews"
    | "guides"
>>;

/** Project a normalized manifest into the copied script API shape. */
export function projectBoardManifest(manifest: NormalizedBoardManifest): IBoardManifest | undefined {
    if (typeof manifest.schemaVersion !== "number") return undefined;
    const fields = projectBoardManifestFields(manifest);
    return {
        schemaVersion: manifest.schemaVersion,
        ...copyDefined(fields, ["name", "description", "author", "repository"]),
        ...(typeof manifest.version === "string" ? { version: manifest.version } : {}),
        ...copyDefined(fields, [
            "standalone", "minAppVersion", "permissions", "minBridgeVersion", "service",
            "singleInstance", "singleInstanceMasks", "contentProviders", "capabilities", "settings",
            "fileMasks", "browserUrlMasks", "contentMasks", "folderMasks", "folderEditorMasks",
            "folderEditorPriority", "editorPriority", "editorName", "editorKind", "editorSources",
            "secondaryViews", "guides",
        ]),
    } as IBoardManifest;
}

/** Project the manifest fields shared by the full manifest and Board Info properties shapes. */
export function projectBoardManifestFields(source: BoardManifestFieldsSource): Partial<BoardManifestFieldsSource> {
    const copy: Partial<BoardManifestFieldsSource> = {};
    if (typeof source.name === "string") Object.assign(copy, { name: source.name });
    if (typeof source.description === "string") Object.assign(copy, { description: source.description });
    if (typeof source.author === "string") Object.assign(copy, { author: source.author });
    if (typeof source.repository === "string") Object.assign(copy, { repository: source.repository });
    if (typeof source.standalone === "boolean") Object.assign(copy, { standalone: source.standalone });
    if (typeof source.minAppVersion === "string") Object.assign(copy, { minAppVersion: source.minAppVersion });
    if (source.permissions !== undefined) {
        Object.assign(copy, { permissions: BoardGrant.from(source.permissions).clone() });
    }
    if (typeof source.minBridgeVersion === "string") Object.assign(copy, { minBridgeVersion: source.minBridgeVersion });
    if (typeof source.service === "string") Object.assign(copy, { service: source.service });
    if (source.singleInstance !== undefined) Object.assign(copy, { singleInstance: source.singleInstance });
    if (source.singleInstanceMasks !== undefined) Object.assign(copy, { singleInstanceMasks: [...source.singleInstanceMasks] });
    if (source.contentProviders !== undefined) {
        Object.assign(copy, { contentProviders: source.contentProviders.map(projectBoardContentProvider) });
    }
    if (source.capabilities !== undefined) {
        Object.assign(copy, { capabilities: source.capabilities.map(projectBoardCapability) });
    }
    if (source.settings !== undefined) Object.assign(copy, { settings: source.settings.map(projectBoardSetting) });
    if (source.fileMasks !== undefined) Object.assign(copy, { fileMasks: [...source.fileMasks] });
    if (source.browserUrlMasks !== undefined) Object.assign(copy, { browserUrlMasks: [...source.browserUrlMasks] });
    if (source.contentMasks !== undefined) Object.assign(copy, { contentMasks: [...source.contentMasks] });
    if (source.folderMasks !== undefined) Object.assign(copy, { folderMasks: [...source.folderMasks] });
    if (source.folderEditorMasks !== undefined) Object.assign(copy, { folderEditorMasks: [...source.folderEditorMasks] });
    if (typeof source.folderEditorPriority === "number") Object.assign(copy, { folderEditorPriority: source.folderEditorPriority });
    if (typeof source.editorPriority === "number") Object.assign(copy, { editorPriority: source.editorPriority });
    if (typeof source.editorName === "string") Object.assign(copy, { editorName: source.editorName });
    if (isBoardEditorKind(source.editorKind)) Object.assign(copy, { editorKind: source.editorKind });
    if (source.editorSources === "local" || source.editorSources === "any") {
        Object.assign(copy, { editorSources: source.editorSources });
    }
    if (source.secondaryViews !== undefined) {
        Object.assign(copy, { secondaryViews: source.secondaryViews.map(projectBoardSecondaryView) });
    }
    if (source.guides !== undefined) Object.assign(copy, { guides: source.guides });
    return copy;
}

export function projectBoardCapability(capability: {
    id: string;
    representation?: string;
    version?: number;
    priority?: number;
    accepts?: string[];
    payloadSchema?: unknown;
    title?: string;
    headless?: boolean;
    alwaysOpensNewPage?: boolean;
}): IBoardCapabilityDeclaration {
    return {
        id: capability.id,
        ...(capability.representation !== undefined ? { representation: capability.representation } : {}),
        ...(capability.version !== undefined ? { version: capability.version } : {}),
        ...(capability.priority !== undefined ? { priority: capability.priority } : {}),
        ...(capability.accepts !== undefined ? { accepts: [...capability.accepts] } : {}),
        ...(Object.prototype.hasOwnProperty.call(capability, "payloadSchema")
            ? { payloadSchema: cloneJson(capability.payloadSchema) }
            : {}),
        ...(capability.title !== undefined ? { title: capability.title } : {}),
        ...(capability.headless !== undefined ? { headless: capability.headless } : {}),
        ...(capability.alwaysOpensNewPage !== undefined
            ? { alwaysOpensNewPage: capability.alwaysOpensNewPage }
            : {}),
    };
}

export function projectBoardContentProvider(provider: {
    type: string;
    schemes?: string[];
}): IBoardContentProviderDeclaration {
    return { type: provider.type, schemes: provider.schemes ? [...provider.schemes] : [] };
}

export function projectBoardSetting(setting: {
    id: string;
    type: "string" | "boolean" | "number" | "enum";
    default: string | boolean | number;
    options?: (string | IBoardSettingOption)[];
    format?: string;
    label?: string;
    description?: string;
}): IBoardSettingDeclaration {
    return { ...setting, ...(setting.options ? { options: [...setting.options] } : {}) };
}

export function projectBoardSecondaryView(view: {
    id: string;
    html?: string;
    title?: string;
}): IBoardSecondaryViewDeclaration {
    return {
        id: view.id,
        ...(typeof view.html === "string" ? { html: view.html } : {}),
        ...(typeof view.title === "string" ? { title: view.title } : {}),
    };
}

function copyDefined<T extends object, K extends keyof T>(source: T, keys: readonly K[]): Partial<Pick<T, K>> {
    const copy: Partial<Pick<T, K>> = {};
    for (const key of keys) {
        if (source[key] !== undefined) Object.assign(copy, { [key]: source[key] });
    }
    return copy;
}

function cloneJson(value: unknown): unknown {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value)) as unknown;
}
