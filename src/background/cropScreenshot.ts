import type { ScreenshotSelection } from "../shared/types.js";

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const response = await fetch(dataUrl);
  return response.blob();
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return `data:${blob.type};base64,${btoa(binary)}`;
}

export async function cropScreenshotDataUrl(
  dataUrl: string,
  selection: ScreenshotSelection,
  mimeType = "image/png"
): Promise<string> {
  const sourceBlob = await dataUrlToBlob(dataUrl);
  const bitmap = await createImageBitmap(sourceBlob);

  try {
    const scaleX = bitmap.width / selection.viewport.width;
    const scaleY = bitmap.height / selection.viewport.height;
    const sourceX = clamp(Math.round(selection.rect.x * scaleX), 0, Math.max(bitmap.width - 1, 0));
    const sourceY = clamp(Math.round(selection.rect.y * scaleY), 0, Math.max(bitmap.height - 1, 0));
    const sourceWidth = clamp(
      Math.round(selection.rect.width * scaleX),
      1,
      Math.max(bitmap.width - sourceX, 1)
    );
    const sourceHeight = clamp(
      Math.round(selection.rect.height * scaleY),
      1,
      Math.max(bitmap.height - sourceY, 1)
    );

    const canvas = new OffscreenCanvas(sourceWidth, sourceHeight);
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Screenshot crop context is unavailable.");
    }

    context.drawImage(
      bitmap,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      sourceWidth,
      sourceHeight
    );

    const croppedBlob = await canvas.convertToBlob({ type: mimeType });
    return blobToDataUrl(croppedBlob);
  } finally {
    bitmap.close();
  }
}
