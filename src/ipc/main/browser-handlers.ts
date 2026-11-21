import { BrowserChannel, type BrowserNavigationIntentRequest, type BrowserRegisterRequest, type BrowserSetZoomRequest, type BrowserSitePermissionRegistrationRequest, type SetBrowserSitePermissionRequest } from "../browser-ipc";
import { browserService } from "../../main/browser-service";
import { browserPopupService } from "../../main/browser/browser-popup-service";
import { browserPageGuardService } from "../../main/browser/browser-page-guard-service";
import { guardedIpcHandle, guardedIpcOn } from "../../main/ipc-sender-guard";

export function initBrowserHandlers(): void {
    guardedIpcHandle(BrowserChannel.fullscreen, (event, request: { key: string; selector?: string }) => browserService.enterFullscreen(event, request));
    guardedIpcHandle(BrowserChannel.exitFullscreen, (event, request: { key: string }) => browserService.exitFullscreen(event, request));
    guardedIpcHandle(BrowserChannel.closePopup, (event, request: { registrationKey: string; popupId: string }) => browserPopupService.closePopup(event, request));
    guardedIpcHandle(BrowserChannel.closeOwnedPopups, (event, request: { registrationKey: string }) => browserPopupService.closeOwnedPopups(event, request));
    guardedIpcHandle(BrowserChannel.focusPopup, (event, request: { registrationKey: string; popupId: string }) => browserPopupService.focusPopup(event, request));
    guardedIpcHandle(BrowserChannel.insertPopupText, (event, request: { registrationKey: string; popupId: string; text: string }) => browserPopupService.insertPopupText(event, request));
    guardedIpcHandle(BrowserChannel.listPopups, (event, request: { registrationKey: string }) => browserPopupService.listPopups(event, request));
    guardedIpcHandle(BrowserChannel.setZoom, (event, request: BrowserSetZoomRequest) => browserService.setZoom(event, request));
    guardedIpcHandle(BrowserChannel.getSitePermissions, (event, request: BrowserSitePermissionRegistrationRequest) => browserService.getSitePermissions(event, request));
    guardedIpcHandle(BrowserChannel.setSitePermission, (event, request: SetBrowserSitePermissionRequest) => browserService.setSitePermission(event, request));
    guardedIpcHandle(BrowserChannel.resetSitePermissions, (event, request: BrowserSitePermissionRegistrationRequest) => browserService.resetSitePermissions(event, request));
    guardedIpcHandle(BrowserChannel.resolvePermissionRequest, (event, request: { requestId: string; decision: "allow" | "block" }) => browserService.resolvePermissionRequest(event, request));
    guardedIpcHandle(BrowserChannel.listPermissionDecisions, (_event, profileName: string) => browserService.listPermissionDecisions(profileName));
    guardedIpcHandle(BrowserChannel.removePermissionDecision, (_event, request: { profileName: string; origin: string; permission: string }) => browserService.removePermissionDecision(request));
    guardedIpcHandle(BrowserChannel.clearPermissionDecisions, (_event, profileName: string) => browserService.clearPermissionDecisions(profileName));
    guardedIpcOn(BrowserChannel.register, (event, request: BrowserRegisterRequest) => browserService.registerWebview(event, request));
    guardedIpcOn(BrowserChannel.unregister, (_event, key: string) => browserService.unregisterWebview(key));
    guardedIpcOn(BrowserChannel.setAudioMuted, (_event, key: string, muted: boolean) => browserService.setAudioMuted(key, muted));
    guardedIpcOn(BrowserChannel.exitHtmlFullscreen, (_event, key: string) => browserService.exitHtmlFullscreen(key));
    guardedIpcOn(BrowserChannel.allowPopups, (event, key: string) => browserPageGuardService.allowPopups(event, key));
    guardedIpcOn(BrowserChannel.navigationIntent, (event, request: BrowserNavigationIntentRequest) => browserPageGuardService.noteNavigationIntent(event, request));
    guardedIpcOn(BrowserChannel.hardReload, (_event, key: string) => browserService.hardReload(key));
    guardedIpcHandle(BrowserChannel.clearProfileData, (_event, partition: string) => browserService.clearProfileData(partition));
    guardedIpcHandle(BrowserChannel.clearCache, (_event, partition: string) => browserService.clearCache(partition));
    guardedIpcHandle(BrowserChannel.collectDom, (_event, key: string) => browserService.collectDom(key));
    guardedIpcHandle(BrowserChannel.collectLoadedResources, (_event, key: string) => browserService.collectLoadedResources(key));
}
