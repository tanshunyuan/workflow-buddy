import type { ExportFormat, StoredScreenshot, Workflow } from "../../shared/types.js";

export interface ExportArtifact {
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
}

export interface WorkflowExporter {
  readonly format: ExportFormat;
  export(
    workflow: Workflow,
    screenshotsById: Record<string, StoredScreenshot>
  ): Promise<ExportArtifact>;
}
