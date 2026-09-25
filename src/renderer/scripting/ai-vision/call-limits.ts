/**
 * Result-size limit for the PROGRAMMATIC call surfaces — `app.call()` in scripts and
 * `persephone.call()` in boards.
 *
 * `ai-vision`'s `shapeResult` defaults to `DEFAULT_MAX_LENGTH` (20,000 characters) and silently
 * clips anything longer. That default exists to protect an AGENT's context window: the MCP `call`
 * tool returns text an LLM has to read, so an unbounded dump is a real cost there.
 *
 * A script or a board is not an agent. It receives the value programmatically, in JavaScript, and
 * a truncated value is simply wrong data — worse than a large one, because nothing in the return
 * shape says it was cut. That was US-1511: the Excalidraw board's Screen Snip asks the host for a
 * PNG data URL through `persephone.call("shell.startScreenSnip")`, and the string came back clipped
 * to exactly 20,000 characters. A truncated PNG still carries a valid IHDR in its first bytes, so
 * the board read the FULL pixel dimensions and inserted a correctly sized image element — while the
 * decoder only had scanlines for the top band. The visible result was a correctly sized frame
 * holding a fraction of the capture, and the fraction varied with how well the capture compressed.
 *
 * So these two surfaces default to unbounded. An explicit `maxLength` from the caller is still
 * honored — a caller that wants a bound can ask for one. The MCP `call` tool is untouched and keeps
 * the 20,000-character default, because there the bound is the point.
 *
 * This does not disable every cap: `ai-vision` independently limits arrays (`MAX_ARRAY_ITEMS`) and
 * object depth (`MAX_DEPTH`), which are about shape rather than transport size and still apply.
 */
export const UNBOUNDED_CALL_MAX_LENGTH = Number.MAX_SAFE_INTEGER;
