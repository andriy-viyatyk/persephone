import type { EnglishCatalogEntry } from "./common";

export const mainCatalog = {
    trayShowApp: { message: "Show App" },
    trayQuit: { message: "Quit" },
    unsavedChangesTitle: { message: "Unsaved changes" },
    unsavedChangesMessage: { message: "You have unsaved changes. Leave the page and discard them?" },
    unsavedChangesLeave: { message: "Leave" },
    unsavedChangesCancel: { message: "Cancel" },
} satisfies Record<string, EnglishCatalogEntry>;
