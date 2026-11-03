import type { EnglishCatalogEntry } from "./common";

export const mainCatalog = {
    profileErrorTitle: { message: "Invalid application profile" },
    profileError: { message: "Specify one profile name of 1–32 letters, numbers or hyphens; default is reserved." },
    trayShowApp: { message: "Show App" },
    trayQuit: { message: "Quit" },
    unsavedChangesTitle: { message: "Unsaved changes" },
    unsavedChangesMessage: { message: "You have unsaved changes. Leave the page and discard them?" },
    unsavedChangesLeave: { message: "Leave" },
    unsavedChangesCancel: { message: "Cancel" },
} satisfies Record<string, EnglishCatalogEntry>;
