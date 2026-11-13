import type { EditorModelInstance as EditorModel } from "../../editors/base";
import type { IconName } from "../../theme/icon-registry";
import type { VanillaViewCtor } from "../../uikit/shared/vanilla-view";
import type { MessageKey } from "../../../shared/i18n/en";

type EditorModelConstructor<M extends EditorModel> = abstract new (...args: never[]) => M;

/** Props passed to secondary view sidebar components. */
export interface SecondaryViewProps<M extends EditorModel = EditorModel> {
    model: M;
    /** The rendered panel's bare panel-id (e.g. "board-secondary:lists"). A component
     *  serving a prefix family (see `registerPrefix`) reads this to know WHICH view it
     *  is; single-id panels can ignore it. */
    panelId: string;
    /** Header host element owned by the panel stack. */
    headerHost: HTMLDivElement | null;
    /** Resolved leading header icon supplied by the host. */
    iconElement?: Node;
    /** `true` when this panel is the currently-expanded one in the stack; `false`
     *  when collapsed to a header strip. Panels stay mounted while collapsed
     *  (`alwaysRenderContent`), so use this to drop header actions that only make
     *  sense when the panel body is visible. */
    expanded?: boolean;
}

export interface SecondaryViewDefinition<M extends EditorModel = EditorModel> {
    /** Unique ID matching IEditorState.secondaryView values. */
    id: string;
    /** Display label for the panel header. */
    label: string;
    /** Catalog identity for UI display; `label` stays English for agents. */
    labelKey: MessageKey;
    /** Optional per-panel header icon. When set, it overrides the owning editor's
     *  icon for this panel — used by sidebar-only sub-panels that want their own
     *  glyph (e.g. the Explorer "search" panel → the "search" registry name). Most panels omit this
     *  and fall back to the editor icon. */
    icon?: IconName;
    /** Dynamic import of the sidebar view. */
    loadView: () => Promise<{ default: VanillaViewCtor<SecondaryViewProps<M>> }>;
    /** Load the owning editor's model class only when this panel is opened. */
    loadModelClass: () => Promise<EditorModelConstructor<M>>;
}

class SecondaryViewRegistry {
    private editors = new Map<string, SecondaryViewDefinition<EditorModel>>();
    /** Prefix → definition. A panel id that starts with a registered prefix resolves to
     *  that one definition; the component reads `SecondaryViewProps.panelId` to specialize
     *  (e.g. the whole `board-secondary:*` family → one generic `BoardSecondaryView`). */
    private prefixes = new Map<string, SecondaryViewDefinition<EditorModel>>();

    register<M extends EditorModel>(definition: SecondaryViewDefinition<M>): void {
        this.editors.set(definition.id, this.widen(definition));
    }

    /** Register one definition for an entire id family (e.g. "board-secondary:"). */
    registerPrefix<M extends EditorModel>(prefix: string, definition: SecondaryViewDefinition<M>): void {
        this.prefixes.set(prefix, this.widen(definition));
    }

    get(id: string): SecondaryViewDefinition<EditorModel> | undefined {
        const exact = this.editors.get(id);
        if (exact) return exact;
        for (const [prefix, def] of this.prefixes) {
            if (id.startsWith(prefix)) return def;
        }
        return undefined;
    }

    has(id: string): boolean {
        return this.get(id) !== undefined;
    }

    private widen<M extends EditorModel>(definition: SecondaryViewDefinition<M>): SecondaryViewDefinition<EditorModel> {
        return {
            ...definition,
            loadView: async () => {
                const [ModelClass, module] = await Promise.all([definition.loadModelClass(), definition.loadView()]);
                const View = module.default;
                // Keep the panel's lifecycle and DOM root while validating the widened registry props.
                // eslint-disable-next-line vanilla-view/no-indirect-view-subclass
                class CheckedSecondaryView extends View {
                    public constructor(props: SecondaryViewProps<EditorModel>) {
                        const model = props.model;
                        if (!(model instanceof ModelClass)) {
                            throw new Error("Secondary view received a model of the wrong type.");
                        }
                        super({ ...props, model });
                    }
                }
                return { default: CheckedSecondaryView };
            },
        };
    }
}

export const secondaryViewRegistry = new SecondaryViewRegistry();
