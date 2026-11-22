import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface CapturedDownload { suggestedFilename: string; path: string; size: number; }
export interface DownloadAttachment { suggestedFilename: string; path: string; size: number; }

const CAPTURE_ROOT_NAME = "persephone-test-downloads";

/** Validate the app-owned capture path, copy it into run output, and remove the app-side file. */
export async function copyCapturedDownload(result: CapturedDownload, outputDirectory: string): Promise<{ result: CapturedDownload; attachment: DownloadAttachment }> {
    let trustedSource: string | undefined;
    let outputPath: string | undefined;
    let outputCreated = false;
    try {
        if (!result || typeof result !== "object" || typeof result.path !== "string" || typeof result.suggestedFilename !== "string"
            || !Number.isSafeInteger(result.size) || result.size < 0 || hasParentSegment(result.path)) {
            throw new Error("Captured download result is invalid.");
        }
        const canonicalRoot = await fs.realpath(path.join(os.tmpdir(), CAPTURE_ROOT_NAME));
        const suppliedProfile = path.dirname(result.path);
        const canonicalProfile = await fs.realpath(suppliedProfile);
        if (path.dirname(canonicalProfile) !== canonicalRoot || path.basename(canonicalProfile) === "" || path.basename(canonicalProfile) === "." || path.basename(canonicalProfile) === "..") {
            throw new Error("Captured download source is outside the app capture folder.");
        }
        trustedSource = await fs.realpath(result.path);
        if (path.dirname(trustedSource) !== canonicalProfile) throw new Error("Captured download source is not a direct capture file.");
        const stat = await fs.stat(trustedSource);
        if (!stat.isFile() || stat.size !== result.size) throw new Error("Captured download size or file type did not match.");

        const directory = path.join(outputDirectory, "downloads");
        await fs.mkdir(directory, { recursive: true });
        const safeName = sanitizeFilename(result.suggestedFilename);
        const extension = path.extname(safeName);
        const stem = extension ? safeName.slice(0, -extension.length) : safeName;
        outputPath = path.join(directory, safeName);
        let relative = "";
        for (let suffix = 0; ; suffix++) {
            if (suffix) outputPath = path.join(directory, `${stem} (${suffix})${extension}`);
            try {
                await fs.copyFile(trustedSource, outputPath, fs.constants.COPYFILE_EXCL);
                outputCreated = true;
                relative = path.posix.join("downloads", path.basename(outputPath));
                break;
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
            }
        }
        await fs.unlink(trustedSource);
        const copied = { suggestedFilename: result.suggestedFilename, path: outputPath, size: stat.size };
        return { result: copied, attachment: { suggestedFilename: result.suggestedFilename, path: relative, size: stat.size } };
    } catch (error) {
        if (outputCreated && outputPath) await fs.unlink(outputPath).catch((): void => undefined);
        if (trustedSource) await fs.unlink(trustedSource).catch((): void => undefined);
        throw new Error(error instanceof Error && error.message.startsWith("Captured download")
            ? error.message
            : "Could not copy captured download into the test output.", { cause: error });
    }
}

function hasParentSegment(value: string): boolean {
    return value.split(/[\\/]/).includes("..");
}

function sanitizeFilename(value: string): string {
    let filename = [...value.replaceAll(/[\\/]/g, "")].filter((character) => {
        const code = character.charCodeAt(0);
        return code >= 32 && code !== 127 && !'<>:"|?*'.includes(character);
    }).join("").replace(/[. ]+$/g, "").trim();
    if (!filename || filename === "." || filename === "..") filename = "download";
    const firstPart = filename.split(".", 1)[0].replace(/[. ]+$/g, "");
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(firstPart)) filename = `_${filename}`;
    return filename.slice(0, 180) || "download";
}
