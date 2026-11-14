type NativeStyleValue = string | number | undefined;

export interface NativeCSSProperties {
    [key: `--${string}`]: NativeStyleValue;
    alignItems?: NativeStyleValue;
    alignSelf?: NativeStyleValue;
    borderRadius?: NativeStyleValue;
    bottom?: NativeStyleValue;
    flex?: NativeStyleValue;
    flexShrink?: NativeStyleValue;
    flexWrap?: NativeStyleValue;
    gap?: NativeStyleValue;
    height?: NativeStyleValue;
    inset?: NativeStyleValue;
    justifyContent?: NativeStyleValue;
    left?: NativeStyleValue;
    maxHeight?: NativeStyleValue;
    maxWidth?: NativeStyleValue;
    minHeight?: NativeStyleValue;
    minWidth?: NativeStyleValue;
    overflow?: NativeStyleValue;
    overflowX?: NativeStyleValue;
    overflowY?: NativeStyleValue;
    paddingBottom?: NativeStyleValue;
    paddingLeft?: NativeStyleValue;
    paddingRight?: NativeStyleValue;
    paddingTop?: NativeStyleValue;
    position?: NativeStyleValue;
    right?: NativeStyleValue;
    top?: NativeStyleValue;
    whiteSpace?: NativeStyleValue;
    width?: NativeStyleValue;
    wordBreak?: NativeStyleValue;
    zIndex?: NativeStyleValue;
}
