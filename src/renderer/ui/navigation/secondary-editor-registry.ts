import type React from "react";
import type { PageModel } from "../../editors/base";

/** Props passed to secondary editor sidebar components. */
export interface SecondaryEditorProps {
    model: PageModel;
}

/** Registration for a secondary editor type. */
interface SecondaryEditorDefinition {
    /** Unique ID matching IPageState.secondaryEditor values. */
    id: string;
    /** Display label for the panel header. */
    label: string;
    /** Dynamic import of the sidebar component. */
    loadComponent: () => Promise<{ default: React.ComponentType<SecondaryEditorProps> }>;
}

class SecondaryEditorRegistry {
    private editors = new Map<string, SecondaryEditorDefinition>();

    register(definition: SecondaryEditorDefinition): void {
        this.editors.set(definition.id, definition);
    }

    get(id: string): SecondaryEditorDefinition | undefined {
        return this.editors.get(id);
    }

    has(id: string): boolean {
        return this.editors.has(id);
    }
}

export const secondaryEditorRegistry = new SecondaryEditorRegistry();
