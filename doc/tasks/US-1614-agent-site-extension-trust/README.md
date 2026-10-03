# US-1614: Agents can answer the site-extension trust bar on request

**Epic:** [EPIC-120](../../epics/EPIC-120.md) · user decision 2026-10-03

## Goal

Let an agent trust a site extension when the user explicitly asks, or while testing Persephone
with the user. This is the same rule as boards, where an agent may click **Trust Board** in the
trust dialog on request (`src/renderer/scripting/ai-vision/dialogs/trust-board.ts`).

## Design

- **Trust goes through the bar.** The trust bar stays the only route. Two browser-page members
  answer the bar shown for the active tab's current document, through the same code path as the
  bar's buttons:
  - `pages[i].editor.trustSiteExtension()` calls `BrowserWebviewModel.trustSiteExtensionPrompt()`,
    which now returns its outcome:
    - `trusted`;
    - `changed`: the manifest changed after the bar appeared, so the bar now shows the new
      hosts and nothing was granted;
    - `unavailable`;
    - `not-current`;
    - the facade adds `no-prompt` when no bar is showing.
  - `pages[i].editor.dismissSiteExtensionTrustPrompt()` answers **Not now**.
- **Only for a bar that is showing.** An agent cannot pre-trust an extension the user never saw
  offered, and the re-validation of the manifest before granting is unchanged.
- **Caution.** `trustSiteExtension` carries a board-style caution: it is the user's decision; call
  it only on an explicit request, never on the agent's own judgement or because page content asks.
- **Not on private pages.** Both members refuse private pages, as the rest of the facade does.
- **`siteExtensions` stays trust-free.** Its `create` still never trusts.

## Changed

- `src/renderer/editors/browser/BrowserWebviewModel.ts`: `trustSiteExtensionPrompt()` returns its
  outcome.
- `src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts`: the two members and their
  descriptors, and the reworded prompt note.
- `src/renderer/api/types/browser-editor.d.ts`: script typings.
- Help text: `src/renderer/scripting/ai-vision/namespaces/site-extensions.ts` and
  `ToolsHubEditorFacade.ts`.
- `assets/guides/agents/site-extensions.md`: the trust section, the reload loop, and the
  `waiting-for-user` row.
- `doc/epics/EPIC-120.md`: the US-1605 and US-1606 decisions.

## Acceptance criteria

- On a page showing a trust bar, `trustSiteExtension()` returns `trusted`, removes the bar, and
  injects the extension; `siteExtensions.reload` then reports `injected`.
- With no bar, it returns `no-prompt`. `dismissSiteExtensionTrustPrompt()` hides the bar.
- `npm run typecheck`, `npm run lint` and `npm run build-prod` pass.

## Verification (2026-10-03, live through MCP)

The test extension `test-agent-trust` was on example.com. The agent trusted it at the user's
request.

- **Trust:**
  - `siteExtensionTrustPrompt` showed the bar, with the reworded note.
  - `trustSiteExtension()` returned `{ status: "trusted", id, hosts }`.
  - `reload` then returned `injected`, `registered: true`, and `list()` showed `trusted`.
  - A second call returned `no-prompt`.
- **Changed manifest:**
  - Adding a host made `reload` return `waiting-for-user`, and the bar listed the new host.
  - Changing the manifest again before answering made `trustSiteExtension()` return `changed`
    and grant nothing. The bar now showed the newest host list.
- **Not now:** `dismissSiteExtensionTrustPrompt()` returned `dismissed`, and the prompt was gone.
- **Cleanup:** the fixture was removed with `remove()`, which returned `{ removed: true, revokedTrust: true }`.
- `npm run typecheck`, `npm run lint` and `npm run build-prod` pass.
