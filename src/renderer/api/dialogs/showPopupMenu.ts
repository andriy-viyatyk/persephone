import { closePopper, showPopper, visiblePoppers } from "./dialogs-state";
import { TPopperModel, type IPopperViewData } from "./dialog-types";
import type { MenuItem } from "../../uikit/Menu";
import { CopyIcon, CursorIcon, EmptyIcon } from "../../theme/icons";
import { TComponentState } from "../../core/state/state";
import { toClipboard } from "../../core/utils/utils";
import { restoreFocus } from "../../uikit/shared/focus-restore";
import { api } from "../../../ipc/renderer/api";
import { t } from "../../../shared/i18n/t";

const defaultAppPopupMenuState = {
    x: 0,
    y: 0,
    items: [] as MenuItem[],
    skipInspect: false,
    skipDefaults: false,
};

export type AppPopupMenuState = typeof defaultAppPopupMenuState;

export class AppPopupMenuModel extends TPopperModel<AppPopupMenuState, void> {
    addDefaultMenus = async () => {
        if (this.state.get().skipDefaults) return;
        const savedSelection = window.getSelection();
        const selText = savedSelection?.toString();
        const activeElement = document.activeElement;
        const isInputOrTextareaFocused =
            activeElement instanceof HTMLInputElement ||
            activeElement instanceof HTMLTextAreaElement;
        const isEditableDivFocused =
            activeElement instanceof HTMLDivElement &&
            (activeElement.contentEditable === "true" ||
                activeElement.contentEditable === "plaintext-only");
        const clipboardText =
            isInputOrTextareaFocused || isEditableDivFocused
                ? await navigator.clipboard.readText()
                : "";
        let savedRange = null as Range | null;
        if (clipboardText && isEditableDivFocused) {
            if (savedSelection && savedSelection.rangeCount > 0) {
                savedRange = savedSelection.getRangeAt(0).cloneRange();
            }
        }

        this.state.update((s) => {
            if (clipboardText) {
                s.items.unshift({
                    label: t("dialogs.popupPaste"),
                    onClick: () => {
                        if (
                            activeElement instanceof HTMLInputElement ||
                            activeElement instanceof HTMLTextAreaElement
                        ) {
                            activeElement.focus();
                            document.execCommand(
                                "insertText",
                                false,
                                clipboardText
                            );
                        } else if (
                            activeElement instanceof HTMLDivElement &&
                            (activeElement.contentEditable === "true" ||
                                activeElement.contentEditable ===
                                    "plaintext-only")
                        ) {
                            // activeElement.focus();
                            if (savedSelection && savedRange) {
                                const textNode =
                                    document.createTextNode(clipboardText);

                                // Delete any selected content before inserting
                                savedRange.deleteContents();

                                // Insert the text node at the cursor position
                                savedRange.insertNode(textNode);

                                // Collapse the range to the end of the newly inserted text
                                savedRange.setStartAfter(textNode);
                                savedRange.setEndAfter(textNode);

                                // Update the selection to the new cursor position
                                savedSelection.removeAllRanges();
                                savedSelection.addRange(savedRange);
                            }

                            // Dispatch input event so contentEditable handlers (e.g., TextAreaField) update
                            activeElement.dispatchEvent(new Event("input", { bubbles: true }));
                        }
                    },
                    icon: CopyIcon.createElement({}),
                });
            }

            if (selText) {
                s.items.unshift({
                    label: t("dialogs.popupCopy"),
                    onClick: () => {
                        toClipboard(selText ?? "");
                    },
                    icon: CopyIcon.createElement({}),
                    startGroup: true,
                });
            }

            if (!s.skipInspect) {
                s.items.push({
                    id: "inspect",
                    label: t("dialogs.popupInspect"),
                    startGroup: s.items.length > 0,
                    onClick: () => {
                        const { x, y } = this.state.get();
                        api.inspectElement(x, y);
                    },
                    icon: CursorIcon.createElement({}),
                });
            }

            const anyIcon = s.items.some((item) => Boolean(item.icon));
            if (anyIcon) {
                s.items.forEach((item) => {
                    if (!item.icon) {
                        item.icon = EmptyIcon.createElement({});
                    }
                });
            }
        });
    };
}

export const showAppPopupMenuId = Symbol("AppPopupMenu");

export interface ShowAppPopupMenuOptions {
    /** Skip the default "Inspect" menu item (e.g. when the caller provides its own). */
    skipInspect?: boolean;
    /** Omit all clipboard and inspect entries. */
    skipDefaults?: boolean;
    /** Recheck a caller's document after asynchronous menu preparation. */
    isCurrent?: () => boolean;
}

/** Close any currently open app popup menu. */
export const closeAppPopupMenu = () => {
    const popup = getVisibleAppPopupMenu();
    return popup?.model.close(undefined);
};

/** Activate a current popup item using the same callback-then-close sequence as a user click. */
export async function activateAppPopupMenuItem(
    popup: IPopperViewData,
    item: MenuItem,
    indexPath: readonly number[],
    label: string,
): Promise<void> {
    if (getVisibleAppPopupMenu() !== popup) {
        throw new Error(`Popup menu item ${JSON.stringify(label)} is no longer available.`);
    }
    const items = popup.model.state.get().items as MenuItem[];
    let currentItems = items;
    let currentItem: MenuItem | undefined;
    for (const index of indexPath) {
        currentItem = currentItems[index];
        if (!currentItem) {
            throw new Error(`Popup menu item ${JSON.stringify(label)} is no longer available.`);
        }
        currentItems = currentItem.items ?? [];
    }
    if (currentItem !== item || currentItem.invisible || currentItem.disabled || currentItem.items?.length) {
        throw new Error(`Popup menu item ${JSON.stringify(label)} is no longer available.`);
    }
    item.onClick?.();
    await popup.model.close(undefined);
}

/** Return the live application popup without invoking or serializing any menu callbacks. */
export function getVisibleAppPopupMenu(): IPopperViewData | undefined {
    return visiblePoppers().find(({ viewId }) => viewId === showAppPopupMenuId);
}

export const showAppPopupMenu = async (
    x: number,
    y: number,
    items: MenuItem[],
    options?: ShowAppPopupMenuOptions,
) => {
    // Close any existing popup menu before showing a new one.
    // This handles cases where the close-on-click-outside doesn't fire
    // (e.g. right-click inside a webview goes through IPC, not DOM).
    closePopper(showAppPopupMenuId);

    // Save focused element to restore after menu closes
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const state = new TComponentState(defaultAppPopupMenuState);
    state.update((s) => {
        s.x = x;
        s.y = y;
        s.items = [...items];
        s.skipInspect = options?.skipInspect || false;
        s.skipDefaults = options?.skipDefaults || false;
    });
    const model = new AppPopupMenuModel(state);
    await model.addDefaultMenus();
    if (options?.isCurrent && !options.isCurrent()) return;
    if (!model.state.get().items.length) {
        return;
    }
    await showPopper<void>({
        viewId: showAppPopupMenuId,
        model,
    });

    // Restore focus after menu closes
    if (previouslyFocused) restoreFocus(previouslyFocused);
};
