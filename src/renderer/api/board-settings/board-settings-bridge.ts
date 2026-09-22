import {
    hasStableBoardIdentity,
    readBoardManifest,
} from "../../editors/board/board-manifest";
import { resolveBoardNamespace } from "../board-namespace";
import { errMessage } from "../../../shared/utils";
import { boardSettings } from "./BoardSettingsStore";
import type {
    BoardSettingDeclaration,
    BoardSettingType,
    BoardSettingValue,
} from "./types";

export interface BoardSettingsReply {
    result?: BoardSettingValue;
    error?: string;
}

type RawBoardSetting = {
    id?: unknown;
    type?: unknown;
    default?: unknown;
    options?: unknown;
    format?: unknown;
    label?: unknown;
    description?: unknown;
};

function isSettingValue(value: unknown): value is BoardSettingValue {
    return typeof value === "string"
        || typeof value === "boolean"
        || (typeof value === "number" && Number.isFinite(value));
}

function isType(value: unknown): value is BoardSettingType {
    return value === "string" || value === "boolean" || value === "number" || value === "enum";
}

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

function normalizeDeclaration(raw: unknown): BoardSettingDeclaration | undefined {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
    const candidate = raw as RawBoardSetting;
    const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
    if (!id || !isType(candidate.type) || !isSettingValue(candidate.default)) return undefined;
    const options = Array.isArray(candidate.options)
        ? candidate.options.filter((option): option is string => typeof option === "string" && option.length > 0)
        : undefined;
    const declaration: BoardSettingDeclaration = {
        id,
        type: candidate.type,
        default: candidate.default,
        ...(options && options.length > 0 ? { options: [...new Set(options)] } : {}),
        ...(typeof candidate.format === "string" && candidate.format.trim()
            ? { format: candidate.format.trim() }
            : {}),
        ...(typeof candidate.label === "string" ? { label: candidate.label } : {}),
        ...(typeof candidate.description === "string" ? { description: candidate.description } : {}),
    };
    if (declaration.type === "enum"
        && (!declaration.options || declaration.options.length === 0
            || !declaration.options.includes(declaration.default as string))) return undefined;
    return matchesType(declaration.default, declaration) ? declaration : undefined;
}

/** Shared declaration seam for the bridge and the later renderer Settings page. */
export function normalizeBoardSettings(manifest: unknown): BoardSettingDeclaration[] {
    if (!hasStableBoardIdentity(manifest as Parameters<typeof hasStableBoardIdentity>[0])) return [];
    const raw = manifest && typeof manifest === "object"
        ? (manifest as { settings?: unknown }).settings
        : undefined;
    if (!Array.isArray(raw)) return [];
    const declarations: BoardSettingDeclaration[] = [];
    const seen = new Set<string>();
    for (const candidate of raw) {
        const declaration = normalizeDeclaration(candidate);
        if (!declaration || seen.has(declaration.id)) continue;
        seen.add(declaration.id);
        declarations.push(declaration);
    }
    return declarations;
}

function missingIdentityFields(manifest: unknown): string[] {
    const candidate = manifest && typeof manifest === "object"
        ? manifest as { author?: unknown; name?: unknown }
        : {};
    const missing: string[] = [];
    if (typeof candidate.author !== "string" || candidate.author.trim().length === 0) missing.push("author");
    if (typeof candidate.name !== "string" || candidate.name.trim().length === 0) missing.push("name");
    return missing;
}

async function resolveDeclaration(
    boardRoot: string,
    id: string,
): Promise<{ namespace: string; declaration: BoardSettingDeclaration }> {
    const manifest = await readBoardManifest(boardRoot);
    if (!hasStableBoardIdentity(manifest)) {
        const missing = missingIdentityFields(manifest);
        throw new Error(`Board settings require a stable board identity; missing ${missing.join(" and ")}.`);
    }
    const declaration = normalizeBoardSettings(manifest).find((candidate) => candidate.id === id);
    if (!declaration) throw new Error(`Unknown or malformed board setting ${JSON.stringify(id)}.`);
    return { namespace: await resolveBoardNamespace(boardRoot), declaration };
}

function validateValue(value: BoardSettingValue, declaration: BoardSettingDeclaration): void {
    if (!matchesType(value, declaration)) {
        throw new Error(`Value for board setting ${JSON.stringify(declaration.id)} does not match type ${declaration.type}.`);
    }
}

let requestChain: Promise<unknown> = Promise.resolve();

/** Serialized board-facing request entry point. The board transport accepts only `get`. */
export function resolveBoardSettingsRequest(
    boardRoot: string,
    method: "get",
    args: unknown[],
): Promise<BoardSettingsReply> {
    const run = requestChain.then(async (): Promise<BoardSettingsReply> => {
        if (method !== "get") return { error: `Unknown settings method: ${String(method)}` };
        const id = args[0];
        if (typeof id !== "string" || id.trim().length === 0) {
            return { error: "Board setting id must be a non-empty string." };
        }
        try {
            const normalizedId = id.trim();
            const { namespace, declaration } = await resolveDeclaration(boardRoot, normalizedId);
            const stored = await boardSettings.get(namespace, normalizedId);
            if (stored !== undefined) {
                validateValue(stored, declaration);
                return { result: stored };
            }
            return { result: declaration.default };
        } catch (error: unknown) {
            return { error: errMessage(error, "Failed to read board setting.") };
        }
    });
    requestChain = run.then((): void => undefined, (): void => undefined);
    return run;
}

/** Renderer-only mutation path for the future Settings page. */
export async function setBoardSetting(
    boardRoot: string,
    id: string,
    value: BoardSettingValue,
): Promise<void> {
    const run = requestChain.then(async () => {
        const { namespace, declaration } = await resolveDeclaration(boardRoot, id);
        validateValue(value, declaration);
        await boardSettings.set(namespace, declaration.id, value);
    });
    requestChain = run.then((): void => undefined, (): void => undefined);
    await run;
}

/** Renderer-only reset path. Removing the stored key makes reads use the current default. */
export async function unsetBoardSetting(boardRoot: string, id: string): Promise<void> {
    const run = requestChain.then(async () => {
        const { namespace, declaration } = await resolveDeclaration(boardRoot, id);
        await boardSettings.unset(namespace, declaration.id);
    });
    requestChain = run.then((): void => undefined, (): void => undefined);
    await run;
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
            const declaration = normalizeBoardSettings(manifest).find((candidate) => candidate.id === change.id);
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
