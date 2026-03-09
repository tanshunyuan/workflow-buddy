import { z } from "zod";

export const workflowStatusSchema = z.enum(["draft", "recording", "paused", "completed"]);
export const stepActionSchema = z.enum(["click", "type"]);

export const storedScreenshotSchema = z.object({
  id: z.string(),
  name: z.string(),
  mimeType: z.string(),
  dataUrl: z.string(),
  createdAt: z.string()
});

export const screenshotSelectionRectSchema = z.object({
  x: z.number().finite().nonnegative(),
  y: z.number().finite().nonnegative(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive()
});

export const screenshotSelectionViewportSchema = z.object({
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
  devicePixelRatio: z.number().finite().positive()
});

export const screenshotSelectionSchema = z.object({
  rect: screenshotSelectionRectSchema,
  viewport: screenshotSelectionViewportSchema
});

export const screenshotAssistResponseSchema = z.union([
  z.object({
    ok: z.literal(true),
    selection: screenshotSelectionSchema
  }),
  z.object({
    ok: z.literal(false),
    error: z.string(),
    canceled: z.boolean().optional()
  })
]);

export const workflowStepSchema = z.object({
  id: z.string(),
  index: z.number().int().positive(),
  action: stepActionSchema,
  timestamp: z.string(),
  pageUrl: z.string(),
  elementHtml: z.string(),
  clickFingerprint: z.string().optional(),
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
  clickFingerprint: z.string().optional(),
  typedValue: z.string().optional()
});

export const workflowStepPatchSchema = z.object({
  description: z.string().optional(),
  failureNotes: z.string().optional()
});
