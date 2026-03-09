import { StyledText } from "./logTypes";

/**
 * Renders StyledText — either a plain string or an array of styled segments.
 * Each segment can have arbitrary inline CSS styles.
 */
export function StyledTextView({ text }: { text: StyledText }) {
    if (typeof text === "string") {
        return <span>{text}</span>;
    }
    return (
        <>
            {text.map((seg, i) => (
                <span key={i} style={seg.styles as React.CSSProperties}>{seg.text}</span>
            ))}
        </>
    );
}
