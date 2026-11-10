import { BrowserWindow, type WebContents } from "electron";
import { guardedIpcHandle } from "./ipc-sender-guard";
import { randomUUID } from "crypto";
import { BoardDialogChannel, type BoardDialogRecord } from "../ipc/board-dialog-ipc";
import { onWebContentsGone } from "./webcontents-lifetime";

interface Pending {
    record: BoardDialogRecord;
    host: WebContents;
    resolve: (answer: string | boolean | null) => void;
}

const pending: Pending[] = [];
const history = new Map<number, BoardDialogRecord[]>();
const watched = new WeakSet<WebContents>();

function notify(host: WebContents): void {
    if (!host.isDestroyed()) host.send(BoardDialogChannel.changed, pending.filter(item => item.host === host).map(item => item.record));
}

function finish(item: Pending, accept: boolean, text?: string): void {
    const index = pending.indexOf(item);
    if (index < 0) return;
    pending.splice(index, 1);
    item.record.disposition = accept ? "accepted" : "dismissed";
    item.resolve(item.record.type === "prompt" ? (accept ? text ?? item.record.defaultPrompt : null) : item.record.type === "confirm" ? accept : null);
    notify(item.host);
}

export function cancelBoardDialogs(key: string): void {
    for (const item of [...pending]) if (item.record.key === key) finish(item, false);
}

function watch(host: WebContents): void {
    if (watched.has(host)) return;
    watched.add(host);
    const cancel = (): void => {
        for (const item of [...pending]) if (item.host === host) finish(item, false);
        history.delete(host.id);
    };
    host.on("did-start-navigation", details => {
        if (details.isMainFrame) { cancel(); return; }
        if (details.isSameDocument) return;
        const previousUrl = details.frame?.url;
        if (previousUrl) for (const item of [...pending]) {
            if (item.host === host && item.record.url === previousUrl) finish(item, false);
        }
    });
    onWebContentsGone(host, cancel, { events: ["render-process-gone", "destroyed"], repeat: true });
    BrowserWindow.fromWebContents(host)?.on("close", cancel);
}

export function requestBoardDialog(host: WebContents, key: string, input: Pick<BoardDialogRecord, "type" | "message" | "defaultPrompt" | "url" | "title" | "pageId">, signal: AbortSignal): Promise<string | boolean | null> {
    if (host.isDestroyed()) return Promise.resolve(null);
    watch(host);
    const record: BoardDialogRecord = { ...input, id: randomUUID(), key, disposition: "pending", timestamp: Date.now() };
    const records = history.get(host.id) ?? [];
    records.push(record);
    if (records.length > 100) records.shift();
    history.set(host.id, records);
    return new Promise(resolve => {
        const item: Pending = { record, host, resolve: answer => { signal.removeEventListener("abort", abort); resolve(answer); } };
        const abort = (): void => finish(item, false);
        pending.push(item);
        if (signal.aborted) abort();
        else { signal.addEventListener("abort", abort, { once: true }); notify(host); }
    });
}

guardedIpcHandle(BoardDialogChannel.list, event => (history.get(event.sender.id) ?? []).map(record => ({ ...record })));
guardedIpcHandle(BoardDialogChannel.answer, (event, id: string, accept: boolean, text?: string) => {
    const item = pending.find(entry => entry.host === event.sender && entry.record.id === id);
    if (item) finish(item, accept === true, typeof text === "string" ? text : undefined);
});
