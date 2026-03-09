import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { StoredScreenshot, Workflow } from "../../../shared/types.js";
import type { ExportArtifact, WorkflowExporter } from "../types.js";

const pageWidth = 595.28;
const pageHeight = 841.89;
const margin = 48;
const bodyFontSize = 11;
const labelFontSize = 10;
const headingFontSize = 18;
const stepHeadingFontSize = 14;
const lineGap = 4;
const sectionGap = 12;

function toSafeFileSegment(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "workflow"
  );
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const response = await fetch(dataUrl);
  return response.blob();
}

async function blobToBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

async function normalizePdfImageBytes(
  dataUrl: string,
  mimeType: string
): Promise<{ bytes: Uint8Array; mimeType: "image/png" | "image/jpeg" }> {
  const normalizedMimeType = mimeType.toLowerCase();
  if (normalizedMimeType === "image/png") {
    return { bytes: await blobToBytes(await dataUrlToBlob(dataUrl)), mimeType: "image/png" };
  }

  if (normalizedMimeType === "image/jpeg" || normalizedMimeType === "image/jpg") {
    return { bytes: await blobToBytes(await dataUrlToBlob(dataUrl)), mimeType: "image/jpeg" };
  }

  const sourceBlob = await dataUrlToBlob(dataUrl);
  const bitmap = await createImageBitmap(sourceBlob);

  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("PDF image conversion context is unavailable.");
    }

    context.drawImage(bitmap, 0, 0);
    const pngBlob = await canvas.convertToBlob({ type: "image/png" });
    return {
      bytes: await blobToBytes(pngBlob),
      mimeType: "image/png"
    };
  } finally {
    bitmap.close();
  }
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (!collapsed) return [""];

  const words = collapsed.split(" ");
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    const nextLine = currentLine ? `${currentLine} ${word}` : word;
    if (font.widthOfTextAtSize(nextLine, size) <= maxWidth) {
      currentLine = nextLine;
      continue;
    }

    if (currentLine) {
      lines.push(currentLine);
      currentLine = "";
    }

    let remainder = word;
    while (remainder.length > 0) {
      let sliceLength = remainder.length;
      while (sliceLength > 1 && font.widthOfTextAtSize(remainder.slice(0, sliceLength), size) > maxWidth) {
        sliceLength -= 1;
      }
      lines.push(remainder.slice(0, sliceLength));
      remainder = remainder.slice(sliceLength);
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines;
}

function wrapCodeLine(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  if (!text) return [""];

  const lines: string[] = [];
  let remainder = text;

  while (remainder.length > 0) {
    let sliceLength = remainder.length;
    while (sliceLength > 1 && font.widthOfTextAtSize(remainder.slice(0, sliceLength), size) > maxWidth) {
      sliceLength -= 1;
    }
    lines.push(remainder.slice(0, sliceLength));
    remainder = remainder.slice(sliceLength);
  }

  return lines;
}

class PdfLayout {
  private page: PDFPage;
  private cursorY: number;

  constructor(
    private readonly pdfDoc: PDFDocument,
    private readonly bodyFont: PDFFont,
    private readonly monoFont: PDFFont
  ) {
    this.page = pdfDoc.addPage([pageWidth, pageHeight]);
    this.cursorY = pageHeight - margin;
  }

  private createPage(): void {
    this.page = this.pdfDoc.addPage([pageWidth, pageHeight]);
    this.cursorY = pageHeight - margin;
  }

  private ensureSpace(height: number): void {
    if (this.cursorY - height < margin) {
      this.createPage();
    }
  }

  private drawLines(lines: string[], font: PDFFont, size: number, color = rgb(0.18, 0.14, 0.1)): void {
    const lineHeight = size + lineGap;
    this.ensureSpace(lines.length * lineHeight);

    for (const line of lines) {
      this.page.drawText(line, {
        x: margin,
        y: this.cursorY - size,
        size,
        font,
        color
      });
      this.cursorY -= lineHeight;
    }
  }

  addHeading(text: string): void {
    this.drawLines([text], this.bodyFont, headingFontSize, rgb(0.07, 0.05, 0.04));
    this.cursorY -= 6;
  }

  addMeta(text: string): void {
    this.drawLines([text], this.bodyFont, bodyFontSize, rgb(0.42, 0.35, 0.28));
    this.cursorY -= 8;
  }

