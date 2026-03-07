import { z } from "zod";

export const workflowStatusSchema = z.enum(["draft", "recording", "completed"]);
export const stepActionSchema = z.enum(["click", "type"]);

export const storedScreenshotSchema = z.object({
  id: z.string(),
  name: z.string(),
  mimeType: z.string(),
  dataUrl: z.string(),
  createdAt: z.string()
});

export const workflowStepSchema = z.object({
  id: z.string(),
  index: z.number().int().positive(),
  action: stepActionSchema,
  timestamp: z.string(),
  pageUrl: z.string(),
  elementHtml: z.string(),
  description: z.string(),
  failureNotes: z.string().optional(),
  typedValue: z.string().optional(),
  screenshotId: z.string().optional()
});

export const workflowSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: workflowStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  tabId: z.number().int().optional(),
  steps: z.array(workflowStepSchema)
});

export const rootStorageSchema = z.object({
  currentWorkflowId: z.string().nullable(),
  workflowsById: z.record(z.string(), workflowSchema),
  screenshotsById: z.record(z.string(), storedScreenshotSchema),
  activeRecordingTabId: z.number().int().nullable()
});

export const workflowStepDraftSchema = z.object({
  action: stepActionSchema,
  timestamp: z.string(),
  pageUrl: z.string(),
  elementHtml: z.string(),
  typedValue: z.string().optional()
});

export const workflowStepPatchSchema = z.object({
  description: z.string().optional(),
  failureNotes: z.string().optional()
});
