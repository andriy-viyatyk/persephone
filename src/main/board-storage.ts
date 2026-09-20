import fs from "node:fs";
import path from "node:path";
import type { BoardJsonValue } from "../ipc/board-bridge-channels";
import { errMessage } from "../shared/utils";
import { getDataFolder } from "./utils";
import { boardRootKey, normalizeBoardRoot } from "./board-root-key";

export type JsonValue = BoardJsonValue;
export type BoardStorageState = Record<string, JsonValue>;

export const MAX_BOARD_STORAGE_KEY_LENGTH = 256;
export const MAX_BOARD_STORAGE_DEPTH = 32;
export const MAX_BOARD_STORAGE_BYTES = 1024 * 1024;

const BOARD_STORAGE_FOLDER = "board-storage";
const STORE_FILE = "store.json";
const METADATA_FILE = "board.json";
const BOARD_KEY_PATTERN = /^[0-9a-f]{64}$/;

interface BoardStorageContext {
    boardRoot: string;
    boardKey: string;
    folderPath: string;
    storePath: string;
    metadataPath: string;
}

interface CachedBoardStorage {
    state: BoardStorageState;
}

/** The operation contract consumed by the future service adapter (US-1468). */
export interface BoardStorageOperationContract {
    get(key: string): Promise<JsonValue | undefined>;
    set(key: string, value: JsonValue): Promise<void>;
    delete(key: string): Promise<boolean>;
    keys(): Promise<string[]>;
}

const cache = new Map<string, CachedBoardStorage>();
const queues = new Map<string, Promise<void>>();

function errorCode(error: unknown): string | undefined {
    if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
    const code = error.code;
    return typeof code === "string" ? code : undefined;
}

