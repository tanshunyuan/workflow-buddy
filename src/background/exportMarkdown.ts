import type { StoredScreenshot, Workflow } from "../shared/types.js";

export function exportWorkflowToMarkdown(
  workflow: Workflow,
  screenshotsById: Record<string, StoredScreenshot>
): string {
  const lines: string[] = [
    `# Workflow: ${workflow.name}`,
    "",
    `Created At: ${workflow.createdAt}`,
    ""
  ];

  for (const step of workflow.steps) {
    lines.push(`## Step ${step.index}`);
    lines.push(`Action: ${step.action}`);
    lines.push(`Timestamp: ${step.timestamp}`);
    lines.push(`Page URL: ${step.pageUrl}`);
    lines.push(`Description: ${step.description || "(No description yet)"}`);
    if (step.typedValue) {
      lines.push(`Typed Value: ${step.typedValue}`);
    }
    lines.push("Element HTML:");
    lines.push("```html");
    lines.push(step.elementHtml);
    lines.push("```");
    if (step.failureNotes) {
      lines.push(`Failure Notes: ${step.failureNotes}`);
    }
    if (step.screenshotId) {
      const screenshot = screenshotsById[step.screenshotId];
      lines.push(`Screenshot: ${screenshot?.name ?? step.screenshotId}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