  addStepHeading(text: string): void {
    this.ensureSpace(28);
    this.page.drawRectangle({
      x: margin,
      y: this.cursorY - 20,
      width: pageWidth - margin * 2,
      height: 1,
      color: rgb(0.88, 0.85, 0.8)
    });
    this.cursorY -= 18;
    this.drawLines([text], this.bodyFont, stepHeadingFontSize, rgb(0.12, 0.09, 0.08));
    this.cursorY -= 4;
  }

  addLabeledText(label: string, value: string): void {
    this.drawLines([label], this.bodyFont, labelFontSize, rgb(0.46, 0.37, 0.28));
    this.drawLines(wrapText(value, this.bodyFont, bodyFontSize, pageWidth - margin * 2), this.bodyFont, bodyFontSize);
    this.cursorY -= 4;
  }

  addCodeBlock(label: string, value: string): void {
    this.drawLines([label], this.bodyFont, labelFontSize, rgb(0.46, 0.37, 0.28));

    const codeLines = value
      .split("\n")
      .flatMap((line) => wrapCodeLine(line, this.monoFont, 9, pageWidth - margin * 2 - 20));
    const lineHeight = 12;
    const blockHeight = Math.max(codeLines.length * lineHeight + 20, 32);
    this.ensureSpace(blockHeight);

    this.page.drawRectangle({
      x: margin,
      y: this.cursorY - blockHeight + 4,
      width: pageWidth - margin * 2,
      height: blockHeight,
      color: rgb(0.97, 0.95, 0.92),
      borderColor: rgb(0.88, 0.85, 0.8),
      borderWidth: 1
    });

    let lineY = this.cursorY - 14;
    for (const line of codeLines) {
      this.page.drawText(line, {
        x: margin + 10,
        y: lineY,
        size: 9,
        font: this.monoFont,
        color: rgb(0.2, 0.16, 0.12)
      });
      lineY -= lineHeight;
    }

    this.cursorY -= blockHeight + 4;
  }

  async addImage(label: string, screenshot: StoredScreenshot): Promise<void> {
    this.drawLines([label], this.bodyFont, labelFontSize, rgb(0.46, 0.37, 0.28));

    const normalized = await normalizePdfImageBytes(screenshot.dataUrl, screenshot.mimeType);
    const image =
      normalized.mimeType === "image/png"
        ? await this.pdfDoc.embedPng(normalized.bytes)
        : await this.pdfDoc.embedJpg(normalized.bytes);

    const maxWidth = pageWidth - margin * 2;
    const maxHeight = 220;
    const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
    const width = image.width * scale;
    const height = image.height * scale;

    this.ensureSpace(height + sectionGap);
    this.page.drawImage(image, {
      x: margin,
      y: this.cursorY - height,
      width,
      height
    });
    this.cursorY -= height + sectionGap;
  }

  addSpacer(height = sectionGap): void {
    this.cursorY -= height;
  }
}

export class PdfExporter implements WorkflowExporter {
  readonly format = "pdf" as const;

  async export(
    workflow: Workflow,
    screenshotsById: Record<string, StoredScreenshot>
  ): Promise<ExportArtifact> {
    const pdfDoc = await PDFDocument.create();
    const bodyFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const monoFont = await pdfDoc.embedFont(StandardFonts.Courier);
    const layout = new PdfLayout(pdfDoc, bodyFont, monoFont);

    layout.addHeading(`Workflow: ${workflow.name}`);
    layout.addMeta(`Created At: ${workflow.createdAt}`);
    layout.addMeta(`Steps: ${workflow.steps.length}`);
    layout.addSpacer();

    for (const step of workflow.steps) {
      layout.addStepHeading(`Step ${step.index}`);
      layout.addLabeledText("Action", step.action);
      layout.addLabeledText("Timestamp", step.timestamp);
      layout.addLabeledText("Page URL", step.pageUrl);
      layout.addLabeledText("Description", step.description || "(No description yet)");
      if (step.typedValue) {
        layout.addLabeledText("Typed Value", step.typedValue);
      }
      if (step.failureNotes) {
        layout.addLabeledText("Failure Notes", step.failureNotes);
      }
      layout.addCodeBlock("Element HTML", step.elementHtml);

      if (step.screenshotId) {
        const screenshot = screenshotsById[step.screenshotId];
        if (screenshot) {
          await layout.addImage("Screenshot", screenshot);
        } else {
          layout.addLabeledText("Screenshot", `(Missing asset for ${step.screenshotId})`);
        }
      }

      layout.addSpacer(8);
    }

    return {
      filename: `${toSafeFileSegment(workflow.name)}.pdf`,
      mimeType: "application/pdf",
      bytes: await pdfDoc.save()
    };
  }
}
