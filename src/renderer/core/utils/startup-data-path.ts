import { STARTUP_DATA_DIR_ARG } from "../../../shared/application-profile";

export function getStartupDataPath(): string {
    const argument = process.argv.find((value) => value.startsWith(STARTUP_DATA_DIR_ARG));
    const dataDirectory = argument?.slice(STARTUP_DATA_DIR_ARG.length);
    if (!dataDirectory) {
        throw new Error(`Startup configuration error: missing ${STARTUP_DATA_DIR_ARG}<path> renderer argument.`);
    }
    return dataDirectory;
}