function isPlainObject(value: object): boolean {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function invalidValue(message: string): never {
    throw new TypeError(`Invalid board storage value: ${message}.`);
}

function validateJsonValue(value: unknown, depth: number, ancestors: Set<object>): void {
    if (value === null || typeof value === "string" || typeof value === "boolean") return;
    if (typeof value === "number") {
        if (Number.isFinite(value)) return;
        invalidValue("numbers must be finite");
    }
    if (typeof value !== "object") invalidValue("only JSON values are supported");
    if (!Array.isArray(value) && !isPlainObject(value)) {
        invalidValue("objects must be plain objects");
    }
    if (depth >= MAX_BOARD_STORAGE_DEPTH) invalidValue(`nesting cannot exceed ${MAX_BOARD_STORAGE_DEPTH} levels`);
    if (ancestors.has(value)) invalidValue("cyclic values are not supported");

    ancestors.add(value);
    if (Array.isArray(value)) {
        for (const item of value) validateJsonValue(item, depth + 1, ancestors);
    } else {
        for (const [key, item] of Object.entries(value)) {
            if (key.length > MAX_BOARD_STORAGE_KEY_LENGTH) {
                invalidValue(`object keys cannot exceed ${MAX_BOARD_STORAGE_KEY_LENGTH} characters`);
            }
            validateJsonValue(item, depth + 1, ancestors);
        }
    }
    ancestors.delete(value);
}

function validateStore(value: unknown): BoardStorageState {
    if (typeof value !== "object" || value === null || Array.isArray(value) || !isPlainObject(value)) {
        throw new TypeError("Board storage must contain a JSON object at its root.");
    }
    validateJsonValue(value, 0, new Set());
    return value as BoardStorageState;
}

/** Validate and return a board storage key suitable for the key/value API. */
export function validateBoardStorageKey(key: unknown): string {
    if (typeof key !== "string") throw new TypeError("Board storage keys must be strings.");
    if (key.length > MAX_BOARD_STORAGE_KEY_LENGTH) {
        throw new RangeError(`Board storage keys cannot exceed ${MAX_BOARD_STORAGE_KEY_LENGTH} characters.`);
    }
    return key;
}

/** Validate and return a JSON value suitable for the key/value API. */
export function validateBoardStorageValue(value: unknown): JsonValue {
    validateJsonValue(value, 0, new Set());
    return value as JsonValue;
}

function cloneJsonValue(value: JsonValue): JsonValue {
    return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function contextForRoot(boardRoot: string): BoardStorageContext {
    const normalizedRoot = normalizeBoardRoot(boardRoot);
    const boardKey = boardRootKey(normalizedRoot);
    if (!BOARD_KEY_PATTERN.test(boardKey)) {
        throw new Error("Failed to derive a valid board storage key.");
    }

    const storageRoot = path.resolve(getDataFolder(), BOARD_STORAGE_FOLDER);
    const folderPath = path.resolve(storageRoot, boardKey);
    const relativePath = path.relative(storageRoot, folderPath);
    if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
        throw new Error("Invalid board storage path.");
    }

    return {
        boardRoot: normalizedRoot,
        boardKey,
        folderPath,
        storePath: path.join(folderPath, STORE_FILE),
        metadataPath: path.join(folderPath, METADATA_FILE),
    };
}

async function loadStore(context: BoardStorageContext): Promise<BoardStorageState> {
    const cached = cache.get(context.boardKey);
    if (cached) return cached.state;

    let content: string;
    try {
        content = await fs.promises.readFile(context.storePath, "utf8");
    } catch (error) {
        if (errorCode(error) === "ENOENT") {
            const empty: BoardStorageState = {};
            cache.set(context.boardKey, { state: empty });
            return empty;
        }
        throw new Error(`Failed to read board storage: ${errMessage(error)}`);
    }

    if (Buffer.byteLength(content, "utf8") > MAX_BOARD_STORAGE_BYTES) {
        throw new RangeError(`Board storage exceeds the ${MAX_BOARD_STORAGE_BYTES}-byte limit.`);
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(content);
    } catch (error) {
        throw new Error(`Board storage contains invalid JSON: ${errMessage(error)}`);
    }

    let state: BoardStorageState;
    try {
        state = validateStore(parsed);
    } catch (error) {
        throw new Error(`Board storage has an invalid structure: ${errMessage(error)}`);
    }
    cache.set(context.boardKey, { state });
    return state;
}

function serializeStore(state: BoardStorageState): string {
    validateStore(state);
    let content: string;
    try {
        content = JSON.stringify(state, null, 2);
    } catch (error) {
        throw new Error(`Board storage could not be serialized: ${errMessage(error)}`);
    }
    if (Buffer.byteLength(content, "utf8") > MAX_BOARD_STORAGE_BYTES) {
        throw new RangeError(`Board storage exceeds the ${MAX_BOARD_STORAGE_BYTES}-byte limit.`);
    }
    return content;
}

async function readManifestName(boardRoot: string): Promise<string | undefined> {
    try {
        const content = await fs.promises.readFile(path.join(boardRoot, "board-manifest.json"), "utf8");
        const manifest: unknown = JSON.parse(content);
        if (typeof manifest !== "object" || manifest === null || !isPlainObject(manifest)) return undefined;
        const name = (manifest as Record<string, unknown>).name;
        if (typeof name !== "string" || !name.trim()) return undefined;
        return name.trim();
    } catch {
        return undefined;
    }
}

async function ensureMetadata(context: BoardStorageContext): Promise<void> {
    try {
        await fs.promises.mkdir(context.folderPath, { recursive: true });
    } catch (error) {
        throw new Error(`Failed to create board storage: ${errMessage(error)}`);
    }

    try {
        const name = await readManifestName(context.boardRoot);
        const metadata = {
            boardRoot: context.boardRoot,
            name: name ?? path.basename(context.boardRoot),
            createdAt: new Date().toISOString(),
        };
        await fs.promises.writeFile(
            context.metadataPath,
            JSON.stringify(metadata, null, 2),
            { encoding: "utf8", flag: "wx" },
        );
    } catch (error) {
        if (errorCode(error) === "EEXIST") return;
        throw new Error(`Failed to create board storage metadata: ${errMessage(error)}`);
    }
}

async function persistStore(context: BoardStorageContext, state: BoardStorageState): Promise<void> {
    const content = serializeStore(state);
    await ensureMetadata(context);
    try {
        await fs.promises.writeFile(context.storePath, content, "utf8");
    } catch (error) {
        throw new Error(`Failed to persist board storage: ${errMessage(error)}`);
    }
}

function enqueue<T>(boardKey: string, operation: () => Promise<T>): Promise<T> {
    const previous = queues.get(boardKey) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    const tail: Promise<void> = result.then((): void => undefined, (): void => undefined);
    queues.set(boardKey, tail);
    void tail.then((): void => {
        if (queues.get(boardKey) === tail) queues.delete(boardKey);
    });
    return result;
}

/** Read a value from the main-owned store. Missing keys resolve to `undefined`. */
export async function getBoardStorageValue(boardRoot: string, key: string): Promise<JsonValue | undefined> {
    const context = contextForRoot(boardRoot);
    const validKey = validateBoardStorageKey(key);
    return enqueue(context.boardKey, async () => {
        const value = (await loadStore(context))[validKey];
        return value === undefined ? undefined : cloneJsonValue(value);
    });
}

/** Persist a value in the main-owned store before resolving. */
export async function setBoardStorageValue(boardRoot: string, key: string, value: JsonValue): Promise<void> {
    const context = contextForRoot(boardRoot);
    const validKey = validateBoardStorageKey(key);
    const validValue = cloneJsonValue(validateBoardStorageValue(value));
    return enqueue(context.boardKey, async () => {
        const current = await loadStore(context);
        const next: BoardStorageState = { ...current, [validKey]: validValue };
        await persistStore(context, next);
        cache.set(context.boardKey, { state: next });
    });
}

/** Delete a value and report whether the key existed. */
export async function deleteBoardStorageValue(boardRoot: string, key: string): Promise<boolean> {
    const context = contextForRoot(boardRoot);
    const validKey = validateBoardStorageKey(key);
    return enqueue(context.boardKey, async () => {
        const current = await loadStore(context);
        if (!Object.prototype.hasOwnProperty.call(current, validKey)) return false;
        const next: BoardStorageState = { ...current };
        delete next[validKey];
        await persistStore(context, next);
        cache.set(context.boardKey, { state: next });
        return true;
    });
}

/** Return the store's keys in sorted order. */
export async function getBoardStorageKeys(boardRoot: string): Promise<string[]> {
    const context = contextForRoot(boardRoot);
    return enqueue(context.boardKey, async () => Object.keys(await loadStore(context)).sort());
}

/** Bind the four storage operations to the trusted service registration's board root. */
export function createBoardStorageOperationContract(boardRoot: string): BoardStorageOperationContract {
    return {
        get: (key) => getBoardStorageValue(boardRoot, key),
        set: (key, value) => setBoardStorageValue(boardRoot, key, value),
        delete: (key) => deleteBoardStorageValue(boardRoot, key),
        keys: () => getBoardStorageKeys(boardRoot),
    };
}
