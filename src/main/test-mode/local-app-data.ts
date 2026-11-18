import { app } from "electron";
import * as fs from "node:fs";
import path from "node:path";
import { isTestInstance } from "./instance-options";

/** Folder under the test profile's user data that stands in for `%LOCALAPPDATA%`. */
export const TEST_LOCAL_APP_DATA_FOLDER = "test-local-app-data";

/**
 * In a test instance, point `LOCALAPPDATA` at `<userData>/test-local-app-data` for the whole
 * main process, so every child it spawns (board services, `executeNode`, `execute`, terminals)
 * inherits the profile-local folder instead of the user's real one. Board services keep models,
 * runtimes and enrollments under `%LOCALAPPDATA%\Persephone\board-data\<board>`; without this a
 * test that opens such a board would read and write the user's data. Must run before any child
 * process starts; `reconstructWindowsEnv` only backfills missing variables, so it keeps this value.
 */
export function redirectTestInstanceLocalAppData(): void {
    if (!isTestInstance()) return;
    const folder = path.join(app.getPath("userData"), TEST_LOCAL_APP_DATA_FOLDER);
    fs.mkdirSync(folder, { recursive: true });
    process.env.LOCALAPPDATA = folder;
}
