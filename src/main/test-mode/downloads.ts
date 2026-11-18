import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { isTestInstance } from "./instance-options";
import { preparePath } from "../utils";

/** Folder under the profile's user data where a test instance saves browser downloads. */
export const TEST_DOWNLOAD_FOLDER = "test-downloads";

/**
 * In a test instance (`--test-instance`), browser downloads must not open the native Save dialog:
 * the test runner cannot answer OS dialogs. Returns the target path for `filename` in
 * `<userData>/test-downloads/`, made unique with a ` (n)` suffix, or `undefined` outside test mode
 * (the caller then asks the user as usual).
 */
export function testInstanceDownloadPath(filename: string): string | undefined {
    if (!isTestInstance()) return undefined;
    const folder = path.join(app.getPath("userData"), TEST_DOWNLOAD_FOLDER);
    if (!preparePath(folder)) return undefined;
    const safeName = path.basename(filename || "download");
    const extension = path.extname(safeName);
    const stem = safeName.slice(0, safeName.length - extension.length);
    let candidate = path.join(folder, safeName);
    for (let index = 1; fs.existsSync(candidate); index++) {
        candidate = path.join(folder, `${stem} (${index})${extension}`);
    }
    return candidate;
}
