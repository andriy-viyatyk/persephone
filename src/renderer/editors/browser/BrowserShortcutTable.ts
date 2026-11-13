type BrowserShortcutScope = "root" | "global" | "both";

interface BrowserShortcut {
    scope: BrowserShortcutScope;
    matches: (event: KeyboardEvent) => boolean;
    run: () => void;
}

export interface BrowserShortcutActions {
    focusUrlInput: () => void;
    openFind: () => void;
    isFindVisible: () => boolean;
    closeFind: () => void;
    stopActiveGuest: () => void;
    reloadOrStop: () => void;
    hardReload: () => void;
    openDevTools: () => void;
    goBack: () => void;
    goForward: () => void;
    goHome: () => void;
    isFocused: () => boolean;
}

/** BrowserEditor-owned keyboard map shared by its root and global event sources. */
export class BrowserShortcutTable {
    private readonly shortcuts: BrowserShortcut[];

    constructor(private readonly actions: BrowserShortcutActions) {
        this.shortcuts = [
            {
                scope: "root",
                matches: (event) => event.ctrlKey && event.key === "l",
                run: actions.focusUrlInput,
            },
            {
                scope: "both",
                matches: (event) => event.ctrlKey && event.key.toLowerCase() === "f",
                run: actions.openFind,
            },
            {
                scope: "global",
                matches: (event) => event.key === "F5" && !event.ctrlKey,
                run: actions.reloadOrStop,
            },
            {
                scope: "global",
                matches: (event) => event.key === "F5" && event.ctrlKey,
                run: actions.hardReload,
            },
            {
                scope: "global",
                matches: (event) => event.key.toLowerCase() === "r" && event.ctrlKey && !event.shiftKey,
                run: actions.reloadOrStop,
            },
            {
                scope: "global",
                matches: (event) => event.key.toLowerCase() === "r" && event.ctrlKey && event.shiftKey,
                run: actions.hardReload,
            },
            {
                scope: "global",
                matches: (event) => event.key === "F12",
                run: actions.openDevTools,
            },
            {
                scope: "global",
                matches: (event) => event.key === "Escape",
                run: () => actions.isFindVisible() ? actions.closeFind() : actions.stopActiveGuest(),
            },
            {
                scope: "global",
                matches: (event) => event.altKey && event.key === "ArrowLeft",
                run: actions.goBack,
            },
            {
                scope: "global",
                matches: (event) => event.altKey && event.key === "ArrowRight",
                run: actions.goForward,
            },
            {
                scope: "global",
                matches: (event) => event.altKey && event.key === "Home",
                run: actions.goHome,
            },
        ];
    }

    dispatch(event: KeyboardEvent, source: "root" | "global"): void {
        if (source === "global" && (event.defaultPrevented || !this.actions.isFocused())) return;

        for (const shortcut of this.shortcuts) {
            if (shortcut.scope !== "both" && shortcut.scope !== source) continue;
            if (!shortcut.matches(event)) continue;
            event.preventDefault();
            shortcut.run();
            return;
        }
    }
}
