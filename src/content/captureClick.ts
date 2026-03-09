import { nowIso } from "../shared/time.js";
import { workflowStepDraftSchema } from "../shared/schemas.js";
import type { WorkflowStepDraft } from "../shared/types.js";
import { getCapturedElementHtml, getClickCaptureElement, getClickFingerprint, isElement } from "./dom.js";

export function createClickStep(target: EventTarget | null): WorkflowStepDraft | null {
  if (!isElement(target)) return null;
  return createClickStepFromElement(getClickCaptureElement(target));
}

export function createClickStepFromElement(element: Element | null): WorkflowStepDraft | null {
  if (!element) return null;
  return createClickStepFromHtml(getCapturedElementHtml(element), getClickFingerprint(element));
}

export function createClickStepFromHtml(
  elementHtml: string | null,
  clickFingerprint?: string | null
): WorkflowStepDraft | null {
  if (!elementHtml) return null;

  return workflowStepDraftSchema.parse({
    action: "click",
    timestamp: nowIso(),
    pageUrl: window.location.href,
    elementHtml,
    clickFingerprint: clickFingerprint ?? undefined
  });
}
