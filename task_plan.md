# Task Plan

## Goal
Replace the separate side-panel step editor with the floating annotation interaction, align button/color semantics with the updated design delta, and update docs to match the implemented MVP UI.

## Phases
| Phase | Status | Notes |
|---|---|---|
| Inspect current side panel and docs | complete | Confirmed the app used a separate `Step Editor` card and docs still described per-step editing. |
| Implement floating annotation UI | complete | Replaced the standalone editor card with an anchored annotation card in the captured steps list and wired implicit save on dismiss. |
| Update docs and verify | complete | Revised technical/design docs, then ran `npm run check` and `npm run build`. |

## Decisions
- Keep the existing background/storage message model and implement the interaction change entirely in the side-panel React layer.
- Preserve the warm notebook visual language, but reserve terracotta for recording/stop semantics and active recording indicators.
- Keep screenshot capture, paste, and upload support inside the floating card so MVP capability does not regress.

## Errors Encountered
- `git status` from the workspace root failed because the git repository is nested under `workflow-buddy-app/`.
