# MCP Documentation QA Testing

Quality assurance tests for js-notepad MCP server documentation. The goal is to ensure AI agents can use js-notepad MCP tools correctly based solely on tool descriptions and resource guides — without prior knowledge of the project.

## How It Works

A **test agent** (`.claude/agents/mcp-test-agent.md`) simulates a generic AI assistant that only knows about js-notepad through its MCP connection. It has no access to CLAUDE.md, source code, or project files — only MCP tools and resources.

The **test runner** (you, in the main conversation) sends test prompts to the agent, then verifies the results by checking js-notepad pages via MCP.

## Test Files

| File | Area | Tests |
|------|------|-------|
| `mcp-test-create-page.md` | Page creation | All editor types: text, markdown, mermaid, grid, notebook, todo, links, graph, SVG, HTML |
| `mcp-test-ui-push.md` | Log View output | Log messages, dialogs, rich output (markdown, mermaid, grid, code) |
| `mcp-test-execute-script.md` | Script execution | Expression eval, page content access, transformations, facades, FS, settings |
| `mcp-test-page-operations.md` | Page CRUD | List, read, update pages, multi-window, browser, app info |

## Running Tests

### Prerequisites

- js-notepad running with MCP server enabled
- MCP connection established (verify with `list_pages` call)

### Important Rules

- **NEVER close, modify, or interact with pinned tabs.** Pinned tabs belong to the user and must not be touched during testing.
- Only non-pinned tabs may be closed, created, or modified.
- Some tests require preparation pages — create them as non-pinned tabs before running the test agent.

### Test Procedure

For each test:

1. **Prepare** — Clean up notepad (close all non-pinned pages, leave pinned tabs untouched):
   ```javascript
   // via execute_script
   const nonPinned = app.pages.all.filter(p => !p.pinned);
   for (const p of nonPinned) { app.pages.closePage(p.id); }
   ```
   If the test requires a preparation page, create it after cleanup (it will be non-pinned).

2. **Run test agent** with the test prompt:
   ```bash
   echo "<test request>" | claude --agent .claude/agents/mcp-test-agent.md --print --verbose --output-format stream-json --max-turns 15 2>&1 | grep -E '"type":"(assistant|user)"'
   ```

3. **Verify results** — Check what the agent created:
   - `list_pages` — verify page exists with correct editor/language/title
   - `get_page_content` — verify content structure
   - Visual check — confirm the page renders correctly in js-notepad (no crashes, correct editor shown)

4. **Record result** — PASS, PARTIAL (works but suboptimal), or FAIL (broken/wrong)

### What to Check

For **structured editors** (notebook, todo, links, graph):
- Did the agent read the dedicated resource guide BEFORE creating/updating?
- Is the JSON structure correct (all required fields present)?
- Does the editor render without crashes?

For **simple editors** (text, markdown, mermaid, grid, SVG, HTML):
- Correct editor + language pairing?
- Content is valid for the format?

### When a Test Fails

1. **Investigate why** — check the agent's tool call sequence in the stream output
2. **Ask the agent** — if it guessed instead of reading a resource, ask why
3. **Improve documentation** — update tool descriptions, resource guides, or server instructions
4. **Re-test** — restart js-notepad (to reload MCP server) and re-run the failing test

### Common Failure Patterns

| Pattern | Fix |
|---------|-----|
| Agent guesses JSON format instead of reading resource | Strengthen warning in tool description (STOP, MUST read) |
| Agent uses wrong editor+language pairing | Add to server instruction editor table |
| Agent doesn't know about a feature | Add to server instruction overview |
| Editor crashes on agent-provided content | Add validation and return error message with resource URI |

## Adding New Tests

When adding a new feature or editor:

1. Create test entries in the relevant `mcp-test-*.md` file
2. Each test needs: **Request** (prompt), **Expected** (what agent should do), **Verify** (how to confirm)
3. If preparation is needed, document it in a **Preparation** field
4. Run the test against the test agent to validate documentation quality
