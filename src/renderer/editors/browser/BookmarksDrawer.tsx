import { useCallback, useEffect, useRef, useState } from "react";
import styled from "@emotion/styled";
import clsx from "clsx";
import color from "../../theme/color";
import { Splitter } from "../../components/layout/Splitter";
import { LinkEditor } from "../link-editor/LinkEditor";
import { BrowserBookmarks } from "./BrowserBookmarks";
import { pagesModel } from "../../api/pages";

// =============================================================================
// Styles
// =============================================================================

const BookmarksDrawerRoot = styled.div({
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 6,
    display: "none",
    "&.doDisplay": {
        display: "flex",
    },

    // Backdrop
    "& .bookmarks-backdrop": {
        flex: "1 1 auto",
        backgroundColor: "rgba(0, 0, 0, 0.3)",
    },

    // Drawer panel (slides in from right)
    "& .bookmarks-panel": {
        display: "flex",
        flexDirection: "column",
        height: "100%",
        backgroundColor: color.background.default,
        borderLeft: `1px solid ${color.border.default}`,
        transform: "translateX(100%)",
        transition: "transform 80ms ease-in-out",
        overflow: "hidden",
    },
    "&.open .bookmarks-panel": {
        transform: "translateX(0)",
    },

    // Toolbar area with portal placeholders
    "& .bookmarks-toolbar": {
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: "4px 8px",
        borderBottom: `1px solid ${color.border.default}`,
        backgroundColor: color.background.dark,
        minHeight: 32,
        flexShrink: 0,
    },
    "& .bookmarks-toolbar-placeholder": {
        display: "flex",
        alignItems: "center",
        gap: 4,
    },

    "& .bookmarks-editor-container": {
        flex: "1 1 auto",
        display: "flex",
        overflow: "hidden",
    },

    // Footer area with portal placeholder
    "& .bookmarks-footer": {
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 8px",
        borderTop: `1px solid ${color.border.default}`,
        backgroundColor: color.background.dark,
        minHeight: 22,
        flexShrink: 0,
        fontSize: 11,
        color: color.text.light,
    },
    "& .bookmarks-footer-placeholder": {
        display: "flex",
        alignItems: "center",
        gap: 4,
    },

    // Splitter between backdrop and drawer panel
    "& > .splitter": {
        flexShrink: 0,
    },
});

// =============================================================================
// Component
// =============================================================================

interface BookmarksDrawerProps {
    open: boolean;
    bookmarks: BrowserBookmarks;
    width: number;
    onChangeWidth: (width: number) => void;
    onLinkClick: (url: string) => void;
    onClose: () => void;
}

export function BookmarksDrawer({
    open,
    bookmarks,
    width,
    onChangeWidth,
    onLinkClick,
    onClose,
}: BookmarksDrawerProps) {
    const [isAnimating, setIsAnimating] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);

    // Compute initial width (60% of container) on first open
    useEffect(() => {
        if (open && width === 0 && rootRef.current) {
            const containerWidth = rootRef.current.offsetWidth;
            onChangeWidth(Math.round(containerWidth * 0.6));
        }
    }, [open, width, onChangeWidth]);

    // Trigger slide-in animation after mount
    useEffect(() => {
        if (open) {
            const timer = setTimeout(() => setIsAnimating(true), 10);
            panelRef.current?.focus();
            return () => clearTimeout(timer);
        } else {
            setIsAnimating(false);
        }
    }, [open]);

    // Portal placeholder refs — passed directly to LinkEditor via props
    const [toolbarFirstRef, setToolbarFirstRef] = useState<HTMLDivElement | null>(null);
    const [toolbarLastRef, setToolbarLastRef] = useState<HTMLDivElement | null>(null);
    const [footerLastRef, setFooterLastRef] = useState<HTMLDivElement | null>(null);

    // Close on Escape key
    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === "Escape") {
                onClose();
            }
        },
        [onClose],
    );

    // Intercept link clicks: monkey-patch pagesModel.handleOpenUrl while drawer is open
    // so LinkItemList's click handler routes URLs to a new internal tab instead.
    useEffect(() => {
        if (!open) return;
        const originalHandleOpenUrl = pagesModel.handleOpenUrl;
        pagesModel.handleOpenUrl = async (url: string) => {
            onLinkClick(url);
        };
        return () => {
            pagesModel.handleOpenUrl = originalHandleOpenUrl;
        };
    }, [open, onLinkClick]);

    if (!open) return null;

    return (
        <BookmarksDrawerRoot
            ref={rootRef}
            className={clsx({ open: isAnimating, doDisplay: open })}
            onKeyDown={handleKeyDown}
            tabIndex={-1}
        >
            <div className="bookmarks-backdrop" onClick={onClose} />
            <Splitter
                type="vertical"
                initialWidth={width}
                onChangeWidth={onChangeWidth}
                borderSized="left"
            />
            <div
                ref={panelRef}
                className="bookmarks-panel"
                style={{ width, maxWidth: "90%" }}
            >
                <div className="bookmarks-toolbar">
                    <div className="bookmarks-toolbar-placeholder" ref={setToolbarFirstRef} />
                    <div style={{ flex: 1 }} />
                    <div className="bookmarks-toolbar-placeholder" ref={setToolbarLastRef} />
                </div>
                <div className="bookmarks-editor-container">
                    <LinkEditor
                        model={bookmarks.textModel}
                        swapLayout
                        toolbarRefFirst={toolbarFirstRef}
                        toolbarRefLast={toolbarLastRef}
                        footerRefLast={footerLastRef}
                    />
                </div>
                <div className="bookmarks-footer">
                    <div className="bookmarks-footer-placeholder" ref={setFooterLastRef} />
                </div>
            </div>
        </BookmarksDrawerRoot>
    );
}
