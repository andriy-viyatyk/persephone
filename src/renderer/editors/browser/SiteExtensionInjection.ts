export interface SiteExtensionInjectionExpressionOptions {
    host: string;
    id: string;
    policyExpression: string;
    params: string;
    runtime: string;
    source: string;
}

export interface SiteExtensionInjectionExpression {
    expression: string;
    sourceStartLine: number;
}

export function temporarySiteExtensionPredicate(hostname: string, explicitPort?: number): string {
    const expectedPort = explicitPort === undefined
        ? "(current.protocol === \"https:\" ? 443 : 80)"
        : String(explicitPort);
    return `(() => { try { const current = new URL(location.href); const port = Number(current.port || (current.protocol === "https:" ? "443" : current.protocol === "http:" ? "80" : "0")); return (current.protocol === "http:" || current.protocol === "https:") && current.hostname.toLowerCase() === ${JSON.stringify(hostname)} && port === ${expectedPort}; } catch { return false; } })()`;
}

/** Builds the common main-world expression after the host has approved a selected source. */
export class SiteExtensionInjection {
    static createExpression(options: SiteExtensionInjectionExpressionOptions): SiteExtensionInjectionExpression {
        const { host, id, policyExpression, params, runtime, source } = options;
        const prefix = `(() => {
    const host = ${JSON.stringify(host)};
    const params = ${params};
    const freezeParams = value => { if (value && typeof value === "object") { Object.values(value).forEach(freezeParams); Object.freeze(value); } return value; };
    freezeParams(params);
    if (!(${policyExpression})) return "host-mismatch";
    if (window.__persephoneSiteExtension) return "already-injected";
    Object.defineProperty(window, "__persephoneSiteExtension", {
        value: { id: ${JSON.stringify(id)}, host }, enumerable: false, configurable: true,
    });
${runtime}
    try {
`;
        const suffix = `
    } catch (error) {
        console.error("[site-extension] " + ${JSON.stringify(id)} + ":", error);
        let message = "Unknown page error";
        try { message = error && typeof error === "object" && typeof error.message === "string" ? error.message : String(error); }
        catch { /* retain the safe fallback */ }
        let stack = "";
        try { stack = error && typeof error === "object" && typeof error.stack === "string" ? error.stack : ""; }
        catch { /* retain the safe fallback */ }
        return "extension-error:" + JSON.stringify({ message, stack });
    }
    return "ok";
})()`;
        return { expression: prefix + source + suffix, sourceStartLine: prefix.split("\n").length };
    }

    static createTeardownExpression(policyExpression: string, expectedId?: string): string {
        const documentGuard = expectedId === undefined ? "" : `if (window.__persephoneSiteExtension?.id !== ${JSON.stringify(expectedId)}) return "not-current";`;
        return `(() => {
    if (!(${policyExpression})) return "host-mismatch";
    ${documentGuard}
    window.__persephoneSiteRuntime?.dispose?.();
    delete window.__persephoneSiteExtension;
    delete window.__persephoneSiteRuntime;
    return "ok";
})()`;
    }

    static createExistingTeardownExpression(policyExpression: string): string {
        return `(() => {
    if (!(${policyExpression})) return "host-mismatch";
    if (!window.__persephoneSiteExtension) return "none";
    window.__persephoneSiteRuntime?.dispose?.();
    delete window.__persephoneSiteExtension;
    delete window.__persephoneSiteRuntime;
    return "ok";
})()`;
    }
}
