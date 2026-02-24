# Release Process

How to publish a new version of js-notepad.

## Branch & Version Convention

- Development happens on a **working branch** named `upcoming-vN` (e.g., `upcoming-v15` for version 1.0.15).
- The `package.json` version matches the working branch (e.g., `1.0.15`).
- The `main` branch always reflects the latest released version.
- Git tags `v1.0.N` on `main` trigger the GitHub Actions build pipeline.

## Trigger

When the user says **"let's publish new build"** (or similar), follow the steps below.

## Steps

### Phase 1: Prepare & Tag Release

1. **Check for uncommitted changes** on the working branch.
   - If there are any, stage and commit them with an appropriate message.

2. **Merge working branch into main.**
   ```bash
   git checkout main
   git merge upcoming-vN
   ```

3. **Update `docs/whats-new.md`** on `main`:
   - Change the current version header from `(Upcoming)` to a release (remove the word "Upcoming").
   - Add a new section above it for the next version:
     ```markdown
     ## Version 1.0.{N+1} (Upcoming)

     *No changes yet.*

     ---

     ## Version 1.0.N
     ```

4. **Commit and tag** on `main`:
   ```bash
   git add docs/whats-new.md
   git commit -m "Mark v1.0.N as released and add v1.0.{N+1} upcoming section"
   git tag v1.0.N
   ```

5. **Push main with tag:**
   ```bash
   git push origin main --tags
   ```
   This triggers the GitHub Actions build pipeline.

6. **Notify the user** that the tag has been pushed and the build is running. Provide a link:
   ```
   https://github.com/andriy-viyatyk/js-notepad/actions
   ```

7. **Wait** for the user to confirm that the GitHub build is complete and the release is published.

### Phase 2: Prepare Next Version (after user confirms)

8. **Bump version** in `package.json` to `1.0.{N+1}`:
   ```bash
   npm version 1.0.{N+1} --no-git-tag-version
   ```

9. **Create and switch to the new working branch:**
   ```bash
   git checkout -b upcoming-v{N+1}
   ```

10. **Commit the version bump:**
    ```bash
    git add package.json package-lock.json
    git commit -m "Bump version to 1.0.{N+1}"
    ```

11. **Push the new working branch:**
    ```bash
    git push -u origin upcoming-v{N+1}
    ```

12. **Confirm** to the user that the new working branch is ready.

## Example

For releasing v1.0.15 and starting v1.0.16:

| Step | Command / Action |
|------|-----------------|
| Merge | `git checkout main && git merge upcoming-v15` |
| Update whats-new | Add `v1.0.16 (Upcoming)` section, mark `v1.0.15` as released |
| Commit + tag | `git commit ... && git tag v1.0.15` |
| Push | `git push origin main --tags` |
| *Wait for build* | User confirms release is published |
| Bump version | `npm version 1.0.16 --no-git-tag-version` |
| New branch | `git checkout -b upcoming-v16` |
| Commit + push | `git commit ... && git push -u origin upcoming-v16` |
