import JSZip from "jszip";
import type { StoredScreenshot, Workflow } from "../../../shared/types.js";
import type { ExportArtifact, WorkflowExporter } from "../types.js";
import { buildExportScreenshotPath, exportWorkflowToMarkdown } from "../../exportMarkdown.js";

function toSafeFileSegment(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "workflow"
  );
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64.replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const separatorIndex = dataUrl.indexOf(",");
  if (separatorIndex === -1) {
    throw new Error("Invalid screenshot data URL.");
  }

  const metadata = dataUrl.slice(0, separatorIndex);
  const payload = dataUrl.slice(separatorIndex + 1);

  if (metadata.includes(";base64")) {
    return base64ToBytes(payload);
  }

  return new TextEncoder().encode(decodeURIComponent(payload));
}

export class MarkdownZipExporter implements WorkflowExporter {
  readonly format = "markdown-zip" as const;

  async export(
    workflow: Workflow,
    screenshotsById: Record<string, StoredScreenshot>
  ): Promise<ExportArtifact> {
    const zip = new JSZip();
    zip.file("workflow.md", exportWorkflowToMarkdown(workflow, screenshotsById));

    for (const step of workflow.steps) {
      if (!step.screenshotId) {
        continue;
      }

      const screenshot = screenshotsById[step.screenshotId];
      if (!screenshot) {
        continue;
      }

      zip.file(buildExportScreenshotPath(step.index, screenshot), dataUrlToBytes(screenshot.dataUrl));
    }

    return {
      filename: `${toSafeFileSegment(workflow.name)}.zip`,
      mimeType: "application/zip",
      bytes: await zip.generateAsync({ type: "uint8array" })
    };
  }
}
