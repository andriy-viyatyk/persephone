import { app, dialog } from "electron";
import fs from "node:fs";
import path from "node:path";
import { t } from "./shared/i18n/t";
import { parseApplicationProfile } from "./main/application-profile";
// Static import on purpose: setupMainProcess registers `app.on("ready")`, which a dynamic import
// could miss. No module in its graph reads userData at load time (data paths resolve lazily), so
// the profile's setPath below still takes effect for everything.
import { setupMainProcess } from "./main/main-setup";
import { parseTestControllerArguments } from "./main/test-mode/arguments";
import { startTestController } from "./main/test-mode/controller";
import { errMessage } from "./shared/utils";
import { guardStandardStreams } from "./main/stdio-guard";

guardStandardStreams();

function startWithProfile(profile: ReturnType<typeof parseApplicationProfile>): void {
    const { name, directory: profileDirectory } = profile;
    if (name) {
        // A named profile gets its own data root; Chromium's single-instance lock is keyed on the
        // userData directory, so setting it before requestSingleInstanceLock separates the lock too.
        const directory = profileDirectory ?? path.join(app.getPath("appData"), "persephone-profiles", name);
        fs.mkdirSync(directory, { recursive: true });
        app.setPath("userData", directory);
        if (app.getPath("sessionData") !== directory) app.setPath("sessionData", directory);
        // Separate taskbar group for the profile's normal windows (board windows set their own ids).
        app.setAppUserModelId(`com.viyatyk.persephone.profile.${name}`);
    }
    if (!app.requestSingleInstanceLock()) app.quit();
    else setupMainProcess();
}

let profile: ReturnType<typeof parseApplicationProfile> | undefined;
try {
    const startupArguments = process.argv.slice(process.defaultApp ? 2 : 1);
    profile = parseApplicationProfile(startupArguments);
    const testArguments = parseTestControllerArguments(profile.remainingArgs);
    if (testArguments) {
        void startTestController(profile, testArguments);
    } else startWithProfile(profile);
} catch (error) {
    if (process.argv.some((argument) => argument === "--test" || argument.startsWith("--test="))) {
        console.error(`Test runner arguments: ${errMessage(error)}`);
        app.exit(1);
    } else {
        dialog.showErrorBox(t("main.profileErrorTitle"), t("main.profileError"));
        app.quit();
    }
}
