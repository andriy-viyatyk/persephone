import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import process from "node:process";
import { commonCatalog } from "../src/shared/i18n/en/common";
import { mainCatalog } from "../src/shared/i18n/en/main";
import { settingsCatalog } from "../src/shared/i18n/en/settings";
import { dialogsCatalog } from "../src/shared/i18n/en/dialogs";
import { shellCatalog } from "../src/shared/i18n/en/shell";
import { editorsCatalog } from "../src/shared/i18n/en/editors";
import { menusCatalog } from "../src/shared/i18n/en/menus";
import { apiCatalog } from "../src/shared/i18n/en/api";
import { browserCatalog } from "../src/shared/i18n/en/browser";
import { boardCatalog } from "../src/shared/i18n/en/board";
import { explorerCatalog } from "../src/shared/i18n/en/explorer";
import { linksCatalog } from "../src/shared/i18n/en/links";
import { gitCatalog } from "../src/shared/i18n/en/git";
import { mnemeCatalog } from "../src/shared/i18n/en/mneme";
import { aboutCatalog } from "../src/shared/i18n/en/about";
import { toolsCatalog } from "../src/shared/i18n/en/tools";
import { uikitCatalog } from "../src/shared/i18n/en/uikit";
import { notebookCatalog } from "../src/shared/i18n/en/notebook";
import { logViewCatalog } from "../src/shared/i18n/en/logView";
import { englishCatalog } from "../src/shared/i18n/en";
import { hashEnglishMessage } from "../src/shared/i18n/hash";
import { messagePlaceholders } from "../src/shared/i18n/validate-pack";

const entryCatalogs = {
    common: commonCatalog,
    main: mainCatalog,
    settings: settingsCatalog,
    dialogs: dialogsCatalog,
    shell: shellCatalog,
    editors: editorsCatalog,
    menus: menusCatalog,
    api: apiCatalog,
    browser: browserCatalog,
    board: boardCatalog,
    explorer: explorerCatalog,
    links: linksCatalog,
    git: gitCatalog,
    mneme: mnemeCatalog,
    about: aboutCatalog,
    tools: toolsCatalog,
    uikit: uikitCatalog,
    notebook: notebookCatalog,
    logView: logViewCatalog,
};

interface ExportEntry {
    key: string;
    message: string | Readonly<Record<string, string>>;
    placeholders: string[];
    note?: string;
    sourceHash: string;
}

function entriesForArea(area: string): ExportEntry[] {
    const messages = englishCatalog[area as keyof typeof englishCatalog] as Record<string, string | Readonly<Record<string, string>>>;
    const catalog = entryCatalogs[area as keyof typeof entryCatalogs] as Record<string, { message: string | Readonly<Record<string, string>>; note?: string }>;
    return Object.keys(messages).sort().map((key) => {
        const message = messages[key];
        const texts = typeof message === "string" ? [message] : Object.values(message);
        const note = catalog[key]?.note;
        return {
            key: `${area}.${key}`,
            message: typeof message === "string" ? message : { ...message },
            placeholders: [...new Set(texts.flatMap(messagePlaceholders))].sort(),
            ...(note === undefined ? {} : { note }),
            sourceHash: hashEnglishMessage(message),
        };
    });
}

export async function runI18nExport(arguments_: readonly string[]): Promise<void> {
    if (arguments_.length !== 1 || !arguments_[0]) {
        console.error("Usage: npm run i18n:export -- <outDir>");
        process.exitCode = 1;
        return;
    }

    const outputDirectory = resolve(process.cwd(), arguments_[0]);
    const parentDirectory = dirname(outputDirectory);
    await mkdir(parentDirectory, { recursive: true });
    const stageDirectory = await mkdtemp(join(parentDirectory, `${basename(outputDirectory)}.tmp-`));
    const backupDirectory = join(stageDirectory, "backup");

    try {
        await mkdir(outputDirectory, { recursive: true });
        const files = Object.keys(englishCatalog).map((area) => ({
            name: `${area}.json`,
            content: `${JSON.stringify(entriesForArea(area), null, 2)}\n`,
        }));
        await Promise.all(files.map(({ name, content }) => writeFile(join(stageDirectory, name), content, "utf8")));
        await mkdir(backupDirectory);

        const backedUpFiles: string[] = [];
        const installedFiles: string[] = [];
        try {
            for (const { name } of files) {
                try {
                    await rename(join(outputDirectory, name), join(backupDirectory, name));
                    backedUpFiles.push(name);
                } catch (error) {
                    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
                }
                await rename(join(stageDirectory, name), join(outputDirectory, name));
                installedFiles.push(name);
            }
        } catch (error) {
            for (const name of installedFiles.reverse()) await rm(join(outputDirectory, name), { force: true });
            for (const name of backedUpFiles.reverse()) await rename(join(backupDirectory, name), join(outputDirectory, name));
            throw error;
        }
    } finally {
        await rm(stageDirectory, { recursive: true, force: true });
    }
}
