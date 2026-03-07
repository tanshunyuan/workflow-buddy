import { nowIso } from "../shared/time.js";
import { workflowStepDraftSchema } from "../shared/schemas.js";
import type { WorkflowStepDraft } from "../shared/types.js";
import { getElementHtml, getFieldValue, isPasswordInput, isTextEntryTarget } from "./dom.js";

export function cacheStartingValue(cache: WeakMap<Element, string>, target: EventTarget | null): void {
  if (!isTextEntryTarget(target) || isPasswordInput(target)) return;
  cache.set(target, getFieldValue(target));
}

export function createTypeStep(
  cache: WeakMap<Element, string>,
  target: EventTarget | null
): WorkflowStepDraft | null {
  if (!isTextEntryTarget(target) || isPasswordInput(target)) return null;

  const before = cache.get(target) ?? "";
  const after = getFieldValue(target);
  if (before === after) return null;

  cache.set(target, after);

  return workflowStepDraftSchema.parse({
    action: "type",
    timestamp: nowIso(),
    pageUrl: window.location.href,
    elementHtml: getElementHtml(target),
    typedValue: after
  });
}
