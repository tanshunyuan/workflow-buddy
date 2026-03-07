import { extensionMessageSchema, type ExtensionMessage } from "../shared/messages.js";
import { createClickStepFromHtml } from "./captureClick.js";
import { cacheStartingValue, createTypeStep } from "./captureType.js";
import { getCapturedElementHtml, resolveClickCaptureElement } from "./dom.js";

declare global {
  interface Window {
    __workflowBuddyRecorderRegistered__?: boolean;
  }
}

let isCaptureEnabled = false;
let activeWorkflowId: string | null = null;
const fieldValueCache = new WeakMap<Element, string>();
const clickAggregationWindowMs = 100;
const repeatedClickSuppressionWindowMs = 400;
let pendingClickCapture:
  | {
      captureHtml: string;
      captureKey: string;
      detail: number;
      startedAt: number;
      timeoutId: number;
    }
  | null = null;
let lastDispatchedClick:
  | {
      captureKey: string;
      detail: number;
      dispatchedAt: number;
    }
  | null = null;

async function sendCapturedStep(message: ExtensionMessage): Promise<void> {
  await chrome.runtime.sendMessage(message);
}

function clearPendingClickCapture(): void {
  if (!pendingClickCapture) return;
  window.clearTimeout(pendingClickCapture.timeoutId);
  pendingClickCapture = null;
}

function flushPendingClickCapture(): void {
  if (!pendingClickCapture || !isCaptureEnabled || !activeWorkflowId) {
    clearPendingClickCapture();
    return;
  }

  const { captureHtml, captureKey, detail, startedAt } = pendingClickCapture;
  const step = createClickStepFromHtml(captureHtml);
  clearPendingClickCapture();
  if (!step) return;

  if (
    lastDispatchedClick &&
    lastDispatchedClick.captureKey === captureKey &&
    lastDispatchedClick.detail === detail &&
    startedAt - lastDispatchedClick.dispatchedAt <= repeatedClickSuppressionWindowMs
  ) {
    return;
  }

  lastDispatchedClick = {
    captureKey,
    detail,
    dispatchedAt: startedAt
  };

  void sendCapturedStep({
    type: "STEP_CAPTURED",
    workflowId: activeWorkflowId,
    step
  });
}

function handleClick(event: MouseEvent): void {
  if (!isCaptureEnabled || !activeWorkflowId) return;
  const captureElement = resolveClickCaptureElement(event);
  if (!captureElement) return;

  const captureHtml = getCapturedElementHtml(captureElement);
  const captureKey = captureHtml;
  if (
    lastDispatchedClick &&
    lastDispatchedClick.captureKey === captureKey &&
    lastDispatchedClick.detail === event.detail &&
    event.timeStamp - lastDispatchedClick.dispatchedAt <= repeatedClickSuppressionWindowMs
  ) {
    return;
  }

  if (
    pendingClickCapture &&
    pendingClickCapture.detail === event.detail &&
    event.timeStamp - pendingClickCapture.startedAt <= clickAggregationWindowMs
  ) {
    window.clearTimeout(pendingClickCapture.timeoutId);
    pendingClickCapture = {
      ...pendingClickCapture,
      captureHtml,
      captureKey,
      timeoutId: window.setTimeout(flushPendingClickCapture, clickAggregationWindowMs)
    };
    return;
  }

  flushPendingClickCapture();
  pendingClickCapture = {
    captureHtml,
    captureKey,
    detail: event.detail,
    startedAt: event.timeStamp,
    timeoutId: window.setTimeout(flushPendingClickCapture, clickAggregationWindowMs)
  };
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

if (!window.__workflowBuddyRecorderRegistered__) {
  window.__workflowBuddyRecorderRegistered__ = true;

  document.addEventListener("click", handleClick, true);
  document.addEventListener("focusin", handleFocusIn, true);
  document.addEventListener("blur", handleBlur, true);

  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    const parsed = extensionMessageSchema.safeParse(message);
    if (!parsed.success) return;

    if (parsed.data.type === "PING") {
      sendResponse({ ok: true });
      return;
    }

    if (parsed.data.type === "ENABLE_CAPTURE") {
      isCaptureEnabled = true;
      activeWorkflowId = parsed.data.workflowId;
      clearPendingClickCapture();
      lastDispatchedClick = null;
    }

    if (parsed.data.type === "DISABLE_CAPTURE") {
      flushPendingClickCapture();
      isCaptureEnabled = false;
      activeWorkflowId = null;
      clearPendingClickCapture();
      lastDispatchedClick = null;
    }
  });
}
