import { ContentViewModel } from "../base/ContentViewModel";
import { IContentHost } from "../base/IContentHost";
import { TextFileModel } from "../text/TextEditorModel";

// =============================================================================
// State
// =============================================================================

export const defaultSvgViewState = {};

export type SvgViewState = typeof defaultSvgViewState;

// =============================================================================
// ViewModel
// =============================================================================

export class SvgViewModel extends ContentViewModel<SvgViewState> {
    constructor(host: IContentHost) {
        super(host, defaultSvgViewState);
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

export function createSvgViewModel(host: IContentHost): SvgViewModel {
    return new SvgViewModel(host);
}
