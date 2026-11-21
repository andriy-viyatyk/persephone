import { app } from "../api/app";
import { createLinkData } from "../../shared/link-data";
import { guard } from "../core/utils/guard";
import { t } from "../../shared/i18n/t";
import { isBoardClaimedScheme, schemeOf } from "./scheme-registry";

/**
 * Open a non-Chromium URL that a web page asked for (its own navigation, `target=_blank`, or a link the
 * user chose to open from the page's context menu). Only a scheme claimed by a trusted board may leave
 * the page this way; platform, script and unclaimed schemes — `data:` and `javascript:` included — are
 * dropped. Returns whether the URL was handed to the open pipeline.
 */
export async function openPageSchemeCandidate(url: string): Promise<boolean> {
    const scheme = schemeOf(url);
    if (!scheme || !isBoardClaimedScheme(scheme)) return false;
    await guard(t("api.failedToOpenUrl"), () => app.events.openRawLink.sendAsync(createLinkData(url)));
    return true;
}
