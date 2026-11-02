import { app } from "../app";
import type { McpCommandHandler } from "./types";

export const handleBoardOpenBoard: McpCommandHandler = async (params) => {
    if (!params || typeof params.folder !== "string" || !params.folder.trim()) {
        throw new Error("Invalid board openBoard request.");
    }
    await app.boards.openBoard(params.folder);
    return { result: null };
};
