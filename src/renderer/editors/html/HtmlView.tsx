import styled from "@emotion/styled";
import { useMemo, useSyncExternalStore } from "react";
import { TextFileModel } from "../text/TextEditorModel";
import { useContentViewModel } from "../base/useContentViewModel";
import { HtmlViewModel, defaultHtmlViewState } from "./HtmlViewModel";

const navigationBlockerScript = `<script>document.addEventListener("click",function(e){var a=e.target.closest("a");if(a&&a.href){e.preventDefault();}},true);</script>`;

// ============================================================================
// HtmlView Component - content-view for HTML files
// ============================================================================

interface HtmlViewProps {
    model: TextFileModel;
}

const HtmlViewRoot = styled.div({
    width: "100%",
    height: "100%",
    overflow: "hidden",

    "& .html-preview-iframe": {
        width: "100%",
        height: "100%",
        border: "none",
        backgroundColor: "#fff",
    },
});

const noopUnsubscribe = () => () => {};
const getDefaultState = () => defaultHtmlViewState;

/**
 * HTML Preview component that renders HTML content in a sandboxed iframe.
 * Uses srcdoc to pass content directly — no size limits, reactive to state changes.
 * Sandbox ensures isolation: no same-origin access, no popups, no storage.
 */
function HtmlView({ model }: HtmlViewProps) {
    const vm = useContentViewModel<HtmlViewModel>(model, "html-view");
    const content = model.state.use((s) => s.content);

    // Subscribe to VM state (unconditional — Rules of Hooks)
    useSyncExternalStore(
        vm ? (cb) => vm.state.subscribe(cb) : noopUnsubscribe,
        vm ? () => vm.state.get() : getDefaultState,
    );

    const safeSrcDoc = useMemo(
        () => content + navigationBlockerScript,
        [content],
    );

    if (!vm) return null;

    return (
        <HtmlViewRoot>
            <iframe
                className="html-preview-iframe"
                srcDoc={safeSrcDoc}
                sandbox="allow-scripts"
                title="HTML Preview"
            />
        </HtmlViewRoot>
    );
}

export { HtmlView };
export type { HtmlViewProps };
