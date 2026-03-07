# Task Plan

## Goal
Record one workflow step per user click action, even when a styled control emits multiple related click events, and update the docs to describe the new behavior.

## Phases
| Phase | Status | Notes |
|---|---|---|
| Inspect recorder and docs | complete | Confirmed click capture uses raw `event.target.outerHTML` with no dedupe. |
| Implement click-step collapsing | complete | Added click capture normalization plus short-window dedupe for repeated events against the same resolved control element. |
| Update docs and verify | complete | Updated PRD and technical design docs, then ran `npm run check`. |

## Decisions
- Keep the change inside the content script so background storage and side panel behavior remain unchanged.
- Resolve click capture to an enclosing `label` first, then fall back to the nearest interactive ancestor, so composite controls store one consistent element snapshot.
- Use a short dedupe window keyed by the resolved capture element plus `MouseEvent.detail` to suppress duplicate click events from one gesture without collapsing normal double-clicks.
- Dedupe by normalized click snapshot after stripping transient UI animation markup, because rerenders can replace the live DOM node and inject non-semantic children such as Ant wave elements.

## Errors Encountered
- `git status` from the workspace root failed because the git repository is nested under `workflow-buddy-app/`.
- A follow-up `rg` command failed because it was run from the app root while pointing at workspace-level `docs/` paths.
