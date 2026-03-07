# Progress

## 2026-03-07
- Read MVP product and technical docs for recording constraints.
- Inspected content-script click capture and confirmed it records every click target without normalization.
- Identified the repo root and prepared to patch the content script plus docs.
- Patched click capture to resolve one canonical control element per action and suppress duplicate click events emitted by composite controls.
- Updated PRD and technical-design docs to describe single-step click capture behavior.
- Ran `npm run check` successfully.
- Tightened click dedupe again to use normalized control HTML and strip transient Ant wave markup before storage.
- Rebuilt the extension bundle with `npm run build`.
- Audited the side panel against the new floating-annotation prototype and confirmed the app still uses a separate step editor card.
- Confirmed the existing background/storage messages already support implicit-save annotation changes without schema updates.
- Replaced the side-panel step editor with an anchored floating annotation card that keeps the step list visible.
- Added implicit save on outside click, `Escape`, `Cmd/Ctrl+Enter`, and active-row re-click, while keeping screenshot capture/upload flows in place.
- Updated the technical and design docs to describe the floating annotation model.
- Ran `npm run check` and `npm run build` after the rewrite.
