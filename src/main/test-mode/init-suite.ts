import { app } from "electron";
import fs from "node:fs/promises";
import { constants as fsConstants, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { errMessage } from "../../shared/utils";
import { getAssetPath } from "../utils";

async function listFiles(directory: string, root = directory): Promise<string[]> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) files.push(...await listFiles(entryPath, root));
        else if (entry.isFile()) files.push(path.relative(root, entryPath));
    }
    return files;
}

async function listConflicts(destination: string, templateFiles: string[]): Promise<string[]> {
    const conflicts = new Set<string>();
    for (const relativePath of templateFiles) {
        const segments = relativePath.split(path.sep);
        let currentPath = destination;
        for (let index = 0; index < segments.length; index += 1) {
            currentPath = path.join(currentPath, segments[index]);
            try {
                const stats = await fs.lstat(currentPath);
                if (index < segments.length - 1 && !stats.isDirectory()) {
                    conflicts.add(path.join(...segments.slice(0, index + 1)));
                    break;
                }
                if (index === segments.length - 1) conflicts.add(relativePath);
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
                break;
            }
        }
    }
    return [...conflicts].sort();
}

export async function initializeTestSuite(destination: string): Promise<number> {
    // Same rule as the test controller: switch to throwaway data synchronously, before the first
    // await, so Chromium's GPU and network processes never open a real profile's folder.
    const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), "persephone-test-init-"));
    app.setPath("userData", temporaryDirectory);
    app.setPath("sessionData", temporaryDirectory);
    try {
        return await writeTemplate(destination);
    } finally {
        await fs.rm(temporaryDirectory, { recursive: true, force: true }).catch((): undefined => undefined);
    }
}

async function writeTemplate(destination: string): Promise<number> {
    const source = getAssetPath("test-suite-template");
    try {
        let destinationStats;
        try {
            destinationStats = await fs.stat(destination);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }

        if (destinationStats && !destinationStats.isDirectory()) {
            console.error(`Cannot initialize starter suite: destination is not a directory: ${destination}`);
            return 1;
        }

        if (destinationStats) {
            const entries = await fs.readdir(destination);
            if (entries.length > 0) {
                const conflicts = await listConflicts(destination, await listFiles(source));
                if (conflicts.length > 0) {
                    for (const conflict of conflicts) console.error(`Conflict: ${conflict}`);
                } else {
                    console.error(`Cannot initialize starter suite: folder is not empty: ${destination}`);
                }
                return 1;
            }
        }

        // File by file with COPYFILE_EXCL: never overwrites, and works into an existing empty folder.
        for (const relativePath of (await listFiles(source)).sort()) {
            const target = path.join(destination, relativePath);
            await fs.mkdir(path.dirname(target), { recursive: true });
            await fs.copyFile(path.join(source, relativePath), target, fsConstants.COPYFILE_EXCL);
            console.log(`Created: ${relativePath}`);
        }
        console.log(`Next: run ${path.join(destination, "run-tests.ps1")}`);
        return 0;
    } catch (error) {
        console.error(`Could not initialize starter suite at ${destination}: ${errMessage(error)}`);
        return 1;
    }
}
