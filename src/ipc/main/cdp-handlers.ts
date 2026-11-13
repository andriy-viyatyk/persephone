import { BrowserChannel, type PageDialogPolicy, type BrowserResponsePattern, type BrowserResponseWaitOptions } from "../browser-ipc";
import { cdpService } from "../../main/cdp-service";
import { guardedIpcHandle } from "../../main/ipc-sender-guard";

export function initCdpHandlers(): void {
    guardedIpcHandle(BrowserChannel.getPageEvents, (event, key: string) => cdpService.getPageEvents(event, key));
    guardedIpcHandle(BrowserChannel.markDialogReported, (event, key: string) => cdpService.markDialogReported(event, key));
    guardedIpcHandle(BrowserChannel.setDialogPolicy, (event, key: string, policy: PageDialogPolicy) => cdpService.setDialogPolicy(event, key, policy));
    guardedIpcHandle(BrowserChannel.handleDialog, (event, key: string, accept: boolean, promptText?: string) => cdpService.handleDialog(event, key, accept, promptText));
    guardedIpcHandle(BrowserChannel.automationBegin, (event, key: string) => cdpService.automationBegin(event, key));
    guardedIpcHandle(BrowserChannel.automationEnd, (_event, key: string) => cdpService.automationEnd(key));
    guardedIpcHandle(BrowserChannel.armNavigationWait, (_event, key: string, options) => cdpService.armNavigationWait(key, options));
    guardedIpcHandle(BrowserChannel.awaitNavigationWait, (_event, token: string) => cdpService.awaitNavigationWait(token));
    guardedIpcHandle(BrowserChannel.armResponseWait, (event, key: string, pattern: string | BrowserResponsePattern, options: BrowserResponseWaitOptions) => cdpService.armResponseWait(event, key, pattern, options));
    guardedIpcHandle(BrowserChannel.awaitResponseWait, (_event, token: string) => cdpService.awaitResponseWait(token));
    guardedIpcHandle(BrowserChannel.armDragIntercept, (event, key: string, sessionId?: string) => cdpService.armDragIntercept(event, key, sessionId));
    guardedIpcHandle(BrowserChannel.takeDragIntercept, (_event, token: string, waitMs: number) => cdpService.takeDragIntercept(token, waitMs));
    guardedIpcHandle(BrowserChannel.cdpAttach, (event, key: string, options) => cdpService.cdpAttach(event, key, options));
    guardedIpcHandle(BrowserChannel.cdpDetach, (_event, key: string) => cdpService.cdpDetach(key));
    guardedIpcHandle(BrowserChannel.cdpSend, (event, key: string, method: string, params?: object, sessionId?: string) => cdpService.cdpSend(event, key, method, params, sessionId));
}
