import type { SiteExtensionRecord } from "../../api/site-extensions";

export interface SiteExtensionTrustPromptData {
    internalTabId: string;
    documentId: number;
    id: string;
    name: string;
    host: string;
    hosts: string[];
    fetchHosts: string[];
    available: boolean;
}

export class SiteExtensionTrustPrompt {
    static from(extension: SiteExtensionRecord, tabId: string, docId: number, host: string): SiteExtensionTrustPromptData {
        return {
            internalTabId: tabId,
            documentId: docId,
            id: extension.id,
            name: extension.name,
            host,
            hosts: [...extension.hosts],
            fetchHosts: [...extension.fetchHosts],
            available: true,
        };
    }
}
