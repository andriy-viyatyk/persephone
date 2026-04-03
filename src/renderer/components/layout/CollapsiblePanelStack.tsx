import styled from "@emotion/styled";
import { Children, CSSProperties, isValidElement, ReactElement, ReactNode, useEffect, useRef } from "react";
import color from "../../theme/color";
import { ChevronDownIcon, ChevronRightIcon } from "../../theme/icons";

// =============================================================================
// CollapsiblePanel (child component)
// =============================================================================

export interface CollapsiblePanelProps {
    /** Unique panel identifier */
    id: string;
    /** Panel header title. Omit when the child component portals its own header via headerRef. */
    title?: ReactNode;
    /** Panel content */
    children: ReactNode;
    /** Optional icon before the title */
    icon?: ReactNode;
    /** Optional action buttons rendered at the right of the header.
     *  When provided, chevron icons are hidden (expanded state is self-evident from content). */
    buttons?: ReactNode;
    /** Ref callback for the header container — child components can portal content here. */
    headerRef?: (el: HTMLDivElement | null) => void;
    /** Always render content even when collapsed (hidden via display:none).
     *  Useful when children portal into the header and must stay mounted. */
    alwaysRenderContent?: boolean;
}

/**
 * Represents a single panel within a CollapsiblePanelStack.
 * This component doesn't render anything by itself - it's used declaratively
 * to define panels, and the parent CollapsiblePanelStack handles rendering.
 */
export function CollapsiblePanel(_props: CollapsiblePanelProps): ReactElement | null {
    // This component is only used for its props - rendering is handled by CollapsiblePanelStack
    return null;
}

// =============================================================================
// CollapsiblePanelStack (parent component)
// =============================================================================

export interface CollapsiblePanelStackProps {
    /** ID of the currently active/expanded panel */
    activePanel: string;
    /** Called when a panel header is clicked to change the active panel */
    setActivePanel: (panelId: string) => void;
    /** Panel definitions as CollapsiblePanel children */
    children: ReactNode;
    /** Optional className for the root element */
    className?: string;
    /** Optional inline styles for the root element */
    style?: CSSProperties;
}

// =============================================================================
// Styles
// =============================================================================

const PanelStackRoot = styled.div({
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",

    "& .collapsible-panel": {
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        transition: "flex 0.15s ease",
        "&.collapsed": {
            flex: "0 0 auto",
        },
        "&.expanded": {
            flex: "1 1 auto",
        },
    },

    "& .panel-header": {
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 4px",
        minHeight: 27,
        fontSize: 12,
        fontWeight: 500,
        color: color.text.light,
        backgroundColor: color.background.dark,
        cursor: "pointer",
        userSelect: "none",
        borderBottom: `1px solid ${color.border.light}`,
        "&:hover": {
            backgroundColor: color.background.light,
        },
        "& > svg": {
            width: 14,
            height: 14,
            flexShrink: 0,
        },
        "& .panel-spacer": {
            flex: "1 1 auto",
        },
    },

    "& .panel-content": {
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        backgroundColor: color.background.default,
    },
});

// =============================================================================
// Component
// =============================================================================

/**
 * A stack of collapsible panels where exactly one panel is always expanded.
 * Clicking a collapsed panel expands it. Clicking the expanded panel returns
 * to the previously expanded panel (history-based, not cycling).
 *
 * @example
 * ```tsx
 * <CollapsiblePanelStack
 *     activePanel={state.activePanel}
 *     setActivePanel={model.setActivePanel}
 * >
 *     <CollapsiblePanel id="tags" title="Tags">
 *         <TagsContent />
 *     </CollapsiblePanel>
 *     <CollapsiblePanel id="categories" title="Categories">
 *         <CategoriesContent />
 *     </CollapsiblePanel>
 * </CollapsiblePanelStack>
 * ```
 */
export function CollapsiblePanelStack({
    activePanel,
    setActivePanel,
    children,
    className,
    style,
}: CollapsiblePanelStackProps) {
    // Extract panel definitions from children
    const panels: { id: string; title?: ReactNode; content: ReactNode; icon?: ReactNode; buttons?: ReactNode; headerRef?: (el: HTMLDivElement | null) => void; alwaysRenderContent?: boolean }[] = [];

    Children.forEach(children, (child) => {
        if (isValidElement(child) && child.type === CollapsiblePanel) {
            const { id, title, children: content, icon, buttons, headerRef, alwaysRenderContent } = child.props as CollapsiblePanelProps;
            panels.push({ id, title, content, icon, buttons, headerRef, alwaysRenderContent });
        }
    });

    // Track expand history for back-navigation
    const previousPanelRef = useRef<string | null>(null);
    const lastActivePanelRef = useRef(activePanel);

    // Track external activePanel changes (e.g., async panel switch in PageNavigator)
    useEffect(() => {
        if (activePanel !== lastActivePanelRef.current) {
            previousPanelRef.current = lastActivePanelRef.current;
            lastActivePanelRef.current = activePanel;
        }
    }, [activePanel]);

    const handleToggle = (panelId: string) => {
        if (activePanel === panelId) {
            // Clicking expanded panel — go back to previous
            const prev = previousPanelRef.current;
            if (prev && panels.some(p => p.id === prev)) {
                setActivePanel(prev);
            } else {
                // No valid previous — fall back to first panel that isn't current
                const fallback = panels.find(p => p.id !== panelId);
                if (fallback) setActivePanel(fallback.id);
            }
        } else {
            setActivePanel(panelId);
        }
    };

    return (
        <PanelStackRoot className={className} style={style}>
            {panels.map((panel) => {
                const isExpanded = activePanel === panel.id;
                return (
                    <div
                        key={panel.id}
                        className={`collapsible-panel ${isExpanded ? "expanded" : "collapsed"}`}
                    >
                        <div
                            className="panel-header"
                            ref={panel.headerRef}
                            onClick={() => handleToggle(panel.id)}
                        >
                            {!panel.headerRef && !panel.buttons && (isExpanded ? <ChevronDownIcon /> : <ChevronRightIcon />)}
                            {panel.icon}
                            {panel.title}
                            {panel.buttons && (
                                <>
                                    <span className="panel-spacer" />
                                    {panel.buttons}
                                </>
                            )}
                        </div>
                        {panel.alwaysRenderContent ? (
                            <div className="panel-content" style={isExpanded ? undefined : { display: "none" }}>
                                {panel.content}
                            </div>
                        ) : isExpanded && (
                            <div className="panel-content">
                                {panel.content}
                            </div>
                        )}
                    </div>
                );
            })}
        </PanelStackRoot>
    );
}
