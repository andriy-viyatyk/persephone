const { ipcRenderer } = require("electron"); // eslint-disable-line @typescript-eslint/no-var-requires
import {
    BrowserChannel,
    type PageConsoleLevel,
    type PageConsoleRecord,
    type PageDialogPolicy,
    type PageDialogRecord,
    type PageErrorRecord,
    type PageEventsSnapshot,
} from "../../ipc/browser-ipc";
import { buildSnapshot, detectOverlay, type SnapshotOptions as SnapshotBuildOptions } from "./snapshot";
import { errMessage } from "../../shared/utils";
import type { IAutomationTarget } from "./types";


export interface SnapshotOptions extends Omit<SnapshotBuildOptions, "prefix" | "host"> {
    overlayHint: boolean;
    host?: "browser" | "app" | "board";
}

/** Build an accessibility snapshot and optionally prepend the existing overlay warning. */
export async function snapshot(
    target: IAutomationTarget,
    tabId: string | undefined,
    options: SnapshotOptions,
): Promise<string> {
    const cdp = target.cdp(tabId);
    const events = await readPageEvents(target, tabId);
    const overlayHint = options.overlayHint ? await detectOverlay(cdp) : null;
    const unreportedDialog = events.dialogs.find(dialog => !dialog.reported && dialog.disposition !== "pending");
    const prefixes = [
        overlayHint ? `# ${overlayHint}` : undefined,
        unreportedDialog ? `# Dialog: ${unreportedDialog.type}(${JSON.stringify(unreportedDialog.message)}) was ${unreportedDialog.disposition}` : undefined,
    ].filter((prefix): prefix is string => prefix !== undefined);
    const result = await buildSnapshot(cdp, {
        root: options.root,
        interactive: options.interactive,
        maxNodes: options.maxNodes,
        maxChars: options.maxChars,
        host: options.host,
        prefix: prefixes.length ? prefixes.join("\n") : undefined,
    });
    if (unreportedDialog) await ipcRenderer.invoke(BrowserChannel.markDialogReported, cdp.registrationKey);
    return result;
}

/** Keep the main-process automation activity lease around the complete public operation. */
export async function withAutomationActivity<T>(
    target: IAutomationTarget,
    tabId: string | undefined,
    operation: () => Promise<T>,
): Promise<T> {
    const key = target.cdp(tabId).registrationKey;
    try {
        await ipcRenderer.invoke(BrowserChannel.automationBegin, key);
    } catch (error: unknown) {
        // The pending-dialog preflight rejects here; hand the agent its message without
        // Electron's "Error invoking remote method '…': Error: " framing.
        throw new Error(errMessage(error).replace(/^Error invoking remote method '[^']*': (?:Error: )?/, ""));
    }
    try {
        return await operation();
    } finally {
        await ipcRenderer.invoke(BrowserChannel.automationEnd, key);
    }
}

async function readPageEvents(target: IAutomationTarget, tabId?: string): Promise<PageEventsSnapshot> {
    return ipcRenderer.invoke(BrowserChannel.getPageEvents, target.cdp(tabId).registrationKey);
}

export async function dialogs(target: IAutomationTarget, tabId?: string): Promise<{ policy: PageDialogPolicy; dialogs: Array<Omit<PageDialogRecord, "reported">> }> {
    const events = await readPageEvents(target, tabId);
    return { policy: events.policy, dialogs: events.dialogs.map(({ reported: _reported, ...record }) => record) };
}

export async function setDialogPolicy(target: IAutomationTarget, policy: PageDialogPolicy, tabId?: string): Promise<void> {
    await ipcRenderer.invoke(BrowserChannel.setDialogPolicy, target.cdp(tabId).registrationKey, policy);
}

export async function handlePageDialog(target: IAutomationTarget, accept: boolean, promptText?: string, tabId?: string): Promise<void> {
    await ipcRenderer.invoke(BrowserChannel.handleDialog, target.cdp(tabId).registrationKey, accept, promptText);
}

export async function consoleMessages(
    target: IAutomationTarget,
    options: { tabId?: string; since?: number; level?: PageConsoleLevel } = {},
): Promise<PageConsoleRecord[]> {
    const events = await readPageEvents(target, options.tabId);
    return events.consoleMessages.filter(record =>
        (options.since === undefined || record.timestamp >= options.since)
        && (options.level === undefined || record.type === options.level),
    );
}

export async function pageErrors(target: IAutomationTarget, tabId?: string): Promise<PageErrorRecord[]> {
    return (await readPageEvents(target, tabId)).pageErrors;
}

export async function ensureTargetReady(target: IAutomationTarget, tabId?: string): Promise<void> {
    await target.ensureReady?.(tabId);
}
