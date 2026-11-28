import { isValidBoardTreePath } from "./board-tree-path";

export type BoardTreeJsonValue = null | string | boolean | number | BoardTreeJsonValue[] | { [key: string]: BoardTreeJsonValue };

export interface BoardOpenTreeRequest {
    type: string;
    config?: BoardTreeJsonValue;
    rootPath: string;
    title?: string;
}

export interface BoardRefreshTreeRequest {
    type: string;
    config?: BoardTreeJsonValue;
    rootPath?: string;
}

/** Accept JSON data only, rejecting cycles, undefined values, class instances and non-finite numbers. */
export function isBoardTreeJsonValue(value: unknown, ancestors = new Set<object>()): value is BoardTreeJsonValue {
    if (value === null || typeof value === "string" || typeof value === "boolean") return true;
    if (typeof value === "number") return Number.isFinite(value);
    if (typeof value !== "object") return false;
    if (ancestors.has(value)) return false;
    ancestors.add(value);
    const valid = Array.isArray(value)
        ? value.every((item) => isBoardTreeJsonValue(item, ancestors))
        : Object.getPrototypeOf(value) === Object.prototype
            && Object.values(value).every((item) => isBoardTreeJsonValue(item, ancestors));
    ancestors.delete(value);
    return valid;
}

export function isBoardOpenTreeRequest(value: unknown): value is BoardOpenTreeRequest {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
    const request = value as Record<string, unknown>;
    return typeof request.type === "string" && request.type.trim().length > 0
        && isValidBoardTreePath(request.rootPath)
        && (request.config === undefined || isBoardTreeJsonValue(request.config))
        && (request.title === undefined || (typeof request.title === "string" && request.title.trim().length > 0));
}

export function isBoardRefreshTreeRequest(value: unknown): value is BoardRefreshTreeRequest {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
    const request = value as Record<string, unknown>;
    return typeof request.type === "string" && request.type.trim().length > 0
        && (request.rootPath === undefined || isValidBoardTreePath(request.rootPath))
        && (request.config === undefined || isBoardTreeJsonValue(request.config));
}
