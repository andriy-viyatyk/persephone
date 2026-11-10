interface BookmarkProfileState {
    isTor?: boolean;
    isIncognito?: boolean;
    profileName?: string;
}

type BookmarkProfileSelection =
    | { kind: "setting"; key: "tor.bookmarks-file" | "browser-incognito-bookmarks-file" | "browser-default-bookmarks-file" }
    | { kind: "profile"; name: string };

export function bookmarkProfileSelection(state: BookmarkProfileState, defaultName: string): BookmarkProfileSelection {
    if (state.isTor) return { kind: "setting", key: "tor.bookmarks-file" };
    if (state.isIncognito) return { kind: "setting", key: "browser-incognito-bookmarks-file" };
    const name = state.profileName || defaultName;
    return name ? { kind: "profile", name } : { kind: "setting", key: "browser-default-bookmarks-file" };
}
