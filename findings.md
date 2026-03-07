# Findings

- The current click recorder listens on `document` in the capture phase and immediately records `createClickStep(event.target)`.
- `createClickStep()` stores `elementHtml` as `target.outerHTML`, so composite controls can produce multiple steps from one user interaction.
- Ant Design radio-button markup uses a `label` wrapper plus an inner `input[type="radio"]` and visual content node, which explains the duplicate recorded steps.
- Resolving click capture to a canonical control element and deduping repeated events in a short time window preserves one-step-per-action without changing the storage model.
- Ant Design also injects transient wave markup after click, which changes the control `outerHTML` and can bypass naive dedupe unless the snapshot is normalized first.
