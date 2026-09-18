# US-1451: Show the Explorer root path beside its name

## Status

**Status:** Implemented; completion review and documentation updates complete  
**Priority:** Medium  
**Epic:** None  
**Started:** 2026-09-19  

## Goal

Show the Explorer tree's full root path as a secondary, dim label on the same row as the root
folder name. The secondary label must preserve the primary folder name, truncate from the left with
an ellipsis when the sidebar is narrow, expose the full path as a tooltip, and appear only on the
Explorer root row.

## Background

### Verified rendering path

The Explorer owns the tree-provider props in `src/renderer/editors/explorer/ExplorerSecondaryView.ts`:

- `replaceProvider()` constructs `TreeProviderViewImpl` with `this.treeProps(...)` at lines 238-244.
- `treeProps()` passes the provider and existing row actions, including `renderTrailing`, at lines
  250-261. The Explorer's root path is read from `this.model.rootPath` by `replaceProvider()` and
  `updateHeader()` at lines 207-217 and 367-371.
- The provider's root is the single node created in
  `src/renderer/components/tree-provider/TreeProviderViewModel.ts:337-353`. Its `href` is
  `provider.rootPath` (`:340-347`) and its display `title` is `rootLabel ?? provider.displayName`
  (`:346`). `FileTreeProvider` sets `displayName` from `path.basename(sourceUrl)` and
  `rootPath` from `sourceUrl` at `src/renderer/content/tree-providers/FileTreeProvider.ts:36-47`.
- `TreeProviderViewImpl` wraps the root node array with `traited(..., tpvNodeTraits)` at
  `src/renderer/components/tree-provider/TreeProviderViewImpl.ts:164-170`. The module-scope
  `tpvNodeTraits` maps the tree-item value to `node.data.href` and the label to
  `node.data.title` at `:33-38`.
- `treeProps()` creates `TreeProps` at `TreeProviderViewImpl.ts:290-338`; it passes the traited
  nodes at `:300-303`, the label-producing trait therefore supplies `row.item.label`, and
  `getHideChevron: (_node, level) => level === 0` makes the root row special at `:324-327`.
- `TreeView.itemProps()` forwards `row.item.label` and `searchText` to the pooled row at
  `src/renderer/uikit/Tree/TreeView.ts:447-470`; the row is created or updated by the pooled-cell
  path at `:377-428`.
- `TreeItemView.setLabel()` uses `highlightInto()` only when the label is a string, while rich
  `SlotContent` goes through `fillSlot()` at `src/renderer/uikit/Tree/TreeItemView.ts:348-361`.
  `TreeItemProps.label` is intentionally `SlotContent` and documents that only string labels are
  highlighted at `src/renderer/uikit/Tree/TreeItem.ts:24-27`.

The root row is therefore already identifiable by `level === 0` in the generic Tree layer. The
least invasive application-specific extension should preserve the existing string root label and
add a secondary child beside it at the label-slot boundary, while opting in only from Explorer.

### Candidate approaches

#### A. Return a rich `SlotContent` label from the root trait

This is technically expressible because `TREE_ITEM_KEY`'s label accessor resolves to
`SlotContent` (`src/renderer/uikit/Tree/types.ts:17-22`) and `TreeItemProps.label` accepts rich
content (`src/renderer/uikit/Tree/TreeItem.ts:24-27`). It is not recommended:

- `tpvNodeTraits` is module-scoped and shared by every `TreeProviderViewImpl`
  (`TreeProviderViewImpl.ts:33-38`), so an Explorer-only path concern would leak into every tree
  provider or require a shared trait to know application-specific state it does not own.
- A rich label bypasses `TreeItemView`'s string branch and therefore bypasses `highlightInto()`
  (`TreeItemView.ts:348-360`). Explorer search would stop highlighting the root row's name.
- The trait accessor has no level argument. It can infer the provider root only from node data, but
  the root-path display concern belongs to Explorer, not the shared provider trait.

#### B. Use `renderTrailing` / `trailingElement`

This is not suitable for a secondary label that must sit beside the primary name. `TreeProps` does
pass the level to its trailing callbacks (`src/renderer/uikit/Tree/types.ts:173-178`), and
`TreeView.itemProps()` forwards it (`TreeView.ts:467-470`), but `TreeProviderViewImpl`'s adapter
exposes only the provider item and drops the level at `:327`.

