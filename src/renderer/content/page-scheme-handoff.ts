import { app } from "../api/app";
import { createLinkData } from "../../shared/link-data";
import { guard } from "../core/utils/guard";
import { fpBasename } from "../core/utils/file-path";
import { t } from "../../shared/i18n/t";
import { boardSchemeOwner, schemeOf } from "./scheme-registry";
import { trustedProviderBoardName } from "./registry";

/**
 * A non-Chromium URL that a web page asked for (its own navigation, `target=_blank`, or a link the
 * user chose to open from the page's context menu). Only a scheme claimed by a trusted board may leave
 * the page this way; platform, script and unclaimed schemes — `data:` and `javascript:` included — are
 * dropped. Because the page picks the URL's data, the user confirms once per page origin and scheme
 * (as Chrome asks "Open <app>?"); the browser editor asks, this module owns the rule and the answers.
 */

/** The claimed scheme and the claiming board's name, or undefined when no trusted board claims it. */
export function pageSchemeClaim(url: string): { scheme: string; board: string } | undefined {
    const scheme = schemeOf(url);
    const root = scheme ? boardSchemeOwner(scheme) : undefined;
    if (!scheme || !root) return undefined;
    return { scheme, board: trustedProviderBoardName(root) || fpBasename(root) };
}

export type PageSchemeDecision = "allow" | "block";

/** Answers for this app session, per browser partition, page origin and scheme. Never written to
 *  disk (a private partition's answers must not outlive it), so a restart asks again. */
const decisions = new Map<string, PageSchemeDecision>();
const decisionKey = (partition: string, origin: string, scheme: string): string => `${partition}\u0000${origin}\u0000${scheme}`;

export function pageSchemeDecision(partition: string, origin: string, scheme: string): PageSchemeDecision | undefined {
    return decisions.get(decisionKey(partition, origin, scheme));
}

export function rememberPageSchemeDecision(partition: string, origin: string, scheme: string, decision: PageSchemeDecision): void {
    decisions.set(decisionKey(partition, origin, scheme), decision);
}

/** Open a board-claimed URL the user allowed. Returns whether the URL was handed to the open pipeline. */
export async function openPageSchemeCandidate(url: string): Promise<boolean> {
    if (!pageSchemeClaim(url)) return false;
    await guard(t("api.failedToOpenUrl"), () => app.events.openRawLink.sendAsync(createLinkData(url)));
    return true;
}
