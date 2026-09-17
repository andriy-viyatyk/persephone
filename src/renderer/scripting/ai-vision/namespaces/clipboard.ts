import { api } from "../../../../ipc/renderer/api";
import type {
    ClipboardFlavor,
    ClipboardFileList,
    ClipboardHistoryItem,
    ClipboardHistorySnapshot,
} from "../../../../ipc/clipboard-ipc";
import { errMessage } from "../../../../shared/utils";
import type { AppWrapper } from "../../api-wrapper/AppWrapper";
import {
    choiceRule,
    numberRule,
    stringRule,
    validateCallArguments,
    type IAiMember,
    type IAiVisible,
    type IAiVisionDescriptor,
} from "ai-vision";

const MAX_PAGE_SIZE = 100;
const CLIPBOARD_FLAVORS: readonly ClipboardFlavor[] = ["text", "html", "image", "files"];

const LIST_ARGUMENTS = [
    numberRule("offset", "clipboard.list(0, 100)", { required: false, minimum: 0 }),
    numberRule("limit", "clipboard.list(0, 100)", { required: false, minimum: 1 }),
] as const;

const READ_ARGUMENTS = [
    stringRule("id", 'clipboard.read("<id>")'),
    choiceRule("flavor", CLIPBOARD_FLAVORS, 'clipboard.read("<id>", "text")', { required: false }),
] as const;

const REMOVE_ARGUMENTS = [
    stringRule("id", 'clipboard.remove("<id>")'),
] as const;

const CLIPBOARD_MEMBERS: readonly IAiMember[] = [
    { name: "items", kind: "property", summary: "Newest-first preview metadata for the first page of stored clipboard history." },
    { name: "list", kind: "method", signature: "list(offset = 0, limit = 100)", summary: "Read one page of newest-first clipboard previews, with total count and revision." },
    { name: "read", kind: "method", signature: "read(id: string, flavor?: ClipboardFlavor)", summary: "Read the stored primary content, or one stored flavour, for a history item." },
    { name: "remove", kind: "method", signature: "remove(id: string)", summary: "Remove one stored clipboard item.", caution: "deletes the stored clipboard item and its payload files" },
    { name: "clear", kind: "method", signature: "clear()", summary: "Remove all stored clipboard history.", caution: "deletes all stored clipboard history and payload files" },
];

const CLIPBOARD_HELP = `
Clipboard history is stored newest first and is available only when clipboard.enabled is true.
Read items for the first page of preview and payload-path metadata, or use list(offset, limit) for
later pages; offset is zero-based and limit is at most 100. Each list result includes total and
revision so you can detect changes while paging.

read(id, flavor?) reads only the matching stored payload. Without flavor it reads the item's
primary flavour. Text and HTML return strings, files return the validated { paths, dropEffect }
path list, and images return stored PNG data as an image record. Raise call.maxLength if a long
text value or PNG base64 value is reported as truncated.

Excluded clipboard changes were never stored and cannot be reached here. Stored non-excluded
content is retained as readable files under the application's data folder by design. This node
never reads the live OS clipboard and does not accept arbitrary filesystem paths.

remove(id) and clear() delete stored history and payload files. Use them only after the user
explicitly asks to remove that item or clear clipboard history; discovering these methods is not
permission to invoke them. Copy-back and listener-health operations are not exposed here.
`.trim();

interface ClipboardImageResult {
    type: "image";
    data: string;
    mimeType: "image/png";
}

function validateInteger(name: string, callName: string, value: number): void {
    if (!Number.isInteger(value)) {
        throw new Error(`Invalid argument "${name}" for ${callName}: expected a finite integer.`);
    }
}

function isAbsoluteWindowsPath(value: string): boolean {
    return /^[A-Za-z]:[\\/]/.test(value) || /^\\\\[^\\/]+[\\/]/.test(value);
}

function isStoredFileList(value: unknown): value is ClipboardFileList {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const candidate = value as { paths?: unknown; dropEffect?: unknown };
    return Array.isArray(candidate.paths)
        && candidate.paths.length > 0
        && candidate.paths.every((path): path is string => typeof path === "string" && isAbsoluteWindowsPath(path))
        && (candidate.dropEffect === "copy" || candidate.dropEffect === "cut" || candidate.dropEffect === "none");
}