More importantly, the existing row layout makes trailing content non-shrinking: the label is
`flex: 1 1 auto`, `min-width: 0`, and overflow-truncated at `src/renderer/uikit/Tree/TreeItem.css:138-143`,
while `.tree-trailing` is `display: flex`, `align-items: center`, and `flex-shrink: 0` at
`:145-150`. The trailing box therefore consumes its full intrinsic width and the primary label
shrinks first. It also renders in the right-aligned trailing host, rather than as a secondary item
next to the name.

#### C. Add an opt-in generic secondary-label capability and provider accessor

This is the recommended boundary. Add a generic `secondaryLabel`/`getSecondaryLabel` capability to
the reusable Tree row, and expose an opt-in per-item accessor from the Persephone-coupled
`TreeProviderViewProps`. The generic UIKit contract should say only “optional secondary content next
to a row label”; it must not mention Explorer, roots, files, or paths. The provider adapter evaluates
its accessor with the row `level`, and the Explorer returns content only when `level === 0`. Explorer
opts in with `model.rootPath`; all other `TreeProviderViewImpl` consumers omit the prop and render
their current labels unchanged.

This keeps the Persephone-specific “show the Explorer root path” decision in
`ExplorerSecondaryView`/`TreeProviderViewImpl`, while the reusable UIKit primitive remains unaware
of filesystem paths. A generic secondary-label capability is genuinely reusable for any tree row
metadata (for example a path, size, status, or description), and is therefore a valid UIKit
extension. A `showRootPath`/`rootPath` prop in `uikit/Tree` would violate the standalone boundary:
`doc/architecture/overview.md:145-153` and `doc/standards/uikit-vs-components-split.md:7-18` define
UIKit as reusable and app-independent, while the uikit authoring guide requires component-owned
static styling and stable `data-part` structure (`src/renderer/uikit/CLAUDE.md:25-28,811-827`).

### Initial proposed shape

The following is a planning snippet, not an implemented change. Exact names may be adjusted during
implementation, but the important contracts are stable: string primary label, cached root-only
secondary node, and explicit bidi/truncation markup.

Before (`TreeProviderViewModel.ts` and `uikit/Tree/types.ts`):

```ts
renderTrailing?: (item: ITreeProviderItem) => SlotContent;
getTooltip?: (item: ITreeProviderItem) => SlotText;
```

After (proposed generic provider capability plus reusable Tree plumbing):

```ts
renderTrailing?: (item: ITreeProviderItem) => SlotContent;
getTooltip?: (item: ITreeProviderItem) => SlotText;
getSecondaryLabel?: (item: ITreeProviderItem, level: number) => SlotContent;

// TreeProps uses the same generic concept; TreeItemProps receives the resolved content.
getSecondaryLabel?: (item: T, level: number) => SlotContent;
secondaryLabel?: SlotContent;
```

The Explorer would opt in with the current root path, while `TreeProviderViewImpl` supplies a
stable adapter and caches the path node. The generic row implementation would keep the ordinary
string `label` separate from `secondaryLabel`, so the existing string-highlighting branch remains
active. The UIKit-owned host and Explorer-owned path node would produce markup equivalent to:

```html
<span class="label">
  persephone
</span>
<span data-part="secondary-label">
  <span data-type="text" data-color="light" data-truncate
        data-name="explorer-root-path" dir="rtl">&#x200E;\\server\share&#x200E;</span>
</span>
```

The primary name must remain a normal string-bearing node for search highlighting. The secondary
path node must be cached per stable item identity (the root href), not freshly created by every
props pump.

## Implementation Plan

This task is investigation-only; these are the implementation steps to use after user approval.

