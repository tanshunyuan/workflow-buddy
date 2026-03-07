import { nowIso } from "../shared/time.js";
import { workflowStepDraftSchema } from "../shared/schemas.js";
import type { WorkflowStepDraft } from "../shared/types.js";
import { getElementHtml, isElement } from "./dom.js";

export function createClickStep(target: EventTarget | null): WorkflowStepDraft | null {
  if (!isElement(target)) return null;

  return workflowStepDraftSchema.parse({
    action: "click",
    timestamp: nowIso(),
    pageUrl: window.location.href,
    elementHtml: getElementHtml(target)
  });
}
