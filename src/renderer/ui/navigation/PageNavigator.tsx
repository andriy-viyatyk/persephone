import { useCallback, useEffect, useRef, useState } from "react";
import { CollapsiblePanel, CollapsiblePanelStack, Panel } from "../../uikit";
import type { PageModel } from "../../api/pages/PageModel";
import { secondaryEditorRegistry } from "./secondary-editor-registry";
import { LazySecondaryEditor } from "./LazySecondaryEditor";

// =============================================================================
// Component
// =============================================================================

interface PageNavigatorProps {
    page: PageModel;
}

export function PageNavigator({ page }: PageNavigatorProps) {
    // Subscribe to secondary editors changes — triggers re-render on add/remove
    const { version: _secondaryVersion } = page.secondaryEditorsVersion.use();
    const secondaryEditors = page.secondaryEditors;
    const headerRefs = useRef<Record<string, HTMLDivElement | null>>({});
    const [, setHeaderRefsVersion] = useState(0);
    const [activePanel, setActivePanelLocal] = useState(page.activePanel);

    const setHeaderRef = useCallback((refKey: string, el: HTMLDivElement | null) => {
        if (el && headerRefs.current[refKey] !== el) {
            headerRefs.current[refKey] = el;
            setHeaderRefsVersion((v) => v + 1);
        }
    }, []);

    // Sync local activePanel when PageModel changes (e.g., after restoreSecondaryEditors)
    useEffect(() => {
        if (page.activePanel !== activePanel) {
            setActivePanelLocal(page.activePanel);
        }
    }, [page.activePanel, _secondaryVersion]); // eslint-disable-line react-hooks/exhaustive-deps

    const handleSetActivePanel = useCallback((panelId: string) => {
        if (panelId === activePanel) return;
        page.setActivePanel(panelId);
        setActivePanelLocal(panelId);
    }, [page, activePanel]);

    return (
        <Panel
            name="page-navigator-root"
            direction="column"
            height="100%"
            overflow="hidden"
            background="default"
        >
            <CollapsiblePanelStack
                name="page-navigator-stack"
                activePanel={activePanel}
                setActivePanel={handleSetActivePanel}
                height="100%"
            >
                {secondaryEditors.flatMap((model) => {
                    const panelIds = model.state.get().secondaryEditor;
                    if (!panelIds?.length) return [];
                    return panelIds.map((panelId) => {
                        const def = secondaryEditorRegistry.get(panelId);
                        if (!def) return null;
                        const refKey = `${model.id}-${panelId}`;
                        return (
                            <CollapsiblePanel
                                key={refKey}
                                id={panelId}
                                name={panelId}
                                headerRef={(el) => setHeaderRef(refKey, el)}
                                alwaysRenderContent
                            >
                                <LazySecondaryEditor
                                    model={model}
                                    editorId={panelId}
                                    headerRef={headerRefs.current[refKey] ?? null}
                                />
                            </CollapsiblePanel>
                        );
                    });
                })}
            </CollapsiblePanelStack>
        </Panel>
    );
}
