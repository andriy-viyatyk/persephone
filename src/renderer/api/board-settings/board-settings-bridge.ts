import { hasStableBoardIdentity, missingBoardIdentityFields } from "../../../shared/board/board-stable-identity";
import { boardSettingsIdentityMessage } from "../../../shared/board/board-settings-declarations";
import type { BoardSettingDeclaration, BoardSettingValue } from "../../../shared/board/board-settings-declarations";
import { readBoardManifest } from "../boards/board-manifest-io";
import { resolveBoardNamespace } from "../boards/board-namespace";
import { fpJoin, fpNormalizeForCompare } from "../../core/utils/file-path";
import { settings } from "../settings";
import { api } from "../../../ipc/renderer/api";
import { errMessage } from "../../../shared/utils";
import { SerialQueue } from "../../../shared/serial-queue";
import { boardSettings } from "./BoardSettingsStore";

/** Ensure the shared settings file and its external-edit watcher are ready. */
export function initializeBoardSettings(): Promise<void> {
    return boardSettings.initialize();
}

export interface BoardSettingsReply {
    result?: BoardSettingValue;
    error?: string;
}

const EXCALIDRAW_SETTINGS_NAMESPACE = "Persephone/Excalidraw";
const EXCALIDRAW_LIBRARY_SETTING_ID = "library-path";
const EXCALIDRAW_LIBRARY_MIGRATED_KEY = "boards.excalidraw-library-migrated";
let legacyExcalidrawLibraryPathMigration: Promise<void> | undefined;

function matchesType(value: BoardSettingValue, declaration: BoardSettingDeclaration): boolean {
    if (declaration.type === "enum") {
        return typeof value === "string" && declaration.options?.includes(value) === true;
    }
    return declaration.type === "string"
        ? typeof value === "string"
        : declaration.type === "boolean"
          ? typeof value === "boolean"
          : typeof value === "number" && Number.isFinite(value);
}

async function resolveDeclaration(
    boardRoot: string,
    id: string,
): Promise<{ namespace: string; declaration: BoardSettingDeclaration }> {
    const manifest = await readBoardManifest(boardRoot);
    const missing = missingBoardIdentityFields(manifest);
    if (missing.length > 0) throw new Error(boardSettingsIdentityMessage(missing));
    const declaration = manifest?.settings?.find((candidate) => candidate.id === id);
    if (!declaration) throw new Error(`Unknown or malformed board setting ${JSON.stringify(id)}.`);
    return { namespace: await resolveBoardNamespace(boardRoot), declaration };
}

function validateValue(value: BoardSettingValue, declaration: BoardSettingDeclaration): void {
    if (!matchesType(value, declaration)) {
        throw new Error(`Value for board setting ${JSON.stringify(declaration.id)} does not match type ${declaration.type}.`);
    }
}

/**
 * Whether a legacy path is the same folder the board already falls back to on its own.
 *
 * `assets/boards/excalidraw/index.html` resolves an empty `library-path` to
 * `<userData>/data/excalidraw-lib`, and the legacy draw editor created exactly that folder and
 * stored its absolute path. Importing it would pin a machine-specific path that means precisely
 * what empty already means — and a pinned absolute path is the one thing that stops board
 * settings surviving a reinstall elsewhere. Only a folder the user actually chose
 * is worth carrying over.
 */
async function isDefaultExcalidrawLibraryPath(legacyPath: string): Promise<boolean> {
    try {
        const userData = await api.getCommonFolder("userData");
        return fpNormalizeForCompare(legacyPath)
            === fpNormalizeForCompare(fpJoin(userData, "data", "excalidraw-lib"));
    } catch {
        // The fallback folder could not be resolved, so treat the path as user-chosen and import
        // it: importing a redundant path is undone with one Reset, losing a real one is not.
        return false;
    }
}

/**
 * One-time import of the pre-5.0.4 `drawing.library-path` into the board's own setting.
 *
 * "Already done" is an explicit settings flag rather than "the board setting has no stored
 * value", because those are not the same thing. Reset also leaves no stored value, so inferring
 * from it re-imports the legacy path on the next start and silently undoes the reset — and
 * because this runs once per process, the reset appears to hold until the app is restarted,
 * which is the worst possible moment to discover it did not.
 */
