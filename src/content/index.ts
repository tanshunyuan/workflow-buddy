import { extensionMessageSchema, type ExtensionMessage } from "../shared/messages.js";
import { createClickStep } from "./captureClick.js";
import { cacheStartingValue, createTypeStep } from "./captureType.js";

let isCaptureEnabled = false;
let activeWorkflowId: string | null = null;
const fieldValueCache = new WeakMap<Element, string>();

async function sendCapturedStep(message: ExtensionMessage): Promise<void> {
  await chrome.runtime.sendMessage(message);
}

function handleClick(event: MouseEvent): void {
  if (!isCaptureEnabled || !activeWorkflowId) return;
  const step = createClickStep(event.target);
  if (!step) return;

  void sendCapturedStep({
    type: "STEP_CAPTURED",
    workflowId: activeWorkflowId,
    step
  });
}

function handleFocusIn(event: FocusEvent): void {
  if (!isCaptureEnabled) return;
  cacheStartingValue(fieldValueCache, event.target);
}

function handleBlur(event: FocusEvent): void {
  if (!isCaptureEnabled || !activeWorkflowId) return;
  const step = createTypeStep(fieldValueCache, event.target);
  if (!step) return;

  void sendCapturedStep({
    type: "STEP_CAPTURED",
    workflowId: activeWorkflowId,
    step
  });
}

document.addEventListener("click", handleClick, true);
document.addEventListener("focusin", handleFocusIn, true);
document.addEventListener("blur", handleBlur, true);

chrome.runtime.onMessage.addListener((message: unknown) => {
  const parsed = extensionMessageSchema.safeParse(message);
  if (!parsed.success) return;

  if (parsed.data.type === "ENABLE_CAPTURE") {
    isCaptureEnabled = true;
    activeWorkflowId = parsed.data.workflowId;
  }

  if (parsed.data.type === "DISABLE_CAPTURE") {
    isCaptureEnabled = false;
    activeWorkflowId = null;
  }
});
