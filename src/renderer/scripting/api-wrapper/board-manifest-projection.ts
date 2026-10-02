import type {
    IBoardCapabilityDeclaration,
    IBoardContentProviderDeclaration,
    IBoardManifest,
    IBoardSecondaryViewDeclaration,
    IBoardSettingDeclaration,
} from "../../api/types/board-editor";
import type { NormalizedBoardManifest } from "../../editors/board/board-manifest";

/** Project a normalized manifest into the copied script API shape. */
export function projectBoardManifest(manifest: NormalizedBoardManifest): IBoardManifest | undefined {
    if (typeof manifest.schemaVersion !== "number") return undefined;
    const copy: Partial<MutableBoardManifest> = { schemaVersion: manifest.schemaVersion };
    if (typeof manifest.name === "string") copy.name = manifest.name;
    if (typeof manifest.description === "string") copy.description = manifest.description;
    if (typeof manifest.author === "string") copy.author = manifest.author;
    if (typeof manifest.repository === "string") copy.repository = manifest.repository;
    if (typeof manifest.version === "string") copy.version = manifest.version;
    if (typeof manifest.standalone === "boolean") copy.standalone = manifest.standalone;
    if (typeof manifest.minAppVersion === "string") copy.minAppVersion = manifest.minAppVersion;
    if (manifest.permissions !== undefined) {
        copy.permissions = manifest.permissions.kind === "legacy"
            ? { ...manifest.permissions }
            : { kind: "flags", flags: { ...manifest.permissions.flags } };
    }
    if (typeof manifest.minBridgeVersion === "string") copy.minBridgeVersion = manifest.minBridgeVersion;
    if (typeof manifest.service === "string") copy.service = manifest.service;
    if (manifest.singleInstance !== undefined) copy.singleInstance = manifest.singleInstance;
    if (manifest.contentProviders !== undefined) {
        copy.contentProviders = manifest.contentProviders.map(projectBoardContentProvider);
    }
    if (manifest.capabilities !== undefined) {
        copy.capabilities = manifest.capabilities.map(projectBoardCapability);
    }
    if (manifest.settings !== undefined) copy.settings = manifest.settings.map(projectBoardSetting);
    if (manifest.fileMasks !== undefined) copy.fileMasks = [...manifest.fileMasks];
    if (manifest.browserUrlMasks !== undefined) copy.browserUrlMasks = [...manifest.browserUrlMasks];
    if (manifest.contentMasks !== undefined) copy.contentMasks = [...manifest.contentMasks];
    if (manifest.folderMasks !== undefined) copy.folderMasks = [...manifest.folderMasks];
    if (manifest.folderEditorMasks !== undefined) copy.folderEditorMasks = [...manifest.folderEditorMasks];
    if (typeof manifest.folderEditorPriority === "number") copy.folderEditorPriority = manifest.folderEditorPriority;
    if (typeof manifest.editorPriority === "number") copy.editorPriority = manifest.editorPriority;
    if (typeof manifest.editorName === "string") copy.editorName = manifest.editorName;
    if (
        manifest.editorKind === "simple"
        || manifest.editorKind === "content-host"
        || manifest.editorKind === "stream-host"
    ) copy.editorKind = manifest.editorKind;
    if (manifest.editorSources === "local" || manifest.editorSources === "any") copy.editorSources = manifest.editorSources;
    if (manifest.secondaryViews !== undefined) {
        copy.secondaryViews = manifest.secondaryViews.map(projectBoardSecondaryView);
    }
    if (manifest.guides !== undefined) copy.guides = manifest.guides;
    return copy as IBoardManifest;
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
    options?: string[];
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

type MutableBoardManifest = {
    -readonly [Key in keyof IBoardManifest]: IBoardManifest[Key];
};

function cloneJson(value: unknown): unknown {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value)) as unknown;
}
