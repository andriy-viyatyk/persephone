import { tsProjectRegistry } from "../ts-project-registry";
import type { McpCommandHandler, McpParams } from "./types";

function requireString(params: McpParams, key: "root" | "owner"): string {
    const value = params?.[key];
    if (typeof value !== "string" || !value) throw new Error(`Invalid TypeScript project request: ${key} is required.`);
    return value;
}

export const handleBoardRegisterTsProject: McpCommandHandler = async (params) => {
    await tsProjectRegistry.register(requireString(params, "root"), requireString(params, "owner"));
    return { result: null };
};

export const handleBoardUnregisterTsProject: McpCommandHandler = (params) => {
    tsProjectRegistry.unregister(requireString(params, "root"), requireString(params, "owner"));
    return { result: null };
};

export const handleBoardReleaseTsProjects: McpCommandHandler = (params) => {
    tsProjectRegistry.releaseOwner(requireString(params, "owner"));
    return { result: null };
};
