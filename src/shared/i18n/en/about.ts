import type { EnglishCatalogEntry } from "./common";

export const aboutCatalog = {
    version: { message: "Version {version}" },
    repository: { message: "Repository" },
    githubRepository: { message: "{brand} Repository" },
    reportIssue: { message: "Report Issue" },
    checkUpdates: { message: "Check for Updates" },
    checkingUpdates: { message: "Checking for updates…" },
    newVersionAvailable: { message: "New version {version} available!" },
    download: { message: "Download" },
    whatsNew: { message: "What's New" },
    upToDate: { message: "You're up to date!" },
    availableBoards: { message: "Available boards" },
    viewFullWhatsNew: { message: "View full What's New" },
    resources: { message: "Resources:" },
    issues: { message: "Issues" },
    boardsCatalogue: { message: "Boards catalogue" },
    mcpSetup: { message: "{protocol} setup" },
    showAgentGuides: { message: "Show agent guides" },
    noGuides: { message: "No guides available." },
    back: { message: "Back", note: "Back button on an agent guide page; returns to the guide index." },
    openInTab: { message: "Open in tab" },
} satisfies Record<string, EnglishCatalogEntry>;
