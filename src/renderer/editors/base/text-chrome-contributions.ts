import type { TextFileModel } from "../content-host/TextFileModel";
import type { VanillaView } from "../../uikit/shared/vanilla-view";

export type TextChromeContributionSlot = "right-leading";

export interface TextChromeContribution {
    id: string;
    slot: TextChromeContributionSlot;
    createView(host: TextFileModel): VanillaView<{ host: TextFileModel }>;
}

const contributions: TextChromeContribution[] = [];
const contributionIds = new Set<string>();

export function registerTextChromeContribution(contribution: TextChromeContribution): void {
    if (contributionIds.has(contribution.id)) {
        throw new Error(`Text chrome contribution '${contribution.id}' is already registered.`);
    }
    contributionIds.add(contribution.id);
    contributions.push(contribution);
}

export function getTextChromeContributions(): readonly TextChromeContribution[] {
    return contributions;
}
