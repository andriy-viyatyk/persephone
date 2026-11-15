import type { EditorModelInstance as EditorModel } from "../../editors/base";
import type { StoredLinkData } from "../../../shared/link-data";
import type { PageHistoryEntry, PageHistorySnapshot, PersistedPageSourceLink } from "../../../shared/persistence";
import type { HistoryMove } from "./PageNavigator";
import type { PageModel } from "./PageModel";
import { fs as appFs } from "../fs";
import { ui } from "../ui";
import { t } from "../../../shared/i18n/t";
import { fileIdentity, fpBasename, isVirtualPath } from "../../core/utils/file-path";
import { pipeFromPersistedSource } from "../../content/rebuild-pipe";
import { decodeFolderEditorLink } from "../../content/folder-editor-link";
import { errMessage } from "../../../shared/utils";

export const MAX_PAGE_HISTORY_ENTRIES = 50;

type HistoryDirection = "back" | "forward";

function copyEntry(entry: PageHistoryEntry): PageHistoryEntry {
    const sourceLink = entry.sourceLink
        ? structuredClone(entry.sourceLink)
        : undefined;
    return deepFreeze({ ...entry, ...(sourceLink ? { sourceLink } : {}) });
}

function deepFreeze<T>(value: T): T {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
        Object.freeze(value);
        for (const child of Object.values(value)) deepFreeze(child);
    }
    return value;
}

/** Owns a page's oldest-first navigation stacks and performs direct history replay. */
export class PageHistory {
    private backEntries: PageHistoryEntry[] = [];
    private forwardEntries: PageHistoryEntry[] = [];
    private busy = false;
    private navigate?: (pageId: string, filePath: string, options: {
        target: string;
        title: string;
        sourceLink?: StoredLinkData;
        pipe: Awaited<ReturnType<typeof pipeFromPersistedSource>>;
        folderPath?: string;
        historyMove: HistoryMove;
    }) => Promise<boolean>;

    constructor(
        private readonly page: PageModel,
        private readonly onChanged: () => void,
    ) {}

    setNavigator(navigate: PageHistory["navigate"]): void {
        this.navigate = navigate;
    }

    get canGoBack(): boolean { return this.backEntries.length > 0; }
    get canGoForward(): boolean { return this.forwardEntries.length > 0; }

    /** Back-stack entries, oldest first, as immutable copies. */
    get entries(): readonly PageHistoryEntry[] {
        return Object.freeze(this.backEntries.map(copyEntry));
    }

    snapshot(): PageHistorySnapshot {
        return Object.freeze({
            back: Object.freeze(this.backEntries.map(copyEntry)),
            forward: Object.freeze(this.forwardEntries.map(copyEntry)),
        });
    }

    seed(snapshot: PageHistorySnapshot | undefined): void {
        this.backEntries = (snapshot?.back ?? []).slice(-MAX_PAGE_HISTORY_ENTRIES).map(copyEntry);
        this.forwardEntries = (snapshot?.forward ?? []).slice(-MAX_PAGE_HISTORY_ENTRIES).map(copyEntry);
        this.onChanged();
    }

    capture(editor: EditorModel | null): PageHistoryEntry | undefined {
        if (!editor) return undefined;
        const sourceLink = editor.sourceLink;
        const filePath = editor.filePath ?? sourceLink?.url;
        if (!filePath) return undefined;
        return copyEntry({
            filePath,
            target: editor.editorId,
            title: editor.title,
            ...(sourceLink ? { sourceLink: sourceLink as PersistedPageSourceLink } : {}),
        });
    }

    createMove(direction: HistoryDirection, entry: PageHistoryEntry): HistoryMove {
        return { direction, entry };
    }

    /** Commit a successful navigator exit. A move marker is only accepted for its current stack top. */
    commitNavigation(
        leavingEntry: PageHistoryEntry | undefined,
        move: HistoryMove | undefined,
        destination: { filePath: string; target: string },
    ): boolean {
        if (move) {
            const from = move.direction === "back" ? this.backEntries : this.forwardEntries;
            const to = move.direction === "back" ? this.forwardEntries : this.backEntries;
            const top = from.at(-1);
            if (top !== move.entry) return false;
            from.pop();
            if (leavingEntry) to.push(copyEntry(leavingEntry));
            if (to.length > MAX_PAGE_HISTORY_ENTRIES) to.splice(0, to.length - MAX_PAGE_HISTORY_ENTRIES);
            this.onChanged();
            return true;
        }

        const current = leavingEntry;
        const isDifferentDestination = !current
            || fileIdentity(current.filePath) !== fileIdentity(destination.filePath)
            || current.target !== destination.target;
        if (!isDifferentDestination) return false;
        if (current) {
            this.backEntries.push(copyEntry(current));
            if (this.backEntries.length > MAX_PAGE_HISTORY_ENTRIES) {
                this.backEntries.splice(0, this.backEntries.length - MAX_PAGE_HISTORY_ENTRIES);
            }
        }
        this.forwardEntries = [];
        this.onChanged();
        return true;
    }

    back = async (): Promise<boolean> => this.replay("back");
    forward = async (): Promise<boolean> => this.replay("forward");

    private async replay(direction: HistoryDirection): Promise<boolean> {
        if (this.busy || this.page.isInert || !this.navigate) return false;
        const entries = direction === "back" ? this.backEntries : this.forwardEntries;
        const entry = entries.at(-1);
        if (!entry) return false;
        this.busy = true;
        let pipe: Awaited<ReturnType<typeof pipeFromPersistedSource>> | undefined;
        try {
            if (!isVirtualPath(entry.filePath) && !(await appFs.exists(entry.filePath))) {
                entries.pop();
                this.onChanged();
                ui.notify(t("api.fileNotFound", { name: fpBasename(entry.filePath) }), "error");
                return false;
            }
            pipe = await pipeFromPersistedSource(entry.sourceLink, entry.filePath, { unknownScheme: "reject" });
            const folderLink = decodeFolderEditorLink(entry.sourceLink?.url ?? entry.filePath);
            const move = this.createMove(direction, entry);
            const moved = await this.navigate(this.page.id, entry.filePath, {
                target: entry.target,
                title: entry.title,
                sourceLink: entry.sourceLink
                    ? structuredClone(entry.sourceLink) as StoredLinkData
                    : undefined,
                pipe,
                folderPath: folderLink?.anchorFolder,
                historyMove: move,
            });
            // A taken interceptor owns the pipe; a navigator commit transfers it or disposes it.
            if (!moved) pipe.dispose();
            pipe = undefined;
            return move.committed === true;
        } catch (error) {
            ui.notify(t("api.failedToOpenNamedFileWithError", {
                name: fpBasename(entry.filePath),
                error: errMessage(error),
            }), "error");
            throw error;
        } finally {
            pipe?.dispose();
            this.busy = false;
        }
    }
}
