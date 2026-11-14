import type { PageModel } from "./PageModel";
import type { OpenFilesState } from "./PagesModel";
import { isAudibleEditor } from "../../editors/base/audible-editor";

export type PageTabViewMode = "main" | "right";
export type PageTabPinSide = "left" | "right" | undefined;

export interface TabSoundInputs {
    anyTabAudible: boolean;
    pageMuted: boolean;
    soundButtonWhenSilent: boolean;
}

interface TabSoundState {
    _anyTabAudible?: boolean;
    pageMuted?: boolean;
}

export interface TabMenuAvailability {
    lockedBoard: boolean;
    unpin: boolean;
    pinLeft: boolean;
    pinRight: boolean;
    close: boolean;
    closeOthers: boolean;
    closeRight: boolean;
    detach: boolean;
    detachDisabled: boolean;
    duplicate: boolean;
}

export function tabIsActive(state: OpenFilesState, id: string): boolean {
    const activeId = state.ordered[state.ordered.length - 1]?.id;
    const groupedId = activeId ? state.leftRight.get(activeId) ?? state.rightLeft.get(activeId) : undefined;
    return id === activeId || id === groupedId;
}

export function tabIsGrouped(state: OpenFilesState, id: string): boolean {
    return state.leftRight.has(id) || state.rightLeft.has(id);
}

export function tabPopoverIsOpen(state: OpenFilesState, id: string): boolean {
    return state.popoverPageId === id;
}

export function tabSoundInputs(editor?: unknown, editorState?: TabSoundState, hostState?: TabSoundState): TabSoundInputs {
    const audibleEditor = isAudibleEditor(editor) ? editor : undefined;
    let anyTabAudible = audibleEditor?.audible ?? editorState?._anyTabAudible ?? false;
    let pageMuted = audibleEditor?.muted ?? editorState?.pageMuted ?? false;
    if (hostState && Object.prototype.propertyIsEnumerable.call(hostState, "_anyTabAudible")) {
        anyTabAudible = hostState._anyTabAudible ?? false;
    }
    if (hostState && Object.prototype.propertyIsEnumerable.call(hostState, "pageMuted")) {
        pageMuted = hostState.pageMuted ?? false;
    }
    return {
        anyTabAudible,
        pageMuted,
        soundButtonWhenSilent: audibleEditor?.soundButtonWhenSilent
            ?? Boolean((editor as { toggleMuteAll?: () => void } | null)?.toggleMuteAll),
    };
}

export function tabMenuAvailability(page: PageModel, mode: PageTabViewMode): TabMenuAvailability {
    const isRight = mode === "right";
    const isLeftPinned = page.pinSide === "left";
    return {
        lockedBoard: page.isLockedBoardPage,
        unpin: !page.isInert && (isRight || isLeftPinned),
        pinLeft: !page.isInert && (isRight || !isLeftPinned),
        pinRight: !page.isInert && !isRight,
        close: !isRight && !page.pinned,
        closeOthers: !isRight,
        closeRight: !isRight && !page.pinned,
        detach: !isRight && !page.pinned,
        detachDisabled: page.isInert,
        duplicate: !isRight && !page.isInert,
    };
}

export function canDrag(page?: PageModel): boolean {
    return page?.isLockedBoardPage !== true;
}

export function canPinTo(page: PageModel): boolean {
    return !page.isLockedBoardPage && !page.isInert;
}

export function canSetPinSide(page: PageModel, value: PageTabPinSide): boolean {
    return !page.isInert && (!page.isLockedBoardPage || value === undefined);
}

export function canGroupLocked(page?: PageModel): boolean {
    return page?.isLockedBoardPage !== true;
}

export function canUngroup(state: Pick<OpenFilesState, "leftRight" | "rightLeft">, id: string): boolean {
    return state.leftRight.has(id) || state.rightLeft.has(id);
}

export function canBulkClose(page: PageModel): boolean {
    return !page.isLockedBoardPage && page.pinSide === undefined;
}

export function canBeginDetach(page: PageModel): boolean {
    return !page.isLockedBoardPage && !page.isInert;
}

export function canDuplicateModel(page?: PageModel): boolean {
    return Boolean(page?.mainEditor) && !page?.isInert;
}

export function canCloseNormal(page: PageModel): boolean {
    return !page.isLockedBoardPage && page.pinSide !== "right";
}
