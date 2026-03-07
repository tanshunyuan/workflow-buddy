# Findings

- The current side panel already has the warning/error color tokens in `src/sidepanel/index.css`, but the main annotation flow still lives in a separate `Step Editor` card in `src/sidepanel/app.tsx`.
- Step selection is single-state only: clicking a row highlights it and populates editor-local React state, but there is no anchored overlay, row dimming, or implicit save behavior.
- The existing message/storage layer is sufficient for the redesign: `UPDATE_STEP`, `ATTACH_SCREENSHOT`, and `CAPTURE_SCREENSHOT` already cover description, failure notes, and screenshot updates without schema changes.
- Current primary action styling already supports dark-ink buttons and terracotta stop buttons through the shared `Button` variants, so the main visual work is in step-row chips and annotation affordances.
- Technical docs still describe a per-step editor, so implementation and docs are currently out of sync.
