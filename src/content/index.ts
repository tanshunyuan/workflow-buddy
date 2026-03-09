import { extensionMessageSchema, type ExtensionMessage } from "../shared/messages.js";
import { createClickStepFromHtml } from "./captureClick.js";
import { cacheStartingValue, createTypeStep } from "./captureType.js";
import {
  getCapturedElementHtml,
  getClickFingerprint,
  isSameClickCaptureTarget,
  resolveClickCaptureElementAtPoint,
  resolveClickCaptureElement
} from "./dom.js";
import { beginScreenshotAssist, cancelScreenshotAssist, isScreenshotAssistActive } from "./screenshotAssist.js";

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
      captureKey: string;
      clientX: number;
      clientY: number;
      captureElement: Element;
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

function waitForNextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

async function waitForSettledClickState(): Promise<void> {
  await waitForNextAnimationFrame();
  await waitForNextAnimationFrame();
}

function resolveSettledCaptureElement(
  clientX: number,
  clientY: number,
  fallbackElement: Element
): Element | null {
  const settledCaptureElement = resolveClickCaptureElementAtPoint(clientX, clientY);
  if (settledCaptureElement) {
    return settledCaptureElement;
  }

  if (document.contains(fallbackElement)) {
    return fallbackElement;
  }

  return null;
}

async function flushPendingClickCapture(): Promise<void> {
  if (!pendingClickCapture || !isCaptureEnabled || !activeWorkflowId) {
    clearPendingClickCapture();
    return;
  }

  const workflowId = activeWorkflowId;
  const { captureKey, clientX, clientY, captureElement, detail, startedAt } = pendingClickCapture;
  clearPendingClickCapture();

  await waitForSettledClickState();

  if (!isCaptureEnabled || activeWorkflowId !== workflowId) {
    return;
  }

  const settledCaptureElement = resolveSettledCaptureElement(clientX, clientY, captureElement);
  const finalCaptureElement =
    settledCaptureElement && isSameClickCaptureTarget(captureElement, settledCaptureElement)
      ? settledCaptureElement
      : captureElement;
  const captureHtml = getCapturedElementHtml(finalCaptureElement);
  const step = createClickStepFromHtml(captureHtml, captureKey);
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

  await sendCapturedStep({
    type: "STEP_CAPTURED",
    workflowId,
    step
  });
}

function handleClick(event: MouseEvent): void {
  if (isScreenshotAssistActive() || !isCaptureEnabled || !activeWorkflowId) return;
  const captureElement = resolveClickCaptureElement(event);
  if (!captureElement) return;

  const captureKey = getClickFingerprint(captureElement);
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
      captureKey,
      clientX: event.clientX,
      clientY: event.clientY,
      captureElement,
      timeoutId: window.setTimeout(() => void flushPendingClickCapture(), clickAggregationWindowMs)
    };
    return;
  }

  void flushPendingClickCapture();
  pendingClickCapture = {
    captureKey,
    clientX: event.clientX,
    clientY: event.clientY,
    captureElement,
    detail: event.detail,
    startedAt: event.timeStamp,
    timeoutId: window.setTimeout(() => void flushPendingClickCapture(), clickAggregationWindowMs)
  };
}

function handleFocusIn(event: FocusEvent): void {
  if (isScreenshotAssistActive() || !isCaptureEnabled) return;
  cacheStartingValue(fieldValueCache, event.target);
}

function handleBlur(event: FocusEvent): void {
  if (isScreenshotAssistActive() || !isCaptureEnabled || !activeWorkflowId) return;
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
      void flushPendingClickCapture();
      cancelScreenshotAssist("Screenshot capture canceled because recording stopped.");
      isCaptureEnabled = false;
      activeWorkflowId = null;
      clearPendingClickCapture();
      lastDispatchedClick = null;
    }

    if (parsed.data.type === "BEGIN_SCREENSHOT_ASSIST") {
      void beginScreenshotAssist().then(sendResponse);
      return true;
    }
  });
}