1. Extend the generic Tree contract in `src/renderer/uikit/Tree/TreeItem.ts`,
   `src/renderer/uikit/Tree/types.ts`, and `src/renderer/uikit/Tree/TreeItemView.ts` with optional
   secondary content. Keep the primary `label` string on its existing highlight path and add a
   separate secondary host. The host needs all four pooled-row arms, mirroring
   `setTrailing()` at `src/renderer/uikit/Tree/TreeItemView.ts:364-395`: attach/insert the host and
   fill the content when present; detach/cleanup/remove the host when secondary content is null or
   absent; and, for caller-owned `Node` content, skip refill only when both the node identity matches
   and `node.parentNode === secondaryHost`, mirroring the two-part guard at `:369-376` (identity
   alone is unsafe when virtual scrolling moves a node between pooled cells). The secondary host
   belongs between the primary label and trailing host, so insert it with
   `root.insertBefore(secondaryHost, trailingHost.isConnected ? trailingHost : null)`. Passing
   `null` appends only when no trailing host is connected, while an existing trailing host stays
   last. This mirrors the mid-row insertion precedent at `TreeItemView.ts:318`, where the icon host
   is inserted before the label; the constructor's `:94` append order is not sufficient for a host
   that sits in the middle. Add the secondary cleanup to `clearSlots()` alongside `iconCleanup`,
   `labelCleanup`, and `trailingCleanup` at `TreeItemView.ts:407-415`.

   The ordering hazard is latent in current Explorer usage: only the root directory receives the
   secondary label, while `ExplorerSecondaryView.renderTrailingAction()` returns trailing content
   only for non-directory board/tools manifest files at `src/renderer/editors/explorer/ExplorerSecondaryView.ts:271-303`.
   No current row has both, but the generic capability must remain correct for the next consumer that
   combines secondary content and trailing actions.
2. Thread the generic accessor through `src/renderer/uikit/Tree/TreeView.ts` and include its
   exact `(item, level) => SlotContent` signature into the row props, and include its callback
   identity in both `src/renderer/uikit/Tree/TreeModel.ts:setProps()` and
   `TreeModel.repaintSignature()`. The callback must be stable while its result is stable; a changed
   accessor identity is the explicit signal for a global repaint.
3. Add generic row layout rules to `src/renderer/uikit/Tree/TreeItem.css`: preserve the existing
   one-label/trailing layout when no secondary content exists. In the secondary state, change only
   the primary label's flex-grow from 1 to 0 while retaining its existing `min-width: 0`,
   `overflow: hidden`, and `text-overflow: ellipsis`; give the UIKit-owned secondary host
   `flex: 0 100 auto; min-width: 0` plus generic flex/overflow/ellipsis/nowrap rules. Keep the CSS
   generic and use `data-part`, not `data-name`, as the style hook. The Explorer-supplied path node,
   not the generic host, owns the path-specific `direction`/bidi behavior.
4. Extend `src/renderer/components/tree-provider/TreeProviderViewModel.ts` with the opt-in
   provider-layer accessor with the exact signature
   `getSecondaryLabel?: (item: ITreeProviderItem, level: number) => SlotContent`, and
   `src/renderer/components/tree-provider/TreeProviderViewImpl.ts` with a stable adapter that
   forwards `level` to it. The Explorer callback returns content only for `level === 0`; the
   adapter does not need a second root-path comparison. Level forwarding is deliberate because the
   generic Tree already defines root rows as level zero and `getHideChevron` uses that same signal
   at `TreeProviderViewImpl.ts:324-327`. A href comparison would also be valid—the same file uses
   `provider.rootPath` in `canCollapse` at `:405-406` and `getDragData` at `:421-425`, while
   Explorer's context menu compares root paths case-insensitively at
   `ExplorerSecondaryView.ts:336-343`—but it is not needed when the provider contract forwards
   level. Preserve the existing `tpvNodeTraits` string label for all ordinary rows and the primary
   root name. Cache the Explorer path node by root href, mirroring `iconCache` at
   `TreeProviderViewImpl.ts:48,412-419` and Explorer's `trailingButtons` at
   `ExplorerSecondaryView.ts:41,310-326`.
5. In `src/renderer/editors/explorer/ExplorerSecondaryView.ts`, pass the current `model.rootPath`
   through the opt-in and keep `renderTrailingAction` unchanged. Ensure the accessor returns content
   only for `level === 0`; no other item gets a secondary path. Build the Explorer-owned content
   node with `createTextElement(pathWithDisplayMarks, { truncate: true, color: "light" })` from
   `src/renderer/uikit/Text/text-style.ts:100-108`, then set `.dir = "rtl"` and
   `data-name="explorer-root-path"`. This reuses the existing theme token and Text truncation CSS;
   no Explorer-specific stylesheet is needed.
