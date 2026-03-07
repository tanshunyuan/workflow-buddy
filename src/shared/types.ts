import type { z } from "zod";
import type {
  rootStorageSchema,
  stepActionSchema,
  storedScreenshotSchema,
  workflowSchema,
  workflowStatusSchema,
  workflowStepDraftSchema,
  workflowStepPatchSchema,
  workflowStepSchema
} from "./schemas.js";

export type WorkflowStatus = z.infer<typeof workflowStatusSchema>;
export type StepAction = z.infer<typeof stepActionSchema>;
export type Workflow = z.infer<typeof workflowSchema>;
export type WorkflowStep = z.infer<typeof workflowStepSchema>;
export type StoredScreenshot = z.infer<typeof storedScreenshotSchema>;
export type RootStorage = z.infer<typeof rootStorageSchema>;
export type WorkflowStepDraft = z.infer<typeof workflowStepDraftSchema>;
export type WorkflowStepPatch = z.infer<typeof workflowStepPatchSchema>;
