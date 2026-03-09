import type { ExportFormat } from "../../shared/types.js";
import type { WorkflowExporter } from "./types.js";
import { MarkdownZipExporter } from "./exporters/markdownZipExporter.js";
import { PdfExporter } from "./exporters/pdfExporter.js";

const markdownZipExporter = new MarkdownZipExporter();
const pdfExporter = new PdfExporter();

export function getWorkflowExporter(format: ExportFormat): WorkflowExporter {
  switch (format) {
    case "pdf":
      return pdfExporter;
    case "markdown-zip":
    default:
      return markdownZipExporter;
  }
}