6. Put U+200E LEFT-TO-RIGHT MARK on both sides of the displayed path text. This follows the existing
   left-truncation precedent in `src/renderer/editors/compare/CompareEditor.ts:67-74`, where
   `createTextElement(..., { truncate: true, color: "light" })` is paired with `.dir = "rtl"`.
   The leading mark anchors leading UNC separators and the trailing mark anchors trailing neutral
   separators. The marks are display-only and must not enter the tooltip value or any path
   comparison. The generic UIKit CSS must not set `direction: rtl` or `text-align: left`:
   direction is supplied by the Explorer content node's `dir` attribute, exactly as the precedent
   does, and `text-align: left` is unnecessary because the shrink-to-fit path node has no alignment
   slack.
7. Use the existing row tooltip path (`getTooltip` → `TreeItemProps.tooltip` → `attachTooltip`) as
   the primary hover tooltip. Do not add a native `title` to the path span: the row tooltip already
   covers pointer movement over its descendants, and a native child title could compete with the
   Tree's delayed custom tooltip.
8. Add a stable `data-name` to the new path element according to the UI contract. The proposed
   value is `explorer-root-path`; it is an additive repeated/debug handle, not a CSS selector.
9. Verify all other consumers remain opt-out and unchanged, run the relevant type/lint/build checks,
   and manually test root-name readability, left truncation, search highlighting, tooltip content,
   resizing, and each non-Explorer tree.

## Repaint safety

`TreeModel.setProps()` treats `items`, child/expansion accessors, and default expansion inputs as
row-derivation inputs at `src/renderer/uikit/Tree/TreeModel.ts:216-243`; it compares global repaint
identities including `searchText`, `renderItem`, indentation, `isSelected`, `getTooltip`, `id`, and
DnD callbacks at `:232-243`, then stores those identities at `:255-271`. The new secondary accessor
must be added to both sides of this stored-identity comparison. Separately, the explicit repaint
signature at `TreeModel.ts:897-912` currently lists the derived `rows`, selected key, active index,
`searchText`, `renderItem`, indentation, `isSelected`, `getTooltip`, identity, and DnD inputs, but
not a secondary accessor; add it there too. `TreeView.onUpdate()` uses that signature to repaint
either all cells or only changed rows at `src/renderer/uikit/Tree/TreeView.ts:172-190`.

`TreeProviderViewImpl.treeProps()` already passes stable bound callbacks for model-owned inputs
(`getTooltip`, `getIconElement`, selection, expansion, DnD) at `TreeProviderViewImpl.ts:300-338`.
The existing comments explicitly warn that fresh callback identities force global repaint at
`:344-360` and `:388-400`. The new `getSecondaryLabel` callback must therefore be included in the
same identity list/signature, and `TreeProviderViewImpl` must pass a bound adapter field rather than
an inline closure created by every `treeProps()` call. `ExplorerSecondaryView.treeProps()` should
likewise pass a stable bound root-path accessor. A callback identity changes only when its secondary
content actually changes, not on every `applyState()`/props pump. The returned root path node must
also be identity-cached per href. This is the same pattern as `iconCache`
(`TreeProviderViewImpl.ts:48`, `:412-419`) and Explorer's `trailingButtons`
(`ExplorerSecondaryView.ts:41`, `:310-326`).

The rich-label option is especially risky here: `TreeModel.sameRow()` compares `item.label` by
identity at `TreeModel.ts:293-303`, so constructing a new rich label each derivation would mark rows
changed. The chosen secondary label does not alter `item.label`; it travels through the new
TreeProps callback, so `sameRow()` remains unaffected. The callback identity is the content-change
signal, while the provider-layer adapter owns the path-node cache and returns the same node identity
until the root href changes.

## Left truncation and bidi

The repository has one direct precedent: `CompareEditor` sets `truncate: true`, `color: "light"`,
`dir = "rtl"`, and `title` on both comparison path labels at
`src/renderer/editors/compare/CompareEditor.ts:67-74`; `Text.css` implements the shared truncation
rules (`overflow: hidden`, `text-overflow: ellipsis`, `white-space: nowrap`, `min-width: 0`) at
`src/renderer/uikit/Text/Text.css:39-44`. No other `direction: rtl`, `unicode-bidi`, or `rtl`
matches exist under `src` (`rg` found only the two CompareEditor assignments).

The generic UIKit secondary host must carry only generic flex/overflow behavior; it must not impose
RTL on all future secondary labels. The Explorer-owned path node gets its truncation behavior from
`createTextElement(..., { truncate: true, color: "light" })` and its bidi direction from `dir="rtl"`.
The path content should therefore combine:

