---
name: github-issues
description: How to triage, work, and close issues reported on the public GitHub repository (andriy-viyatyk/persephone). Use whenever the user mentions a GitHub issue, asks to check for new issues, or when work begins or finishes on something an outside reporter filed.
allowed-tools: Bash, Read, Grep, Glob, Edit, Write
---

# Handling public GitHub issues

Persephone is a public repository with outside users. An issue is a person who took the
trouble to write something down instead of just uninstalling. Treat the reply as the
deliverable, not the code.

**The repository is `andriy-viyatyk/persephone`.** Always pass `--repo andriy-viyatyk/persephone`
to `gh` so a call made from another working directory cannot land on the wrong project.

## The rule that matters most

**Answer before you fix.** A reporter cannot tell "being worked on" from "ignored", and the
gap between filing and shipping is days at minimum. Acknowledge first, and say what happens
next. Everything below is bookkeeping by comparison.

**Never close an issue before the fix is downloadable.** Merging is not shipping. A closed
issue tells the reporter the thing they asked for exists, and if they then install the
latest release and it is not there, the close was a lie. Persephone merges to `main` only
at release time, so closing on merge is *nearly* right — but "nearly" here means closing
before the build is published, without a link to the release that contains it. Wait.

## Labels

Use the repository's existing labels. Do **not** invent per-version labels such as
`fixed in 5.0.2` — they accumulate one dead label per release forever.

| Label | Use for |
|---|---|
| `bug` | Something that used to work, or clearly does not work as documented |
| `enhancement` | A missing capability. Most "X is missing" reports are this, not `bug` |
| `documentation` | The behaviour is right and the guide is wrong or absent |
| `question` | Answerable without a code change |
| `duplicate`, `invalid`, `wontfix` | Self-explanatory; always comment saying why |

One extra label carries the release workflow:

- **`awaiting release`** — the fix is committed but not yet published. Added when the work
  is committed, removed when the issue is closed at release. It is version-agnostic, so it
  never goes stale and it gives the release process an exact query.

Create it once if it does not exist:

```bash
gh label create "awaiting release" --repo andriy-viyatyk/persephone \
    --color "0e8a16" --description "Fixed on the working branch; ships in the next release"
```

Milestones are deliberately not used. `assets/guides/whats-new.md` is the canonical record
of what shipped in which version, and a milestone per patch release duplicates it.

## The flow

### 1. Triage, as soon as you see it

Read the issue. Decide what it actually is — a reporter's framing is a starting point, not a
classification. "The toggle is missing" is an `enhancement` even though it is phrased as a
complaint.

Apply the label, then comment. If the report is incomplete, ask for exactly what you need
(version, OS, steps, a screenshot) and nothing more — a list of six questions reads as a
brush-off.

```bash
gh issue view <n> --repo andriy-viyatyk/persephone
gh issue edit <n> --repo andriy-viyatyk/persephone --add-label enhancement
gh issue comment <n> --repo andriy-viyatyk/persephone --body "..."
```

### 2. Turn it into a task

Anything needing code follows the normal task workflow in
[`doc/agents-common.md`](../../../doc/agents-common.md): a `US-XXXX` document under
`doc/tasks/`, an entry on the dashboard, the usual review and completion skills.

Link it both ways. The task document's header names the issue with its URL; the issue gets
a comment when work actually starts, not when it is merely planned.

### 3. Commit

Reference the issue in the commit body so the history explains itself:

> Resolves the project's first external GitHub issue (#1): the Text Editor had no way to
> turn on word wrap.

**Do not use GitHub's closing keywords** (`Fixes #1`, `Closes #1`, `Resolves #1` on its own
line). They close the issue automatically when the branch reaches `main`, which here is the
release-tag step — before the build is published, and with no comment linking the release.
Write the number as plain prose, as above.

### 4. Hand off to the release

When the work is committed, add `awaiting release` and tell the reporter:

```bash
gh issue edit <n> --repo andriy-viyatyk/persephone --add-label "awaiting release"
gh issue comment <n> --repo andriy-viyatyk/persephone --body "Implemented and merged; it will be in the next release (5.0.2). I will close this here once that build is published."
```

Naming the version is worth it even though the label is version-agnostic — the reporter
wants to know which download to wait for.

### 5. Close, at release

Owned by [`doc/standards/release-process.md`](../../../doc/standards/release-process.md),
after the user confirms the release is published. Comment with the release link, then close.
See that document for the exact step; do not do it early.

## Writing the comments

Write as the maintainer, plainly, to a person who does not know the codebase.

- Say what you found and what you changed, in their terms. "The Text Editor now has a Word
  Wrap button in its toolbar" beats "added `text-word-wrap-toggle` to `TEXT_ELEMENTS`".
- Never paste internal identifiers, task numbers, file paths, or agent workflow into a
  public comment. `US-1402` means nothing outside this repository.
- Do not sign comments as an AI or mention how the work was produced.
- If you decline something, give the reason in one sentence and offer the nearest thing that
  is possible. `wontfix` without a comment is the rudest thing this repository can do.
- Thank a first-time reporter once, briefly. Not every comment.

## Checking for new issues

```bash
gh issue list --repo andriy-viyatyk/persephone --state open \
    --json number,title,author,labels,createdAt
```

An unlabelled open issue has not been triaged yet, whatever its age. An issue labelled
`awaiting release` is waiting on the release process and needs nothing until then.
