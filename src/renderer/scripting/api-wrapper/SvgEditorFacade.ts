import type { SvgViewModel } from "../../editors/svg/SvgViewModel";

/**
 * Safe facade around SvgViewModel for script access.
 * Implements the ISvgEditor interface from api/types/svg-editor.d.ts.
 *
 * - Minimal read-only facade for now
 * - Can be extended with copyToClipboard, saveToFile, etc.
 */
export class SvgEditorFacade {
    constructor(private readonly vm: SvgViewModel) {}

    get svg(): string {
        return this.vm.pageModel.state.get().content;
    }
}
