import type { BoardRpcSlice } from "./types";
import {
    deleteBoardStorageValue,
    getBoardStorageKeys,
    getBoardStorageValue,
    setBoardStorageValue,
    validateBoardStorageKey,
    validateBoardStorageValue,
} from "../../board-storage";

const handlers = {
storageGet: { handle: (entry, key) => getBoardStorageValue(entry.root, validateBoardStorageKey(key)) },
storageSet: { handle: (entry, key, value) => setBoardStorageValue(
        entry.root,
        validateBoardStorageKey(key),
        validateBoardStorageValue(value),
    ) },
storageDelete: { handle: (entry, key) => deleteBoardStorageValue(entry.root, validateBoardStorageKey(key)) },
storageKeys: { handle: (entry) => getBoardStorageKeys(entry.root) }
} satisfies BoardRpcSlice<StorageDomainKeys>;

export const storageHandlers = handlers;

export type StorageDomainKeys = "storageGet" | "storageSet" | "storageDelete" | "storageKeys";
