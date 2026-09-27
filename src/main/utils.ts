import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import type { LaunchInput } from "../shared/launch-input";

export const preparePath = (dirPath: string): boolean => {
    if (!fs.existsSync(dirPath)) {
        try {
            fs.mkdirSync(dirPath, { recursive: true });
        } catch (err) {
            return false;
        }
    }
    return true;
};

let appRootPath = undefined as string | undefined;
export const getAppRootPath = (): string => {
    if (appRootPath === undefined) {
        appRootPath = app.isPackaged
            ? process.resourcesPath
            : path.join(__dirname, '../../');
    }

    return appRootPath;
}

let resourcesPath = undefined as string | undefined;
export const getAssetPath = (...paths: string[]): string => {
    if (resourcesPath === undefined) {
        resourcesPath = app.isPackaged
            ? path.join(process.resourcesPath, 'assets')
            : path.join(__dirname, '../../assets');
    }

    return path.join(resourcesPath, ...paths);
};

let dataFolder = undefined as string | undefined;
export const getDataFolder = (): string => {
    if (dataFolder === undefined) {
        const userFolder = app.getPath("userData");
        dataFolder = path.join(userFolder, "data");
    }

    return dataFolder;
};

function pathExists(filePath: string | undefined): boolean {
    if (!filePath) {
        console.warn('No file path provided');
        return false;
    }

    if (typeof filePath !== 'string' || filePath.trim() === '') {
        console.warn('Invalid file path string');
        return false;
    }

    try {
        if (!fs.existsSync(filePath)) {
            console.warn('File does not exist:', filePath);
            return false;
        }
    } catch (error) {
        console.warn('Error checking file path:', error?.message);
        return false;
    }

    return true;
}

export function isValidFilePath(filePath: string | undefined): boolean {
    if (!pathExists(filePath)) {
        return false;
    }

    try {
        const stats = fs.statSync(filePath);
        if (!stats.isFile()) {
            console.warn('Path is not a file (might be a directory):', filePath);
            return false;
        }
    } catch (error) {
        console.warn('Error reading file stats:', error?.message);
        return false;
    }

    return true;
}

/**
 * Accepts a file **or** a folder — the check for the "open this path" entry
 * points (cold-start argv, launcher pipe, second-instance).
 *
 * A folder is a legitimate thing to open: the renderer's content resolver stats
 * the path and opens a directory as an empty page with the Explorer panel rooted
 * at it, the same page the "Open Folder" tool produces. Everything downstream of
 * these entry points already handles that, so this predicate is the only thing
 * standing between Explorer's folder context menu and a working page.
 *
 * Entry points that need readable *content* (the DIFF pair) keep using
 * isValidFilePath — comparing a directory is meaningless.
 */
export function isValidOpenPath(filePath: string | undefined): boolean {
    return pathExists(filePath);
}

/** Select launch operands from either packaged or `electron <appPath>` argv. */
export function launchOperands(argv: string[]): string[] {
    const operands = argv.slice(1).filter((argument) => !argument.startsWith("--"));
    return process.defaultApp ? operands.slice(1) : operands;
}

/** Parse ordered launch operands using the caller's working directory for relative paths. */
export function parseLaunchArguments(operands: string[], cwd: string): LaunchInput[] {
    const inputs: LaunchInput[] = [];

    for (let index = 0; index < operands.length; index += 1) {
        const operand = operands[index];
        if (index === 0 && operand.toLowerCase() === "diff") {
            const firstOperand = operands[index + 1];
            const secondOperand = operands[index + 2];
            index += 2;
            if (!firstOperand || !secondOperand) continue;

            const firstPath = path.resolve(cwd, firstOperand);
            const secondPath = path.resolve(cwd, secondOperand);
            if (isValidFilePath(firstPath) && isValidFilePath(secondPath)) {
                inputs.push({ kind: "diff", firstPath, secondPath });
            }
            continue;
        }

        if (operand.startsWith("http://") || operand.startsWith("https://")) {
            inputs.push({ kind: "url", url: operand });
            continue;
        }

        const resolvedPath = path.resolve(cwd, operand);
        if (isValidOpenPath(resolvedPath)) {
            inputs.push({ kind: "file", path: resolvedPath });
        }
    }

    return inputs;
}
