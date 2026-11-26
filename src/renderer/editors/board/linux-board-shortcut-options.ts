import { t } from "../../../shared/i18n/t";
import { fs } from "../../api/fs";
import { fpIsAbsolute, fpJoin } from "../../core/utils/file-path";

export interface BoardShortcutDialogOptions {
    defaultPath: string;
    filters: { name: string; extensions: string[] }[];
}

export async function getLinuxBoardShortcutDialogOptions(fileName: string): Promise<BoardShortcutDialogOptions> {
    const configuredDataHome = process.env.XDG_DATA_HOME;
    const dataHome = configuredDataHome && fpIsAbsolute(configuredDataHome)
        ? configuredDataHome
        : fpJoin(await fs.commonFolder("home"), ".local", "share");
    const applications = fpJoin(dataHome, "applications");
    await fs.mkdir(applications);
    return {
        defaultPath: fpJoin(applications, `${fileName}.desktop`),
        filters: [{ name: t("shell.boardShortcutLinuxFileType"), extensions: ["desktop"] }],
    };
}
