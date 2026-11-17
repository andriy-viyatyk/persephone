import { BrowserWindow, type WebContents } from "electron";
import fs from "node:fs";
import path from "node:path";
import { browserGuests, type BrowserContentsAttachment } from "../browser/BrowserGuestRegistry";
import { browserPopups } from "../browser/BrowserPopupRegistry";
import { openWindows } from "../open-windows";
import { subscribeNetworkLog, type NetworkOutcome } from "../network-logger";

const MAX_CONSOLE_MESSAGE_CHARS = 8_192;
const MAX_SOURCE_CHARS = 2_048;
const MAX_URL_CHARS = 8_192;
const MAX_ERROR_CHARS = 2_048;

type ConsoleDetails = Electron.Event<Electron.WebContentsConsoleMessageEventParams>;
interface ConsoleAttachment {
    contents: WebContents;
    listener: (details: ConsoleDetails) => void;
    destroyed: () => void;
}

function bounded(value: string, maxLength: number): { value: string; truncated: boolean } {
    return value.length > maxLength ? { value: value.slice(0, maxLength), truncated: true } : { value, truncated: false };
}

export class TestModeLog {
    private readonly descriptors = new Map<string, number>();
    private readonly consoleAttachments = new Map<number, ConsoleAttachment>();
    private readonly unsubscribers: Array<() => void> = [];

    constructor(private readonly directory: string) {}

    start(): void {
        fs.mkdirSync(this.directory, { recursive: true });
        for (const name of ["app-console.log", "site-console.log", "network.log"]) {
            this.descriptors.set(name, fs.openSync(path.join(this.directory, name), "a"));
        }
        this.unsubscribers.push(
            openWindows.subscribeWindowCreated((window) => this.attachAppWindow(window)),
            browserGuests.subscribeAttachments((attachment) => this.handleBrowserAttachment(attachment)),
            browserPopups.subscribeAttachments((attachment) => this.handleBrowserAttachment(attachment)),
            subscribeNetworkLog((outcome) => this.writeNetwork(outcome)),
        );
    }

    dispose(): void {
        for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
        for (const attachment of [...this.consoleAttachments.values()]) this.detachConsole(attachment.contents.id);
        for (const descriptor of this.descriptors.values()) fs.closeSync(descriptor);
        this.descriptors.clear();
    }

    private attachAppWindow(window: BrowserWindow): void {
        if (window.isDestroyed()) return;
        this.attachConsole(window.webContents, (details) => {
            const message = bounded(details.message, MAX_CONSOLE_MESSAGE_CHARS);
            const source = bounded(details.sourceId, MAX_SOURCE_CHARS);
            this.write("app-console.log", {
                event: "console-message", windowId: window.id, level: details.level, message: message.value,
                source: source.value, line: details.lineNumber,
                ...(message.truncated || source.truncated ? { truncated: true } : {}),
            });
        });
    }

    private handleBrowserAttachment(attachment: BrowserContentsAttachment): void {
        if (attachment.type === "detach") {
            this.detachConsole(attachment.webContents.id);
            return;
        }
        const { webContents, pageId, editorId, popupId } = attachment;
        this.attachConsole(webContents, (details) => {
            const message = bounded(details.message, MAX_CONSOLE_MESSAGE_CHARS);
            const source = bounded(details.sourceId, MAX_SOURCE_CHARS);
            this.write("site-console.log", {
                event: "console-message", pageId: pageId ?? null, editorId,
                ...(popupId === undefined ? {} : { popupId }),
                level: details.level, message: message.value, source: source.value, line: details.lineNumber,
                ...(message.truncated || source.truncated ? { truncated: true } : {}),
            });
        });
    }

    private attachConsole(contents: WebContents, onMessage: (details: ConsoleDetails) => void): void {
        if (contents.isDestroyed() || this.consoleAttachments.has(contents.id)) return;
        const listener = (details: ConsoleDetails): void => onMessage(details);
        const destroyed = (): void => this.detachConsole(contents.id);
        contents.on("console-message", listener);
        contents.once("destroyed", destroyed);
        this.consoleAttachments.set(contents.id, { contents, listener, destroyed });
    }

    private detachConsole(webContentsId: number): void {
        const attachment = this.consoleAttachments.get(webContentsId);
        if (!attachment) return;
        this.consoleAttachments.delete(webContentsId);
        if (!attachment.contents.isDestroyed()) {
            attachment.contents.removeListener("console-message", attachment.listener);
            attachment.contents.removeListener("destroyed", attachment.destroyed);
        }
    }

    private writeNetwork(outcome: NetworkOutcome): void {
        const url = bounded(outcome.url, MAX_URL_CHARS);
        const error = outcome.error === undefined ? undefined : bounded(outcome.error, MAX_ERROR_CHARS);
        this.write("network.log", {
            event: outcome.error === undefined ? "request-completed" : "request-failed",
            pageId: outcome.pageId, editorId: outcome.editorId,
            ...(outcome.popupId === undefined ? {} : { popupId: outcome.popupId }),
            method: outcome.method, url: url.value, resourceType: outcome.resourceType,
            startedAt: outcome.startedAt, elapsedMs: outcome.elapsedMs,
            ...(outcome.statusCode === undefined ? {} : { statusCode: outcome.statusCode }),
            ...(error === undefined ? {} : { error: error.value }),
            ...(url.truncated || error?.truncated ? { truncated: true } : {}),
        });
    }

    private write(fileName: string, event: Record<string, unknown>): void {
        const descriptor = this.descriptors.get(fileName);
        if (descriptor === undefined) return;
        fs.writeSync(descriptor, `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`, undefined, "utf8");
    }
}

let configuredDirectory: string | undefined;
let activeLogger: TestModeLog | undefined;

export function configureTestModeLog(directory?: string): void {
    configuredDirectory = directory;
}

export function startTestModeLog(): void {
    if (!configuredDirectory) return;
    activeLogger = new TestModeLog(configuredDirectory);
    activeLogger.start();
}

export function disposeTestModeLog(): void {
    activeLogger?.dispose();
    activeLogger = undefined;
}
