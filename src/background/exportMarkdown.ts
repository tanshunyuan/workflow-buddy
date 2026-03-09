import type { StoredScreenshot, Workflow } from "../shared/types.js";

const mimeTypeToExtension: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif"
};

function getScreenshotExtension(screenshot: StoredScreenshot): string {
  const filenameMatch = screenshot.name.match(/\.([a-z0-9]+)$/i);
  if (filenameMatch) {
    return filenameMatch[1].toLowerCase();
  }

  return mimeTypeToExtension[screenshot.mimeType.toLowerCase()] ?? "png";
}

export function buildExportScreenshotPath(stepIndex: number, screenshot: StoredScreenshot): string {
  return `images/step-${String(stepIndex).padStart(2, "0")}.${getScreenshotExtension(screenshot)}`;
}

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
      if (screenshot) {
        lines.push("Screenshot:");
        lines.push(`![Step ${step.index} screenshot](./${buildExportScreenshotPath(step.index, screenshot)})`);
      } else {
        lines.push(`Screenshot: (Missing asset for ${step.screenshotId})`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}
