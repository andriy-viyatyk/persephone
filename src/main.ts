import { app, dialog } from "electron";
import fs from "node:fs";
import path from "node:path";
import { t } from "./shared/i18n/t";
import { parseApplicationProfile } from "./main/application-profile";
// Static import on purpose: setupMainProcess registers `app.on("ready")`, which a dynamic import
// could miss. No module in its graph reads userData at load time (data paths resolve lazily), so
// the profile's setPath below still takes effect for everything.
import { setupMainProcess } from "./main/main-setup";

function startWithProfile(name: string | undefined): void {
    if (name) {
        // A named profile gets its own data root; Chromium's single-instance lock is keyed on the
        // userData directory, so setting it before requestSingleInstanceLock separates the lock too.
        const directory = path.join(app.getPath("appData"), "persephone-profiles", name);
        fs.mkdirSync(directory, { recursive: true });
        app.setPath("userData", directory);
        if (app.getPath("sessionData") !== directory) app.setPath("sessionData", directory);
        // Separate taskbar group for the profile's normal windows (board windows set their own ids).
        app.setAppUserModelId(`com.viyatyk.persephone.profile.${name}`);
    }
    if (!app.requestSingleInstanceLock()) app.quit();
    else setupMainProcess();
}

let profileName: string | undefined;
let validProfile = true;
try {
    profileName = parseApplicationProfile(process.argv.slice(1)).name;
} catch {
    validProfile = false;
    dialog.showErrorBox(t("main.profileErrorTitle"), t("main.profileError"));
    app.quit();
}
if (validProfile) startWithProfile(profileName);
