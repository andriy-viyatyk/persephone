import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import process from "node:process";
import { parseGuideFile } from "../src/shared/guides/front-matter";

/** A guide page is read in one piece; the default read length of ai-vision is 20,000 characters. */
const PAGE_LIMIT = 20_000;
/** A hub (index.md of a split folder) carries the basics plus a "Read next" table. */
const HUB_LIMIT = 10_000;

/** Pages allowed past PAGE_LIMIT, with the reason. */
const SIZE_EXEMPT: Readonly<Record<string, string>> = {
    "whats-new.md": "changelog; guides.whatsNew returns the current section",
    "agents/languages-glossary.md": "term lookup table read by language, found with guides.search",
};

/** Folders whose index.md is a split hub and must stay within HUB_LIMIT. Grows with each split. */
const HUB_FOLDERS: readonly string[] = [
    "agents/boards",
    "boards",
    "agents/agent-session",
    "agents/capabilities",
    "agents/scripting",
    "editors/browser",
    "mcp-setup",
    "tabs-and-navigation",
];

const EXCLUDE_START = "<!-- board-template:exclude -->";
const EXCLUDE_END = "<!-- /board-template:exclude -->";

const guidesRoot = resolve("assets/guides");

async function listMarkdown(directory: string): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
        const full = join(directory, entry.name);
        if (entry.isDirectory()) files.push(...await listMarkdown(full));
        else if (entry.name.endsWith(".md")) files.push(full);
    }
    return files;
}

async function exists(path: string): Promise<boolean> {
    try {
        await stat(path);
        return true;
    } catch {
        return false;
    }
}

export async function runGuidesCheck(args: readonly string[]): Promise<void> {
    const failures: string[] = [];
    const files = (await listMarkdown(guidesRoot)).sort();
    let checked = 0;

    for (const full of files) {
        const key = relative(guidesRoot, full).split("\\").join("/");
        const text = await readFile(full, "utf-8");
        const parsed = parseGuideFile(key, text);
        checked += 1;

        if (!parsed.frontMatter.summary) {
            failures.push(`${key}: front matter is missing or lacks title, audience or summary`);
        }

        const length = parsed.content.length;
        if (length > PAGE_LIMIT && !(key in SIZE_EXEMPT)) {
            failures.push(`${key}: ${length} characters, over the ${PAGE_LIMIT} page limit (split it)`);
        }
        if (key.endsWith("/index.md") || key === "index.md") {
            const folder = key.slice(0, -"/index.md".length);
            if (HUB_FOLDERS.includes(folder) && length > HUB_LIMIT) {
                failures.push(`${key}: hub is ${length} characters, over the ${HUB_LIMIT} hub limit`);
            }
        }

        const folderStem = full.slice(0, -".md".length);
        if (!key.endsWith("/index.md") && key !== "index.md" && await exists(folderStem)) {
            failures.push(`${key}: a folder with the same name exists next to this file`);
        }

        let excluded = false;
        for (const marker of text.matchAll(new RegExp(`${EXCLUDE_START}|${EXCLUDE_END}`, "g"))) {
            if (marker[0] === EXCLUDE_START) {
                if (excluded) failures.push(`${key}: nested board-template:exclude marker`);
                excluded = true;
            } else {
                if (!excluded) failures.push(`${key}: unmatched closing board-template:exclude marker`);
                excluded = false;
            }
        }
        if (excluded) failures.push(`${key}: unmatched opening board-template:exclude marker`);

        for (const link of text.matchAll(/\]\(([^)#\s]+\.md)(?:#[^)\s]*)?\)/g)) {
            const target = link[1];
            if (/^[a-z]+:/i.test(target) || target.includes("installed-boards/")) continue; // installed-boards/ is mounted at runtime
            if (!await exists(resolve(dirname(full), target))) {
                failures.push(`${key}: link to missing page ${target}`);
            }
        }
    }

    if (failures.length > 0) {
        console.error(`guides:check found ${failures.length} problem(s) in ${checked} pages:`);
        for (const failure of failures) console.error(`  - ${failure}`);
        process.exitCode = 1;
        return;
    }
    console.log(`guides:check passed: ${checked} pages.`);
    if (args.includes("--quiet")) return;
}