export class ClipboardHistoryNode implements IAiVisible {
    constructor(private readonly app: Pick<AppWrapper, "fs">) {}

    get items(): Promise<ClipboardHistoryItem[]> {
        return this.readPage(0, MAX_PAGE_SIZE).then((page) => page.items);
    }

    async list(...args: unknown[]): Promise<{
        revision: number;
        offset: number;
        limit: number;
        total: number;
        items: ClipboardHistoryItem[];
    }> {
        const [rawOffset, rawLimit] = validateCallArguments("clipboard.list", args, LIST_ARGUMENTS, { maxArgs: 2 });
        const offset = rawOffset ?? 0;
        const limit = rawLimit ?? MAX_PAGE_SIZE;
        validateInteger("offset", "clipboard.list", offset);
        validateInteger("limit", "clipboard.list", limit);
        if (limit > MAX_PAGE_SIZE) {
            throw new Error(`Invalid argument "limit" for clipboard.list: expected an integer no greater than ${MAX_PAGE_SIZE}.`);
        }
        return this.readPage(offset, limit);
    }

    async read(...args: unknown[]): Promise<string | ClipboardFileList | ClipboardImageResult> {
        const [id, flavor] = validateCallArguments("clipboard.read", args, READ_ARGUMENTS, { maxArgs: 2 });
        const snapshot = await api.getClipboardHistory();
        const item = snapshot.items.find((candidate) => candidate.id === id);
        if (!item) throw new Error(`Clipboard history item ${JSON.stringify(id)} was not found.`);

        const selectedFlavor = flavor ?? item.primary;
        const payloadPath = item.payloads[selectedFlavor];
        if (typeof payloadPath !== "string" || payloadPath.length === 0) {
            throw new Error(`Clipboard history item ${JSON.stringify(id)} has no stored ${selectedFlavor} payload.`);
        }

        if (selectedFlavor === "text" || selectedFlavor === "html") {
            return this.app.fs.read(payloadPath, "utf8");
        }

        if (selectedFlavor === "files") {
            const stored = await this.app.fs.read(payloadPath, "utf8");
            let parsed: unknown;
            try {
                parsed = JSON.parse(stored);
            } catch (error) {
                throw new Error(`Stored clipboard file list for ${JSON.stringify(id)} is malformed: ${errMessage(error)}.`);
            }
            if (!isStoredFileList(parsed)) {
                throw new Error(`Stored clipboard file list for ${JSON.stringify(id)} has an invalid shape.`);
            }
            return parsed;
        }

        const image = await this.app.fs.readBinary(payloadPath);
        return {
            type: "image",
            data: image.toString("base64"),
            mimeType: "image/png",
        };
    }

    async remove(...args: unknown[]): Promise<void> {
        const [id] = validateCallArguments("clipboard.remove", args, REMOVE_ARGUMENTS, { maxArgs: 1 });
        return api.removeClipboardItem(id);
    }

    async clear(...args: unknown[]): Promise<void> {
        validateCallArguments("clipboard.clear", args, [], { maxArgs: 0 });
        return api.clearClipboardHistory();
    }

    get aiVision(): IAiVisionDescriptor {
        return {
            kind: "ClipboardHistory",
            summary: "Stored clipboard history, newest first.",
            members: CLIPBOARD_MEMBERS,
            help: CLIPBOARD_HELP,
            summarize: async () => {
                const snapshot = await api.getClipboardHistory();
                return {
                    kind: "ClipboardHistory",
                    count: snapshot.items.length,
                    revision: snapshot.revision,
                    newestId: snapshot.items[0]?.id ?? null,
                };
            },
        };
    }

    private async readPage(offset: number, limit: number): Promise<{
        revision: number;
        offset: number;
        limit: number;
        total: number;
        items: ClipboardHistoryItem[];
    }> {
        const snapshot: ClipboardHistorySnapshot = await api.getClipboardHistory();
        return {
            revision: snapshot.revision,
            offset,
            limit,
            total: snapshot.items.length,
            items: snapshot.items.slice(offset, offset + limit),
        };
    }
}
