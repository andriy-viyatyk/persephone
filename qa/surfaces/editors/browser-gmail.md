# Surface QA: browser automation — Gmail compose

**Sanctioned exception:** `qa/README.md` normally requires public pages and no login. For this
scenario, the user prepares a logged-in Gmail session and supplies the recipient address when
starting the run. Claude runs it; Codex must never operate Gmail or send the email. Do not record
the address, credentials, message content, or other private data in this file or a run log.

## Test G.1: Compose and send to the supplied recipient

**Preparation:** The user signs in to Gmail and leaves a browser page open in that session. At run
start, the user supplies the exact recipient address. Do not ask for or store credentials.

**Start:** Request a fresh, blank `mcp-test-agent-call` agent. Its first operation must be a bare
`call` with no `path`; it must use that overview to discover the browser page and read
`guides.agents.browser` before acting.

**Call:** Ask the agent to create a new Gmail message with a short, harmless subject and body, send
it to the supplied recipient, and verify completion. It should use narrow `snapshot()` calls and
snapshot refs for the compose dialog and controls. Use `evaluate()` only for read-only state
verification; never use it to find, populate, or send the message. Keep the entire run to at most
20 automation calls.

**Overview route:** `PASS | PARTIAL | FAIL` — `overview → <paths in call order>`; wrong paths:
`none` or `<every incorrect path, in order>`.

**Verify:** Gmail shows the exact supplied address as a recipient chip before Send. The message is
successfully sent, no stray draft remains, and no error dialog appears. Record only the call count,
outcome, and non-private findings; do not copy message contents, recipient, or mailbox data.
