# Release Process

How to publish a new version of persephone.

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

3. **Update `docs/whats-new.md`** on `main`:
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
   git add docs/whats-new.md
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

## VMP Signing (Widevine DRM)

The GitHub Actions pipeline automatically VMP-signs the production build using Castlabs EVS. This enables DRM playback (Netflix, Disney+) in the built-in browser.

**Requirements:**
- GitHub repo secrets: `EVS_ACCOUNT_NAME` and `EVS_PASSWD` (Castlabs EVS credentials)
- The `afterPack` hook in `electron-builder.yml` runs `scripts/vmp-sign.mjs`

**Local builds:** Set `VMP_SIGN=true` to enable VMP signing locally:
```bash
VMP_SIGN=true npm run dist
```
Without `VMP_SIGN=true`, signing is skipped (default for developers without EVS credentials).