function migrateLegacyExcalidrawLibraryPath(
    namespace: string,
    declaration: BoardSettingDeclaration,
): Promise<void> {
    if (
        namespace !== EXCALIDRAW_SETTINGS_NAMESPACE
        || declaration.id !== EXCALIDRAW_LIBRARY_SETTING_ID
    ) return Promise.resolve();

    legacyExcalidrawLibraryPathMigration ??= (async () => {
        await settings.wait();
        if (settings.get(EXCALIDRAW_LIBRARY_MIGRATED_KEY)) return;

        // Never overwrite a value already in board settings — only an unset setting can be an
        // un-migrated one.
        if (await boardSettings.get(namespace, declaration.id) === undefined) {
            const legacyPath = settings.get<string | undefined>("drawing.library-path");
            if (
                typeof legacyPath === "string" && legacyPath.trim() !== ""
                && !await isDefaultExcalidrawLibraryPath(legacyPath)
            ) {
                await boardSettings.set(namespace, declaration.id, legacyPath);
            }
        }
        settings.set(EXCALIDRAW_LIBRARY_MIGRATED_KEY, true);
    })();

    return legacyExcalidrawLibraryPathMigration;
}

async function readEffectiveBoardSetting(
    boardRoot: string,
    id: string,
): Promise<BoardSettingValue> {
    const { namespace, declaration } = await resolveDeclaration(boardRoot, id);
    await migrateLegacyExcalidrawLibraryPath(namespace, declaration);
    const stored = await boardSettings.get(namespace, declaration.id);
    if (stored !== undefined) {
        validateValue(stored, declaration);
        return stored;
    }
    return declaration.default;
}

const requestQueue = new SerialQueue();

/** Serialized board-facing request entry point. The board transport accepts only `get`. */
export function resolveBoardSettingsRequest(
    boardRoot: string,
    method: "get",
    args: unknown[],
): Promise<BoardSettingsReply> {
    return requestQueue.run(async (): Promise<BoardSettingsReply> => {
        if (method !== "get") return { error: `Unknown settings method: ${String(method)}` };
        const id = args[0];
        if (typeof id !== "string" || id.trim().length === 0) {
            return { error: "Board setting id must be a non-empty string." };
        }
        try {
            return { result: await readEffectiveBoardSetting(boardRoot, id.trim()) };
        } catch (error: unknown) {
            return { error: errMessage(error, "Failed to read board setting.") };
        }
    });
}

/** Renderer-only effective read. Defaults are returned without being persisted. */
export function getBoardSetting(boardRoot: string, id: string): Promise<BoardSettingValue> {
    return requestQueue.run(() => readEffectiveBoardSetting(boardRoot, id.trim()));
}

/** Renderer-only mutation path for the future Settings page. */
export async function setBoardSetting(
    boardRoot: string,
    id: string,
    value: BoardSettingValue,
): Promise<void> {
    await requestQueue.run(async () => {
        const { namespace, declaration } = await resolveDeclaration(boardRoot, id);
        await migrateLegacyExcalidrawLibraryPath(namespace, declaration);
        validateValue(value, declaration);
        await boardSettings.set(namespace, declaration.id, value);
    });
}

/** Renderer-only reset path. Removing the stored key makes reads use the current default. */
export async function unsetBoardSetting(boardRoot: string, id: string): Promise<void> {
    await requestQueue.run(async () => {
        const { namespace, declaration } = await resolveDeclaration(boardRoot, id);
        await migrateLegacyExcalidrawLibraryPath(namespace, declaration);
        await boardSettings.unset(namespace, declaration.id);
    });
}

/** Subscribe one host frame to effective changes for its own board namespace. */
export function subscribeBoardSettings(
    boardRoot: string,
    callback: (change: { id: string; value: BoardSettingValue }) => void,
): () => void {
    return boardSettings.onChanged((change) => {
        void (async () => {
            const manifest = await readBoardManifest(boardRoot);
            if (!hasStableBoardIdentity(manifest)) return;
            const namespace = await resolveBoardNamespace(boardRoot);
            if (namespace !== change.namespace) return;
            const declaration = manifest?.settings?.find((candidate) => candidate.id === change.id);
            if (!declaration) return;
            const stored = await boardSettings.get(namespace, change.id);
            const value = stored === undefined ? declaration.default : stored;
            validateValue(value, declaration);
            callback({ id: change.id, value });
        })().catch((error: unknown) => {
            console.error("Failed to deliver board setting change:", errMessage(error));
        });
    });
}