```css
overflow: hidden;
text-overflow: ellipsis;
white-space: nowrap;
```

and the Explorer-owned markup inside the UIKit host should be:

```html
<span class="label">persephone</span>
<span data-part="secondary-label">
  <span data-type="text" data-color="light" data-truncate
        data-name="explorer-root-path" dir="rtl">&#x200E;\\server\share&#x200E;</span>
</span>
```

The `dir="rtl"` attribute is the existing repo precedent for making the overflow edge the left
edge while retaining path text order. Windows drive colon and backslash are bidi-neutral. A UNC
path such as `\\server\share` begins with two neutral backslashes, so a leading U+200E keeps them
from resolving to the paragraph's RTL side; a trailing U+200E performs the same job for a
separator-terminated path such as `C:\`. The marks are display-only: the tooltip receives the
unmarked path string and path comparisons use the original href. No native `title` is needed on the
content node because the Tree's row tooltip is anchored to the containing row and already carries
the full unmarked href.

## Flex sizing

The current Tree row is an `inline-flex` container with `white-space: nowrap` and `overflow:
hidden` at `src/renderer/uikit/Tree/TreeItem.css:23-35`. Its existing label host is
`flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis` at `:138-143`.
That single flexible host is why a rich label inside it must introduce its own flex row.

When secondary content is present, the existing label host must become the primary-name flex item
and the new path span must become its sibling. The primary name must be the readable, preferred
item and the path the first item to surrender width:

```css
[data-type="tree-item"][data-secondary-label] > .label {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
}

