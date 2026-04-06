Follow the release process defined in [/doc/standards/release-process.md](doc/standards/release-process.md).

Execute all steps in order:

### Phase 1: Prepare & Tag Release

1. **Check for uncommitted changes** on the working branch.
   - If there are any, stage and commit them with an appropriate message.

2. **Merge working branch into main.**
   ```bash
   git checkout main
   git merge upcoming-vX.Y.Z
   ```

3. **Review and clean up `docs/whats-new.md`** on `main`:

   During development, tasks add entries incrementally — this often produces redundant or misleading entries. Before releasing, review and consolidate:

   - **New Features absorb their improvements.** If a feature was added in this release and later improved in the same release, merge everything into one "New Feature" entry with all capabilities listed. Do not list separate "Improvement" entries for features that are new in this release — users never saw the un-improved version.
   - **Remove internal bug fixes.** If a bug was introduced and fixed within the same release cycle, remove it entirely. Users never experienced it — mentioning the fix is confusing noise.
   - **Improvements = enhancements to previously released features only.** An entry belongs in "Improvements" only if it enhances something that existed in a prior release.
   - **Bug Fixes = fixes for bugs that existed in a prior release.** Only list fixes for issues users could have encountered in a published version.

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
