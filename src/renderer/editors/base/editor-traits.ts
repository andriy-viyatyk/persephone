import { TraitKey } from "../../core/traits/traits";
import type { TextFileModel } from "../content-host/TextFileModel";
import type { IContentPipe } from "../../api/types/io.pipe";

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

export interface IReopenTrait {
    onReopen(pipe?: IContentPipe): boolean;
}

export const REOPEN_TRAIT = new TraitKey<IReopenTrait>("reopen");

export interface IFragmentNavigationTrait {
    revealFragment(fragment: string): void;
}

export const FRAGMENT_NAV_TRAIT = new TraitKey<IFragmentNavigationTrait>("fragment-navigation");

export interface IFreshEmptyTrait {
    isFreshEmpty(): boolean;
}

export const FRESH_EMPTY_TRAIT = new TraitKey<IFreshEmptyTrait>("fresh-empty");
