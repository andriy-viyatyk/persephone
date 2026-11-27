# Release Process

How to publish a new version of persephone.

## Release assets and Linux verification

The Windows workflow builds the signed `persephone-setup-<version>.exe` installer and the Windows
portable ZIP. The release workflow also builds the Linux packages in CI on `ubuntu-24.04` (glibc
2.39); Linux release packages are not built on a maintainer workstation. The Linux asset is
`persephone-<version>-linux-amd64.deb` (the only Linux format). Both
platforms' assets are attached to the same draft.

Before publishing a Linux package, Claude checks the `.deb` in the clean Ubuntu 26.04 and Debian 13
VMs documented in [`linux-development.md`](../linux-development.md#clean-install-vms). Restore each
VM's `clean` checkpoint before the install check, and run only one VM at a time. Follow that
document's install checklist. The user remains in control of publication: the release stays a draft
until the user publishes it.

## Branch & Version Convention

- Development happens on a **working branch** named `upcoming-vX.Y.Z` (e.g., `upcoming-v2.0.2` for version 2.0.2).
- The `package.json` version matches the working branch (e.g., `2.0.2`).
- The `main` branch always reflects the latest released version.
- Git tags `vX.Y.Z` on `main` trigger the GitHub Actions build pipeline.

## Trigger

When the user says **"let's publish new build"** (or similar), follow the steps below.

## Steps

### Phase 1: Prepare & Tag Release

1. **Check for uncommitted changes** on the working branch.
   - If there are any, stage and commit them with an appropriate message.

2. **Merge working branch into main.**
   ```bash
   git checkout main
   git merge upcoming-vX.Y.Z
   ```

3. **Review and clean up `assets/guides/whats-new.md`** on `main`:

   During development, tasks add entries incrementally — this often produces redundant or misleading entries. Before releasing, review and consolidate:

   - **New Features absorb their improvements.** If a feature was added in this release and later improved in the same release, merge everything into one "New Feature" entry with all capabilities listed. Do not list separate "Improvement" entries for features that are new in this release — users never saw the un-improved version.
   - **Remove internal bug fixes.** If a bug was introduced and fixed within the same release cycle, remove it entirely. Users never experienced it — mentioning the fix is confusing noise.
   - **Improvements = enhancements to previously released features only.** An entry belongs in "Improvements" only if it enhances something that existed in a prior release.
   - **Bug Fixes = fixes for bugs that existed in a prior release.** Only list fixes for issues users could have encountered in a published version.

   **Condense releases that leave the detail window.** Only the 10 most recent released versions
   keep full notes; the `(Upcoming)` section does not count. Once this release is marked released,
   the version that is now 11th newest (and any older one that was missed) gets condensed:

   - Keep only **New Features** and **Breaking Changes**. Fold `Features` and `Other New Features`
     into New Features. Drop every other subsection: Improvements, Bug Fixes, UI Polish, Security,
     Under the hood, and the rest.
   - Each entry becomes one line: a bold name plus at most one short sentence. Drop sub-bullets,
     code samples and explanation.
   - Merge closely related features into one line, and keep the `## Version X.Y.Z` heading. The
     `guides.whatsNew` reader finds sections by that heading.
   - If nothing is left, write `*Maintenance release: bug fixes and improvements.*`.

   After consolidation:
   - Change the current version header from `(Upcoming)` to a release (remove the word "Upcoming").
   - Add a new section above it for the next version:
     ```markdown
     ## Version X.Y.{Z+1} (Upcoming)

     *No changes yet.*

     ---

     ## Version X.Y.Z
     ```

4. **Commit and tag** on `main`:
   ```bash
   git add assets/guides/whats-new.md
   git commit -m "Mark vX.Y.Z as released and add vX.Y.{Z+1} upcoming section"
   git tag vX.Y.Z
   ```

5. **Push main with tag:**
   ```bash
   git push origin main --tags
   ```
   This triggers the GitHub Actions build pipeline.

6. **Notify the user** that the tag has been pushed and the build is running. Provide a link:
   ```
   https://github.com/andriy-viyatyk/persephone/actions
   ```

7. **Wait** for the user to confirm that the GitHub build is complete and the release is published.

7.5 **Close the GitHub issues this release fixes.** A fix is not delivered until it is
   downloadable, so issues are held open until now rather than closed when the code merges.

   ```bash
   gh issue list --repo andriy-viyatyk/persephone --label "awaiting release" --state open
   ```

   For each issue actually fixed in this version, comment with the release link and close it:

   ```bash
   gh issue comment <n> --repo andriy-viyatyk/persephone --body "Released in vX.Y.Z: https://github.com/andriy-viyatyk/persephone/releases/tag/vX.Y.Z"
   gh issue edit <n> --repo andriy-viyatyk/persephone --remove-label "awaiting release"
   gh issue close <n> --repo andriy-viyatyk/persephone
   ```

   Write the comment for the reporter, in their own terms, naming what changed and the
   version to download. Never put internal task ids or file paths in a public comment. An
   issue on the list that this version did *not* fix keeps its label and stays open — the
   label means "waiting for a release", not "waiting for this one". Full policy lives in the
   [`github-issues`](../../.claude/skills/github-issues/SKILL.md) skill.

### Phase 2: Prepare Next Version (after user confirms)

8. **Bump version** in `package.json` to `X.Y.{Z+1}`:
   ```bash
   npm version X.Y.{Z+1} --no-git-tag-version
   ```

9. **Create and switch to the new working branch:**
   ```bash
   git checkout -b upcoming-vX.Y.{Z+1}
   ```

10. **Commit the version bump:**
    ```bash
    git add package.json package-lock.json
    git commit -m "Bump version to X.Y.{Z+1}"
    ```

11. **Push the new working branch:**
    ```bash
    git push -u origin upcoming-vX.Y.{Z+1}
    ```

12. **Confirm** to the user that the new working branch is ready.

## Example

For releasing v2.0.1 and starting v2.0.2:

| Step | Command / Action |
|------|-----------------|
| Merge | `git checkout main && git merge upcoming-v2.0.1` |
| Update whats-new | Add `v2.0.2 (Upcoming)` section, mark `v2.0.1` as released |
| Commit + tag | `git commit ... && git tag v2.0.1` |
| Push | `git push origin main --tags` |
| *Wait for build* | User confirms release is published |
| Bump version | `npm version 2.0.2 --no-git-tag-version` |
| New branch | `git checkout -b upcoming-v2.0.2` |
| Commit + push | `git commit ... && git push -u origin upcoming-v2.0.2` |

## Isolated workflow check (throwaway draft)

Never dispatch a test build with the real upcoming package version. Claude checks the workflow on a
disposable branch with a unique prerelease version, then removes only the identified test draft and
the disposable remote branch. This avoids collisions with the real upcoming release.

1. On a disposable branch containing the completed workflow and its Linux packaging dependencies,
   choose a unique valid semver prerelease such as `<next-version>-ci.us2238.<unique-number>`. First
   confirm neither `v<test-version>` nor `<test-version>` already identifies a release or tag.
2. Run `npm version <test-version> --no-git-tag-version` so both `package.json` and
   `package-lock.json` have the test version. Commit and push this disposable branch only. Do not
   alter the real upcoming branch's version, push a tag, merge the test version commit, or publish
   its draft.
3. Dispatch and inspect the run:

   ```bash
   gh workflow run publish.yml --repo andriy-viyatyk/persephone --ref <disposable-branch>
   gh run list --repo andriy-viyatyk/persephone --workflow publish.yml --branch <disposable-branch>
   gh run watch <run-id> --repo andriy-viyatyk/persephone --exit-status
   gh release view v<test-version> --repo andriy-viyatyk/persephone --json tagName,isDraft,assets
   ```

   Use the actual matching tag if the release uses the bare version. Confirm both jobs, the single
   matching draft, the Windows setup installer and portable ZIP, the signing step, dispatch
   metadata, both Linux packages, the GLIBC check, and the absence of Linux update metadata. Record
   the actual generated and uploaded files. The workflow's Windows cleanup is tag-only, so dispatch
   metadata (`latest.yml` and Windows blockmaps) remains attached until the throwaway draft is
   deleted.
4. After recording results, delete that identified test draft only. If a test tag was unexpectedly
   created, stop and investigate rather than deleting it automatically. Then delete the disposable
   remote branch with `git push origin --delete <disposable-branch>`. If a job fails, record the
   failure and safely remove the identified test draft and disposable remote branch before retrying
   with a fresh unique prerelease version and branch.

Do not publish the test draft. A dispatch draft is not a test of the tag-only Windows cleanup; the
draft must be deleted before the real release version is used.

## VMP Signing (Widevine DRM)

The GitHub Actions pipeline automatically VMP-signs the production build using Castlabs EVS. This enables DRM playback (Netflix, Disney+) in the built-in browser.

**Requirements:**
- GitHub repo secrets: `EVS_ACCOUNT_NAME` and `EVS_PASSWD` (Castlabs EVS credentials)
- The `afterSign` hook in `electron-builder.yml` runs `scripts/vmp-sign.mjs`

**Local builds:** Set `VMP_SIGN=true` to enable VMP signing locally:
```bash
VMP_SIGN=true npm run dist
```
Without `VMP_SIGN=true`, signing is skipped (default for developers without EVS credentials).
