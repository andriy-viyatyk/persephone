/**
 * electron-builder afterPack hook — VMP-signs the Electron binary
 * using Castlabs EVS for Widevine DRM support.
 *
 * The EVS tool tries to sign all .exe files in the directory, but only
 * the Electron binary is a valid ECS binary. Non-Electron executables
 * (e.g. persephone-launcher.exe) are temporarily moved out before signing.
 *
 * Requires:
 *   - Python 3.7+ with castlabs-evs installed: pip install castlabs-evs
 *   - EVS account credentials (run: python -m castlabs_evs.account signup)
 *
 * Set VMP_SIGN=true to enable signing (skipped by default to avoid
 * breaking builds for developers without EVS credentials).
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export default async function afterPack(context) {
    if (process.env.VMP_SIGN !== "true") {
        console.log("  • VMP signing skipped (set VMP_SIGN=true to enable)");
        return;
    }

    const appDir = context.appOutDir;
    const mainExe = `${context.packager.appInfo.productFilename}.exe`;

    console.log(`  • VMP signing ${appDir}`);

    // Find non-Electron .exe files that would cause EVS to fail
    const exeFiles = fs.readdirSync(appDir).filter(
        (f) => f.endsWith(".exe") && f !== mainExe
    );

    // Temporarily move them out
    const moved = [];
    for (const exe of exeFiles) {
        const src = path.join(appDir, exe);
        const dst = path.join(appDir, `${exe}.__vmp_tmp`);
        fs.renameSync(src, dst);
        moved.push({ src, dst });
    }

    try {
        // Build command with optional credentials from environment variables
        // (used in CI where interactive login isn't possible)
        let cmd = `python -m castlabs_evs.vmp --no-ask sign-pkg`;
        if (process.env.EVS_ACCOUNT_NAME) {
            cmd += ` -A "${process.env.EVS_ACCOUNT_NAME}"`;
        }
        if (process.env.EVS_PASSWD) {
            cmd += ` -P "${process.env.EVS_PASSWD}"`;
        }
        cmd += ` "${appDir}"`;
        execSync(cmd, { stdio: "inherit" });
        console.log("  • VMP signing successful");
    } finally {
        // Restore moved files
        for (const { src, dst } of moved) {
            fs.renameSync(dst, src);
        }
    }
}
