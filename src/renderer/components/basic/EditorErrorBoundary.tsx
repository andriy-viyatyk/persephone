import { Component, ErrorInfo, ReactNode } from "react";
import styled from "@emotion/styled";
import color from "../../theme/color";

// =============================================================================
// Styled Components
// =============================================================================

const ErrorRoot = styled.div({
    flex: "1 1 auto",
    display: "flex",
    flexDirection: "column",
    padding: 24,
    overflow: "auto",
    fontFamily: "Consolas, 'Courier New', monospace",

    "& .error-title": {
        fontSize: 16,
        fontWeight: "bold",
        color: color.misc.red,
        marginBottom: 12,
    },
    "& .error-message": {
        fontSize: 14,
        color: color.misc.yellow,
        marginBottom: 16,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
    },
    "& .error-stack": {
        fontSize: 12,
        color: color.text.light,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        lineHeight: "18px",
    },
});

// =============================================================================
// Component
// =============================================================================

interface EditorErrorBoundaryProps {
    children: ReactNode;
}

interface EditorErrorBoundaryState {
    error: Error | null;
}

/**
 * React error boundary for editor tabs.
 * Catches render errors in child components and displays error + stack trace
 * instead of crashing the entire application.
 */
export class EditorErrorBoundary extends Component<EditorErrorBoundaryProps, EditorErrorBoundaryState> {
    state: EditorErrorBoundaryState = { error: null };

    static getDerivedStateFromError(error: Error): EditorErrorBoundaryState {
        return { error };
    }

    componentDidCatch(error: Error, info: ErrorInfo): void {
        console.error("Editor crashed:", error, info.componentStack);
    }

    render() {
        const { error } = this.state;
        if (!error) {
            return this.props.children;
        }

        return (
            <ErrorRoot>
                <div className="error-title">Editor crashed</div>
                <div className="error-message">{error.message}</div>
                {error.stack && (
                    <div className="error-stack">{error.stack}</div>
                )}
            </ErrorRoot>
        );
    }
}
