import { z } from "zod";
import { storedScreenshotSchema, workflowStepDraftSchema, workflowStepPatchSchema } from "./schemas.js";

export const extensionMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("GET_STATE") }),
  z.object({ type: z.literal("PING") }),
  z.object({ type: z.literal("CREATE_WORKFLOW"), name: z.string().min(1) }),
  z.object({ type: z.literal("CLEAR_CURRENT_WORKFLOW") }),
  z.object({ type: z.literal("DELETE_WORKFLOW"), workflowId: z.string() }),
  z.object({ type: z.literal("DELETE_STEP"), workflowId: z.string(), stepId: z.string() }),
  z.object({ type: z.literal("START_RECORDING"), workflowId: z.string(), tabId: z.number().int() }),
  z.object({ type: z.literal("PAUSE_RECORDING"), workflowId: z.string() }),
  z.object({ type: z.literal("FINISH_RECORDING"), workflowId: z.string() }),
  z.object({ type: z.literal("ENABLE_CAPTURE"), workflowId: z.string() }),
  z.object({ type: z.literal("DISABLE_CAPTURE") }),
  z.object({ type: z.literal("STEP_CAPTURED"), workflowId: z.string(), step: workflowStepDraftSchema }),
  z.object({ type: z.literal("UPDATE_STEP"), workflowId: z.string(), stepId: z.string(), patch: workflowStepPatchSchema }),
  z.object({ type: z.literal("CAPTURE_SCREENSHOT"), workflowId: z.string(), stepId: z.string(), tabId: z.number().int() }),
  z.object({ type: z.literal("START_SCREENSHOT_ASSIST"), workflowId: z.string(), stepId: z.string(), tabId: z.number().int() }),
  z.object({ type: z.literal("BEGIN_SCREENSHOT_ASSIST") }),
  z.object({ type: z.literal("ATTACH_SCREENSHOT"), workflowId: z.string(), stepId: z.string(), screenshot: storedScreenshotSchema }),
  z.object({ type: z.literal("DETACH_SCREENSHOT"), workflowId: z.string(), stepId: z.string() }),
  z.object({ type: z.literal("EXPORT_WORKFLOW"), workflowId: z.string() })
]);

export type ExtensionMessage = z.infer<typeof extensionMessageSchema>;
