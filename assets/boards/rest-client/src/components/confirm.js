import { t } from "../i18n.js";

/**
 * In-board confirmation modal on the native <dialog> element, styled by styles/dialog.css.
 *
 * Never use window.confirm/alert/prompt in a board: a native JavaScript dialog raised from a board
 * frame blocks board frames app-wide until the main process restarts (seen 2026-10-05, US-1624).
 */
export function confirmDialog(message, { title = t("confirm.title"), okLabel = t("confirm.delete"), view = "main" } = {}) {
    const suffix = view === "requests" ? "requests" : "main";
    return new Promise((resolve) => {
        const dialog = document.createElement("dialog");
        dialog.dataset.name = `confirm-dialog-${suffix}`;
        const form = document.createElement("form");
        form.method = "dialog";

        const header = document.createElement("div");
        header.className = "dialog-header";
        const heading = document.createElement("span");
        heading.textContent = title;
        header.append(heading);

        const body = document.createElement("div");
        body.className = "dialog-body";
        body.textContent = message;

        const footer = document.createElement("div");
        footer.className = "dialog-footer";
        const cancel = document.createElement("button");
        cancel.value = "cancel";
        cancel.textContent = t("confirm.cancel");
        cancel.dataset.name = `confirm-cancel-${suffix}`;
        const ok = document.createElement("button");
        ok.value = "ok";
        ok.className = "primary";
        ok.textContent = okLabel;
        ok.dataset.name = `confirm-ok-${suffix}`;
        footer.append(cancel, ok);

        form.append(header, body, footer);
        dialog.append(form);
        dialog.addEventListener("close", () => {
            resolve(dialog.returnValue === "ok");
            dialog.remove();
        }, { once: true });
        document.body.append(dialog);
        dialog.showModal();
        ok.focus();
    });
}
