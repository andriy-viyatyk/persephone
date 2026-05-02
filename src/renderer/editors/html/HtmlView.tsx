import { useMemo, useSyncExternalStore } from "react";
import { TextFileModel } from "../text/TextEditorModel";
import { useContentViewModel } from "../base/useContentViewModel";
import { Panel } from "../../uikit";
import { HtmlViewModel, defaultHtmlViewState } from "./HtmlViewModel";

const navigationBlockerScript = `<script>document.addEventListener("click",function(e){var a=e.target.closest("a");if(a&&a.href){e.preventDefault();}},true);</script>`;

// ============================================================================
// HtmlView Component - content-view for HTML files
// ============================================================================

interface HtmlViewProps {
    model: TextFileModel;
}

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
        <Panel flex overflow="hidden">
            <iframe
                srcDoc={safeSrcDoc}
                sandbox="allow-scripts"
                title="HTML Preview"
                style={{ flex: 1, border: "none" }}
            />
        </Panel>
    );
}

export { HtmlView };
export type { HtmlViewProps };
