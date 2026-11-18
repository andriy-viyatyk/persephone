import { app } from "electron";
import * as fs from "node:fs";
import path from "node:path";
import { isTestInstance } from "./instance-options";

export const TEST_AUDIO_CAPTURE_FILE_ENV = "PERSEPHONE_TEST_AUDIO_CAPTURE_FILE";

/** Install Chromium's fake microphone only for isolated test instances. */
export function installTestModeMediaCapture(): void {
    if (!isTestInstance()) return;

    app.commandLine.appendSwitch("use-fake-device-for-media-stream");
    app.commandLine.appendSwitch("mute-audio");

    const value = process.env[TEST_AUDIO_CAPTURE_FILE_ENV];
    if (!value || !path.isAbsolute(value) || path.extname(value).toLowerCase() !== ".wav") return;

    try {
        if (!fs.statSync(value).isFile()) return;
        app.commandLine.appendSwitch("use-file-for-fake-audio-capture", path.resolve(value));
    } catch {
        // The file-backed fixture is optional; test startup should still have a fake device.
    }
}
