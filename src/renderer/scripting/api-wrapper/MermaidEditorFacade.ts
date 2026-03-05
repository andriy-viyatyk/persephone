import type { MermaidViewModel } from "../../editors/mermaid/MermaidViewModel";

/**
 * Safe facade around MermaidViewModel for script access.
 * Implements the IMermaidEditor interface from api/types/mermaid-editor.d.ts.
 *
 * - svgUrl is the rendered SVG as a data URL
 * - loading/error indicate rendering state
 */
export class MermaidEditorFacade {
    constructor(private readonly vm: MermaidViewModel) {}

    get svgUrl(): string {
        return this.vm.state.get().svgUrl;
    }

    get loading(): boolean {
        return this.vm.state.get().loading;
    }

    get error(): string {
        return this.vm.state.get().error;
    }
}
