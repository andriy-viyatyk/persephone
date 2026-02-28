const path = require("path");
const nodefs = require("fs");

import { api } from "../../ipc/renderer/api";
import { nodeUtils } from "../core/utils/node-utils";
import { filesModel } from "../store/files-store";
import type { IFileSystem, ITextFile } from "./types/fs";

class FileSystem implements IFileSystem {
    // ── File I/O — simple ────────────────────────────────────────────

    async read(filePath: string, encoding?: string): Promise<string> {
        const result = nodeUtils.loadStringFile(filePath, encoding);
        return result.content;
    }

    // ── File I/O — full ──────────────────────────────────────────────

    async readFile(filePath: string, encoding?: string): Promise<ITextFile> {
        return nodeUtils.loadStringFile(filePath, encoding);
    }

    async readBinary(filePath: string): Promise<Buffer> {
        return nodefs.readFileSync(filePath);
    }

    async write(filePath: string, content: string, encoding?: string): Promise<void> {
        const dirPath = path.dirname(filePath);
        nodeUtils.preparePath(dirPath);
        nodeUtils.saveStringFile(filePath, content, encoding);
    }

    async writeBinary(filePath: string, data: Buffer): Promise<void> {
        const dirPath = path.dirname(filePath);
        nodeUtils.preparePath(dirPath);
        nodefs.writeFileSync(filePath, data);
    }

    async exists(filePath: string): Promise<boolean> {
        return nodeUtils.fileExists(filePath);
    }

    async delete(filePath: string): Promise<void> {
        nodeUtils.deleteFile(filePath);
    }

    // ── Path resolution ──────────────────────────────────────────────

    resolveDataPath(relativePath: string): string {
        const state = filesModel.state.get();
        const resolved = relativePath.replace(
            "{windowIndex}",
            String(state.windowIndex)
        );
        return path.join(state.dataPath, resolved);
    }

    resolveCachePath(relativePath: string): string {
        const state = filesModel.state.get();
        return path.join(state.cachePath, relativePath);
    }

    async commonFolder(name: string): Promise<string> {
        return api.getCommonFolder(name as any);
    }

    // ── Dialogs ──────────────────────────────────────────────────────

    async showOpenDialog(options?: {
        title?: string;
        defaultPath?: string;
        filters?: { name: string; extensions: string[] }[];
        multiSelect?: boolean;
    }): Promise<string[] | null> {
        const result = await api.showOpenFileDialog({
            title: options?.title,
            defaultPath: options?.defaultPath,
            filters: options?.filters,
            multiSelections: options?.multiSelect,
        });
        return result ?? null;
    }

    async showSaveDialog(options?: {
        title?: string;
        defaultPath?: string;
        filters?: { name: string; extensions: string[] }[];
    }): Promise<string | null> {
        const result = await api.showSaveFileDialog({
            title: options?.title,
            defaultPath: options?.defaultPath,
            filters: options?.filters,
        });
        return result ?? null;
    }

    async showFolderDialog(options?: {
        title?: string;
        defaultPath?: string;
    }): Promise<string[] | null> {
        const result = await api.showOpenFolderDialog({
            title: options?.title,
            defaultPath: options?.defaultPath,
        });
        return result ?? null;
    }

    // ── OS integration ───────────────────────────────────────────────

    showInExplorer(filePath: string): void {
        api.showItemInFolder(filePath);
    }

    showFolder(folderPath: string): void {
        api.showFolder(folderPath);
    }
}

export const fs = new FileSystem();
