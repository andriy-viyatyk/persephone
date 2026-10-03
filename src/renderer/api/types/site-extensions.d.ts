export interface SiteExtensionCreateOptions {
    name: string;
    hosts: string[];
    description?: string;
}

export interface SiteExtensionCreateResult {
    id: string;
    folder: string;
    manifestPath: string;
    scriptPath: string;
    requiresTrust: true;
    message: string;
}

export interface SiteExtensionRemoveResult {
    /** Whether an extension folder was deleted. */
    removed: boolean;
    /** Whether an existing user trust grant was revoked. */
    revokedTrust: boolean;
}

export interface SiteExtensionAgentListing {
    id: string;
    name?: string;
    version?: string;
    hosts?: string[];
    scriptPath?: string;
    status: "valid" | "invalid" | "conflict";
    reason?: string;
    conflictingHosts?: string[];
    trustState: "untrusted" | "trusted" | "disabled";
    hostsChangedSinceTrust: boolean | undefined;
}

export interface SiteExtensionReloadResult {
    status: "injected" | "waiting-for-user" | "disabled" | "no-extension" | "extension-error" | "not-current";
    registered: boolean;
    error?: string;
}

/**
 * Inspect and manage injected AiVision models for HTTPS sites.
 * Creating an extension writes files but never trusts it; the user must approve it in the
 * matching browser page's Trust bar before it can run.
 *
 * @example
 * const created = await app.siteExtensions.create("example-site", {
 *     name: "Example Site", hosts: ["example.com"],
 * });
 * await app.fs.write(created.scriptPath, "// Replace the starter extension script.");
 * const result = await app.siteExtensions.reload(pageId);
 */
export interface ISiteExtensions {
    /** Effective site-extension root folder. Read-only; await the promise to get its path. */
    readonly folder: Promise<string>;
    /** List extension validation, conflict, and derived trust state. */
    list(): Promise<SiteExtensionAgentListing[]>;
    /** Scaffold an extension. The user must click Trust in the matching browser page before it runs. */
    create(id: string, options: SiteExtensionCreateOptions): Promise<SiteExtensionCreateResult>;
    /** Re-inject the trusted extension into the browser page's current document. */
    reload(pageId: string): Promise<SiteExtensionReloadResult>;
    /** Ask before deleting extension files and revoking its trust grant. */
    remove(id: string): Promise<SiteExtensionRemoveResult>;
}
