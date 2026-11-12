import { TraitKey } from "../../core/traits/traits";
import type { TextFileModel } from "../content-host/TextFileModel";

export interface IContentHostTrait {
    extractContentHost(): TextFileModel;
}

export const CONTENT_HOST_TRAIT = new TraitKey<IContentHostTrait>("content-host");

export interface ITextSelectionTrait {
    hasSelection(): boolean;
    getSelectedText(): Promise<string>;
}

export const TEXT_SELECTION_TRAIT = new TraitKey<ITextSelectionTrait>("text-selection");

export interface ITextNavigationTrait {
    revealLine(line: number): void;
    setHighlightText(text: string | undefined): void;
    focus(): void;
}

export const TEXT_NAVIGATION_TRAIT = new TraitKey<ITextNavigationTrait>("text-navigation");
