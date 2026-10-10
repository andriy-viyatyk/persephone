// OS file-clipboard actions shared by TreeProviderViewModel and
// CategoryViewModel (US-807). Windows-Explorer-compatible copy/cut/paste of
// files — CF_HDROP interop via the clip-service IPC endpoints.
//
// Only meaningful for the local-filesystem provider (`provider.type === "file"`,
// where item hrefs are absolute paths) — callers gate menu items on
// `supportsOsClipboard`.

import type { ITreeProvider } from "../../api/types/io.tree";
import { api } from "../../../ipc/renderer/api";
import { ui } from "../../api/ui";
import { copyPathsInto } from "../../core/utils/copy-files";
import { fpBasename } from "../../core/utils/file-path";
import { DialogButton } from "../../ui/dialogs/dialog-buttons";
import { t } from "../../../shared/i18n/t";

/** OS clipboard copy/paste applies only where item hrefs are absolute local
 *  paths. Mneme / Link / Archive providers are excluded. */
export function supportsOsClipboard(provider: ITreeProvider): boolean {
    return provider.type === "file";
}

/** Put N files/folders on the OS clipboard (Windows Explorer can paste them).
 *  `cut: true` marks them for move — pasting (here or in Explorer) relocates them. */
export async function copyPathsToOsClipboard(paths: string[], cut: boolean): Promise<void> {
    if (!paths.length) return;
    const ok = await api.clipboardWriteFilePaths(paths, cut);
    if (!ok) {
        ui.notify(paths.length === 1
            ? t("menus.failedPutOneOnClipboard")
            : t("menus.failedPutManyOnClipboard"), "warning");
    }
}

/** Single-path shim over `copyPathsToOsClipboard` (kept for the many single-item
 *  call sites in TreeProviderViewModel and CategoryViewModel). */
export async function copyPathToOsClipboard(path: string, cut: boolean): Promise<void> {
    await copyPathsToOsClipboard([path], cut);
}

/** Paste the OS clipboard's file list into `targetDir`. Confirms overwrites,
 *  shows progress, honors cut (move) semantics, and empties a fully-consumed
 *  "cut" clipboard the way Windows Explorer does.
 *  Returns true when anything might have changed (caller should refresh). */
export async function pasteOsClipboardInto(
    provider: ITreeProvider,
    targetDir: string,
): Promise<boolean> {
    const clip = await api.clipboardReadFilePaths();
    if (!clip.paths.length) {
        ui.notify(t("menus.clipboardNoFiles"), "info");
        return false;
    }
    const move = clip.dropEffect === "cut";

    // Collision confirm BEFORE the progress overlay (same wording as the
    // drag-drop import in TreeProviderViewModel.importFiles).
    const existing = new Set(
        (await provider.list(targetDir)).map((l) => l.title.toLowerCase()),
    );
    const clashing = clip.paths
        .map((p) => fpBasename(p))
        .filter((name) => existing.has(name.toLowerCase()));
    if (clashing.length) {
        const bt = await ui.confirm(
            t("menus.overwriteItems", { count: clashing.length, names: clashing.join(", ") } as never),
            { title: t("menus.overwrite"), buttons: [DialogButton.overwrite, DialogButton.cancel] },
        );
        if (bt !== DialogButton.overwrite) return false;
    }

    const progress = await ui.createProgress(move
        ? t("menus.movingProgressTitle")
        : t("menus.copyingProgressTitle"));
    try {
        const result = await progress.show(
            copyPathsInto(clip.paths, targetDir, {
                move,
                onProgress: (done, total, name) => {
                    progress.label = move
                        ? t("menus.movingProgress", { done, total, name })
                        : t("menus.copyingProgress", { done, total, name });
                },
            }),
        );
        if (result.errors.length) {
            const shown = result.errors.slice(0, 5).join("\n");
            const remaining = result.errors.length - 5;
            ui.notify(remaining > 0
                ? t("menus.itemsCouldNotBePastedWithMore", { errors: shown, count: remaining } as never)
                : t("menus.itemsCouldNotBePasted", { errors: shown }), "warning");
        } else if (move) {
            // Cut clipboard fully consumed — clear it so a second paste
            // doesn't fail on the now-moved sources (Explorer behavior).
            await api.clipboardWriteFilePaths([], false);
        }
    } catch (err) {
        ui.notify(err?.message || t("menus.failedToPaste"), "warning");
    }
    return true;
}
