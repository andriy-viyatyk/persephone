import type { GitColumnLayout } from "../../components/git-tree/GitTreeView";
import { tryParseJson } from "../../core/utils/parse-utils";
import { uiPreferences } from "../../api/ui-preferences";

export const GIT_TREE_COLUMN_LAYOUT_KEY = "git-tree.column-layout.full";
export const GIT_TREE_BOTTOM_PANEL_HEIGHT_KEY = "git-tree.bottom-panel-height";

const PERCENTAGE_WIDTH = /^(?:\d+(?:\.\d+)?|\.\d+)%$/;

function isColumnLayoutEntry(value: unknown): value is GitColumnLayout[number] {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
    const entry = value as { key?: unknown; width?: unknown };
    if (typeof entry.key !== "string" || entry.key.length === 0) return false;
    if (typeof entry.width === "number") {
        return Number.isFinite(entry.width) && entry.width > 0;
    }
    if (typeof entry.width !== "string" || !PERCENTAGE_WIDTH.test(entry.width)) return false;
    const percentage = Number(entry.width.slice(0, -1));
    return percentage > 0 && percentage <= 100;
}

function parseColumnLayout(value: unknown): GitColumnLayout | undefined {
    if (!Array.isArray(value)) return undefined;

    const keys = new Set<string>();
    const layout: GitColumnLayout = [];
    for (const entry of value) {
        if (!isColumnLayoutEntry(entry)) return undefined;
        if (keys.has(entry.key)) return undefined;
        keys.add(entry.key);
        layout.push(entry);
    }
    return layout;
}

export function readGitTreeColumnLayout(): GitColumnLayout | undefined {
    const raw = uiPreferences.readString(GIT_TREE_COLUMN_LAYOUT_KEY);
    return parseColumnLayout(tryParseJson<unknown>(raw, undefined));
}

export function writeGitTreeColumnLayout(layout: GitColumnLayout): void {
    uiPreferences.write(GIT_TREE_COLUMN_LAYOUT_KEY, JSON.stringify(layout));
}

export function readGitTreeBottomPanelHeight(): number | undefined {
    return uiPreferences.readNumber(GIT_TREE_BOTTOM_PANEL_HEIGHT_KEY, 120);
}

export function writeGitTreeBottomPanelHeight(height: number): void {
    uiPreferences.write(GIT_TREE_BOTTOM_PANEL_HEIGHT_KEY, height);
}