[data-part="secondary-label"] {
    display: flex;
    flex: 0 100 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
```

The primary name keeps the existing `min-width: 0; overflow: hidden; text-overflow: ellipsis`
from `TreeItem.css:138-143`; only its flex-grow changes from 1 to 0. The secondary host uses
`flex: 0 100 auto; min-width: 0`, so its weighted shrink factor absorbs essentially all negative
free space until the path reaches zero. The intended degradation order is therefore: the path
shrinks and left-ellipsises, then the path reaches zero width, then the primary name begins to
ellipsise rather than being hard-clipped. The host's generic `overflow`/ellipsis/nowrap rules do not
set path direction; the Explorer-owned `Text` content node carries the actual truncation rules too,
so `text-overflow` acts on the element whose text overflows. The root row's existing
`white-space: nowrap; overflow: hidden` at `TreeItem.css:23-35` remains the final viewport clip.
Do not use the existing `.tree-trailing`: its `flex-shrink: 0` at `TreeItem.css:145-150`
deliberately makes trailing content win space over the label.

Implementation verification must exercise a narrow sidebar with a long path and a long root name
and confirm these weights produce exactly that degradation order: the path loses width first, its
deepest suffix remains visible through left ellipsis, and only after the path is exhausted does the
name use its existing ellipsis.

## Colour token

Use the existing `color.text.light` token (`src/renderer/theme/color.ts:18-24`), which resolves to
`var(--color-text-light)`. The token is defined in every theme: `default-dark.ts:87-90`,
`abyss.ts:33-36`, `light-modern.ts:32-35`, `monokai.ts:33-36`, `quiet-light.ts:32-35`,
`red.ts:34-37`, `solarized-dark.ts:33-36`, `solarized-light.ts:33-36`, and
`tomorrow-night-blue.ts:33-36`. `Text.css` already maps the generic `data-color="light"` state to
that token at `src/renderer/uikit/Text/Text.css:10-13`. This is the repository's existing
description/muted-text colour; no new token is needed.

There is also no new Explorer-side stylesheet: `createTextElement()` supplies the content node's
`data-type="text"`, `data-color`, and `data-truncate` attributes at
`src/renderer/uikit/Text/text-style.ts:100-108`; `Text.css:39-44` supplies `overflow: hidden`,
`text-overflow: ellipsis`, `white-space: nowrap`, and `min-width: 0`, while `Text.css:10-13` maps
`data-color="light"` to the theme token. The same rule sets `display: block` (`Text.css:39-41`),
which is harmless when the node is a flex item inside the secondary host because flex items are
blockified by the flex formatting context.

## Tooltip

The Tree row already receives the full item href through `getTooltip`: `TreeProviderViewImpl`'
bound `getTooltip` falls back to `node.data.href` at `src/renderer/components/tree-provider/TreeProviderViewImpl.ts:402-403`,
`TreeView.itemProps()` forwards it at `src/renderer/uikit/Tree/TreeView.ts:465`, and
`TreeItemView` attaches the custom delayed tooltip to the row root at `TreeItemView.ts:97-113` and
updates it at `:401-405`. For Explorer, this is already the root's full path, so a separate native
`title` on the path span is not required to satisfy the tooltip requirement.

The existing CompareEditor precedent adds a native `title` directly to its path label
(`CompareEditor.ts:69-74`), but Tree rows use `attachTooltip`, whose trigger is the row root and
whose floating tooltip is rendered in the overlay (`src/renderer/uikit/Tooltip/attach-tooltip.ts:81-85`,
`:176-197`). Adding `title` to the child would invoke the browser's native tooltip on that child
while the Tree's custom delayed tooltip can also be active; that risks duplicate or competing
tooltip timing. The implementation should rely on the row tooltip unless a separate child hover
target is explicitly required by testing.

## Consumers and opt-in scope

Direct `TreeProviderViewImpl` consumers verified by search are:

- Explorer: `src/renderer/editors/explorer/ExplorerSecondaryView.ts:12,31,238-245`.
- Archive secondary tree: `src/renderer/editors/archive/ArchiveSecondaryView.ts:6,17,39-40`.
- Archive editor tree: `src/renderer/editors/archive/ArchiveEditorView.ts:10,26,64-71`.
- Mneme tree: `src/renderer/editors/mneme-root/MnemeTreeSecondaryView.ts:4,34,172-186`.
- Script library: `src/renderer/ui/sidebar/ScriptLibraryPanelView.ts:4,32,101-109`.
- Link-category tree: `src/renderer/editors/link-editor/panels/LinkCategoryPanel.ts:4,26,76-84`.
- Menu-bar user-folder trees: `src/renderer/ui/sidebar/MenuBarView.ts:19,480-512`.

The proposed prop is absent from all of these existing props objects and is supplied only by
Explorer, so none of the Archive, Mneme, Script-library, link-category, or menu-folder trees gain a
path label. The Explorer Boards panel is not a `TreeProviderViewImpl` consumer: it constructs
`BoardsTreeView` at `src/renderer/editors/explorer/BoardsSecondaryView.ts:280-293`, and
`BoardsTreeView` constructs a direct `TreeView` at `src/renderer/editors/board/BoardsTreeView.ts:101-105`.
It therefore remains unchanged by a provider-layer opt-in.

## `data-name` / UI-element contract

`doc/architecture/ui-element-contract.md` defines `data-name` as the addressing handle and says
adding a new name is safe; it is not a styling hook. The new path element should therefore carry
the additive name `data-name="explorer-root-path"`. The UIKit-owned wrapper carries
`data-part="secondary-label"`; the Explorer-owned `Text` content node carries `data-name`, `dir`,
and the theme/truncation attributes. They must remain separate because the Tree owns and recycles
the host while the caller owns the filled node. The name need not be unique: the contract explicitly
allows repeated names and uses state/identity attributes to disambiguate them. The element is inside
an editor/sidebar tree, not a listed shell selector, so this is an inspection/debug handle rather
than a new documented shell API.

## Concerns / Open Questions

All requested design questions are resolved by the source evidence above; no open product or
architecture question blocks implementation. The remaining concerns are implementation invariants:

- The current `TreeItemView` has one label host and treats a non-string label as wholly rich slot
  content. Implementation must preserve string primary-label highlighting while adding the path;
  a blind rich-label replacement would regress root search highlighting.
- A node returned by a per-pump callback must be cached. DOM nodes cannot be recreated casually in a
  pooled row because `fillSlot` owns host identity and virtual scrolling may move caller-owned nodes.
- The path and name sizing must be tested with very narrow sidebars, short names, long names, a UNC
  path beginning in `\\`, and a drive-root path ending in `\`; the verified degradation order is
  path shrink/left ellipsis, path reaches zero, then the existing name ellipsis.
- U+200E is intentionally present on both sides of the displayed DOM text but must not leak into the
  tooltip's full-path string or any path comparisons.
- The UIKit-owned secondary host and Explorer-owned path content node must stay separate; the
  content node carries `dir="rtl"` and Text truncation, while the generic host carries only generic
  layout behavior.
- No Explorer-side stylesheet is needed; only the generic secondary-host rules belong in
  `src/renderer/uikit/Tree/TreeItem.css`.
- Do not add a filesystem-specific prop to `src/renderer/uikit/Tree/types.ts`, `TreeItem.ts`, or
  `TreeModel.ts`; that would violate the standalone UIKit boundary. A genuinely generic capability
  may be added only if the implementation proves it is reusable independently of Explorer paths.
- No unit tests are to be added for this investigation-only task, per the request.

## Acceptance Criteria

- [ ] The task document records verified source evidence with file:line references and has no
      unresolved investigation questions.
- [ ] The Explorer root row alone shows the root folder name plus a dim secondary full-path label.
- [ ] The path uses an existing theme token, remains visible at its deepest end under left
      truncation, and never displaces the primary folder name into unreadability.
- [ ] The full unmarked path is available through the existing Tree row tooltip.
- [ ] Root-name search highlighting continues to work; all non-root rows remain unchanged.
- [ ] Archive, Mneme, Script-library, link-category, menu-folder, and Boards trees remain unchanged
      because the capability is opt-in (Boards uses direct `TreeView`).
- [ ] The new path element has `data-name="explorer-root-path"` and does not repurpose `data-name`
      as a CSS selector.
- [ ] Manual resize and bidi checks cover UNC `\\server\share`, `C:\projects\persephone`, and a
      separator-terminated drive-root path, including the path-first/name-second shrink order.
- [ ] No Explorer-side stylesheet is added; `TreeItem.css` is the only new stylesheet touched, and
      the Explorer path node reuses `Text.css` through `createTextElement(..., { truncate: true,
      color: "light" })`.
- [ ] No implementation files, tests, or commits are part of this investigation turn.

## Files Changed Summary

The only new CSS rules belong to the generic secondary host in `src/renderer/uikit/Tree/TreeItem.css`.
The Explorer path node reuses `Text.css` through `createTextElement`; no Explorer-side stylesheet is
added.

| File | Planned status | Purpose |
|---|---|---|
| `doc/tasks/US-1451-explorer-root-path-label/README.md` | Updated for completion | Task evidence, implementation plan, concerns, and acceptance criteria. |
| `doc/active-work.md` | Completed | Dashboard entry moved to `doc/tasks/completed.md`. |
| `src/renderer/editors/explorer/ExplorerSecondaryView.ts` | Implemented | Explorer-only opt-in and root-path source. |
| `src/renderer/components/tree-provider/TreeProviderViewModel.ts` | Implemented | Generic provider-layer secondary-label prop. |
| `src/renderer/components/tree-provider/TreeProviderViewImpl.ts` | Implemented | Root-only projection and stable node cache. |
| `src/renderer/uikit/Tree/types.ts` | Implemented | Add generic `getSecondaryLabel` Tree prop. |
| `src/renderer/uikit/Tree/TreeItem.ts` | Implemented | Add generic `secondaryLabel` row content. |
| `src/renderer/uikit/Tree/TreeItemView.ts` | Implemented | Retain string highlighting while mounting a separate secondary host. |
| `src/renderer/uikit/Tree/TreeItem.css` | Implemented | Generic secondary-label flex and truncation rules. |
| `src/renderer/uikit/Tree/TreeView.ts` | Implemented | Forward the generic secondary-label callback/content. |
| `src/renderer/uikit/Tree/TreeModel.ts` | Implemented | Compare the generic secondary-label callback identity for repaint safety. |
| `src/renderer/theme/color.ts` and `src/renderer/theme/themes/*.ts` | No change planned | Existing `text.light` token fits. |
| `src/renderer/uikit/Text/text-style.ts` and `src/renderer/uikit/Text/Text.css` | No change planned | `createTextElement(..., { truncate: true, color: "light" })` already supplies the required content-node attributes and token-based truncation. |
| `src/renderer/uikit/Tree/Tree.css` | No change planned | Existing tree-level `min-width: 0` is sufficient. |
| `src/renderer/components/tree-provider/TreeProviderView.css` | No change planned | The generic row owns secondary-label layout; provider CSS needs no new selector. |
| `src/renderer/content/tree-providers/FileTreeProvider.ts` | No change planned | It already exposes the full root path and display name used by the provider model. |
| Archive, Mneme, Script-library, Link-category, MenuBar folder, and Boards consumer files listed above | No change planned | The new provider accessor is opt-in; Boards uses direct `TreeView`. |
