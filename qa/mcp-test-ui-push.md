# MCP Test: ui_push

Tests for showing output to the user via the Log View.

---

## Test 2.1: Simple text output
**Request:** "Show me a greeting message"
**Expected:** ui_push called with a string or log.info entry, message appears in Log View
**Verify:** Log View page exists and shows the greeting

## Test 2.2: Multiple log levels
**Request:** "Show me examples of different message types: info, warning, error, and success"
**Expected:** ui_push with entries of type log.info, log.warn, log.error, log.success
**Verify:** Messages appear with correct styling/icons in Log View

## Test 2.3: Markdown output
**Request:** "Show me a markdown-formatted report about the current state of the notepad"
**Expected:** ui_push with output.markdown entry, content has headings/lists/formatting
**Verify:** Rendered markdown appears in Log View

## Test 2.4: Mermaid diagram output
**Request:** "Show me a mermaid flowchart of a login process"
**Expected:** ui_push with output.mermaid entry, content is valid mermaid syntax
**Verify:** Diagram renders in Log View

## Test 2.5: Grid/table output
**Request:** "Show me a table of the 5 largest planets with name, diameter, and distance from sun"
**Expected:** ui_push with output.grid entry, content is JSON array, contentType is 'json'
**Verify:** Interactive grid appears in Log View

## Test 2.6: Code output
**Request:** "Show me a JavaScript function that sorts an array in the notepad"
**Expected:** ui_push with output.text entry, language set to 'javascript'
**Verify:** Code appears with syntax highlighting in Log View

## Test 2.7: Interactive confirm dialog
**Request:** "Ask me in the notepad if I want to continue with the operation"
**Expected:** ui_push with input.confirm entry, blocks until user responds
**Verify:** Dialog appears, user can click Yes/No, result is returned

## Test 2.8: Interactive text input
**Request:** "Ask me for my name and then greet me"
**Expected:** ui_push with input.text, then uses response to show greeting
**Verify:** Input dialog appears, after typing name, greeting shows

## Test 2.9: Interactive buttons
**Request:** "Ask me to choose a color from: Red, Green, Blue"
**Expected:** ui_push with input.buttons entry, buttons field has 3 options
**Verify:** Button group appears, clicking returns selection

## Test 2.10: Mixed output
**Request:** "Show me a report with: a heading, a table of 3 items, a mermaid diagram, and a code snippet"
**Expected:** ui_push with multiple entries: output.markdown, output.grid, output.mermaid, output.text
**Verify:** All items render correctly in Log View in order
