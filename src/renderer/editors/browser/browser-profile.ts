import { settings } from "../../api/settings";
import { browserProfiles } from "../../api/browser-profiles";
import type { BrowserProfile } from "../../api/settings-schema";
import { DEFAULT_BROWSER_COLOR } from "../../theme/palette-colors";

interface BrowserProfileState {
    isTor?: boolean;
    isIncognito?: boolean;
    profileName?: string;
}

type BrowserProfileSelection =
    | { kind: "setting"; key: "tor.bookmarks-file" | "browser-incognito-bookmarks-file" | "browser-default-bookmarks-file" }
    | { kind: "profile"; name: string };

export interface ResolvedBrowserProfile {
    profile: BrowserProfile | undefined;
    color: string;
    bookmarksFile: string;
    setBookmarksFile: (path: string) => void;
}

/** Resolve the browser mode, visual profile, and bookmark-file storage target once. */
export function resolveBrowserProfile(state: BrowserProfileState): ResolvedBrowserProfile {
    const defaultName = settings.get("browser-default-profile");
    const selection: BrowserProfileSelection = state.isTor
        ? { kind: "setting", key: "tor.bookmarks-file" }
        : state.isIncognito
            ? { kind: "setting", key: "browser-incognito-bookmarks-file" }
            : (() => {
                const name = state.profileName || defaultName;
                return name
                    ? { kind: "profile", name }
                    : { kind: "setting", key: "browser-default-bookmarks-file" };
            })();

    const profile = selection.kind === "profile"
        ? settings.get("browser-profiles").find((item) => item.name === selection.name)
        : undefined;
    const bookmarksFile = selection.kind === "setting"
        ? settings.get(selection.key) || ""
        : profile?.bookmarksFile || "";

    return {
        profile,
        color: profile?.color || DEFAULT_BROWSER_COLOR,
        bookmarksFile,
        setBookmarksFile: (path) => {
            if (selection.kind === "setting") {
                settings.set(selection.key, path);
                return;
            }

            browserProfiles.setBookmarksFile(selection.name, path);
        },
    };
}
