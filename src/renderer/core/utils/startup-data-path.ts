import { STARTUP_DATA_DIR_ARG } from "../../../shared/application-profile";
import { fpJoin } from "./file-path";

export function getStartupDataPath(): string {
    const argument = process.argv.find((value) => value.startsWith(STARTUP_DATA_DIR_ARG));
    return argument ? argument.slice(STARTUP_DATA_DIR_ARG.length) : fpJoin(process.env.APPDATA, "persephone", "data");
}
