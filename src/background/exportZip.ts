import type { StoredScreenshot, Workflow } from "../shared/types.js";
import { buildExportScreenshotPath, exportWorkflowToMarkdown } from "./exportMarkdown.js";

type ZipFileEntry = {
  name: string;
  data: Uint8Array;
  modifiedAt: Date;
};

const textEncoder = new TextEncoder();
const crcTable = buildCrcTable();

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256);

  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }

  return table;
}

function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;

  for (const byte of bytes) {
    value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  }

  return (value ^ 0xffffffff) >>> 0;
}

function toUint16(value: number): Uint8Array {
  const bytes = new Uint8Array(2);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, value, true);
  return bytes;
}

function toUint32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, value >>> 0, true);
  return bytes;
}

function joinBytes(parts: Uint8Array[]): Uint8Array {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;

  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }

  return output;
}

function toDosDateTime(input: Date): { date: number; time: number } {
  const safeDate = Number.isNaN(input.getTime()) ? new Date() : input;
  const year = Math.max(safeDate.getFullYear(), 1980);
  const month = safeDate.getMonth() + 1;
  const day = safeDate.getDate();
  const hours = safeDate.getHours();
  const minutes = safeDate.getMinutes();
  const seconds = Math.floor(safeDate.getSeconds() / 2);

  return {
    date: ((year - 1980) << 9) | (month << 5) | day,
    time: (hours << 11) | (minutes << 5) | seconds
  };
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

  return textEncoder.encode(decodeURIComponent(payload));
}

function createZipArchive(files: ZipFileEntry[]): Uint8Array {
  const localFileParts: Uint8Array[] = [];
  const centralDirectoryParts: Uint8Array[] = [];
  let localOffset = 0;

  for (const file of files) {
    const filenameBytes = textEncoder.encode(file.name);
    const checksum = crc32(file.data);
    const { date, time } = toDosDateTime(file.modifiedAt);

    const localHeader = joinBytes([
      toUint32(0x04034b50),
      toUint16(20),
      toUint16(0),
      toUint16(0),
      toUint16(time),
      toUint16(date),
      toUint32(checksum),
      toUint32(file.data.length),
      toUint32(file.data.length),
      toUint16(filenameBytes.length),
      toUint16(0),
      filenameBytes
    ]);

    localFileParts.push(localHeader, file.data);

    const centralHeader = joinBytes([
      toUint32(0x02014b50),
      toUint16(20),
      toUint16(20),
      toUint16(0),
      toUint16(0),
      toUint16(time),
      toUint16(date),
      toUint32(checksum),
      toUint32(file.data.length),
      toUint32(file.data.length),
      toUint16(filenameBytes.length),
      toUint16(0),
      toUint16(0),
      toUint16(0),
      toUint16(0),
      toUint32(0),
      toUint32(localOffset),
      filenameBytes
    ]);

    centralDirectoryParts.push(centralHeader);
    localOffset += localHeader.length + file.data.length;
  }

  const centralDirectory = joinBytes(centralDirectoryParts);
  const endOfCentralDirectory = joinBytes([
    toUint32(0x06054b50),
    toUint16(0),
    toUint16(0),
    toUint16(files.length),
    toUint16(files.length),
    toUint32(centralDirectory.length),
    toUint32(localOffset),
    toUint16(0)
  ]);

  return joinBytes([...localFileParts, centralDirectory, endOfCentralDirectory]);
}

export function buildWorkflowExportZip(
  workflow: Workflow,
  screenshotsById: Record<string, StoredScreenshot>
): Uint8Array {
  const files: ZipFileEntry[] = [
    {
      name: "workflow.md",
      data: textEncoder.encode(exportWorkflowToMarkdown(workflow, screenshotsById)),
      modifiedAt: new Date(workflow.updatedAt || workflow.createdAt)
    }
  ];

  for (const step of workflow.steps) {
    if (!step.screenshotId) {
      continue;
    }

    const screenshot = screenshotsById[step.screenshotId];
    if (!screenshot) {
      continue;
    }

    files.push({
      name: buildExportScreenshotPath(step.index, screenshot),
      data: dataUrlToBytes(screenshot.dataUrl),
      modifiedAt: new Date(screenshot.createdAt)
    });
  }

  return createZipArchive(files);
}
