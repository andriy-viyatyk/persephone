import { ContentViewModel } from "../base/ContentViewModel";
import { IContentHost } from "../base/IContentHost";
import { TextFileModel } from "../text/TextEditorModel";

// =============================================================================
// State
// =============================================================================

export const defaultHtmlViewState = {};

export type HtmlViewState = typeof defaultHtmlViewState;

// =============================================================================
// ViewModel
// =============================================================================

export class HtmlViewModel extends ContentViewModel<HtmlViewState> {
    constructor(host: IContentHost) {
        super(host, defaultHtmlViewState);
    }

    get pageModel(): TextFileModel {
        return this.host as unknown as TextFileModel;
    }

    protected onInit(): void {}
    protected onContentChanged(): void {}
}

// =============================================================================
// Factory
// =============================================================================

export function createHtmlViewModel(host: IContentHost): HtmlViewModel {
    return new HtmlViewModel(host);
}
