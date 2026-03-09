import { extensionMessageSchema, type ExtensionMessage } from "../shared/messages.js";
import { createClickStepFromHtml } from "./captureClick.js";
import { cacheStartingValue, createTypeStep } from "./captureType.js";
import {
  getBlockedInteractiveElement,
  getCapturedElementHtml,
  getClickFingerprint,
  getElementLabel,
  isWorkflowBuddyUiElement,
  resolveClickCaptureElementAtPoint,
  resolveClickCaptureElement
} from "./dom.js";
import { hideInlineAnnotationEditor, isInlineAnnotationEditorOpen, isInlineAnnotationEvent, showInlineAnnotationEditor } from "./inlineAnnotation.js";
import type { WorkflowStep } from "../shared/types.js";

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
      targetLabel: string;
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
let pendingAnnotationStepId: string | null = null;

async function sendCapturedStep(message: ExtensionMessage): Promise<WorkflowStep | null> {
  const response = await chrome.runtime.sendMessage(message);
  return response as WorkflowStep | null;
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

  const { captureKey, clientX, clientY, captureElement, targetLabel, detail, startedAt } = pendingClickCapture;
  clearPendingClickCapture();

  await waitForSettledClickState();

  const settledCaptureElement = resolveSettledCaptureElement(clientX, clientY, captureElement) ?? captureElement;
  const captureHtml = getCapturedElementHtml(settledCaptureElement);
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

  const createdStep = await sendCapturedStep({
    type: "STEP_CAPTURED",
    workflowId: activeWorkflowId,
    step
  });

  const anchorElement = document.contains(settledCaptureElement)
    ? settledCaptureElement
    : document.contains(captureElement)
      ? captureElement
      : null;

  if (!createdStep || createdStep.action !== "click" || !anchorElement) {
    return;
  }

  pendingAnnotationStepId = createdStep.id;
  showInlineAnnotationEditor({
    targetLabel,
    anchorElement,
    onSave: async (description) => {
      if (!activeWorkflowId || !pendingAnnotationStepId) return;

      await chrome.runtime.sendMessage({
        type: "UPDATE_STEP",
        workflowId: activeWorkflowId,
        stepId: pendingAnnotationStepId,
        patch: { description }
      } satisfies ExtensionMessage);
      pendingAnnotationStepId = null;
    },
    onCancel: () => {
      pendingAnnotationStepId = null;
    }
  });
}

function scheduleFlushPendingClickCapture(): void {
  void flushPendingClickCapture();
}

function shouldBlockInteraction(event: Event): boolean {
  if (!isInlineAnnotationEditorOpen()) return false;
  if (isInlineAnnotationEvent(event)) return false;
  return getBlockedInteractiveElement(event.target) !== null;
}

function handlePointerDown(event: PointerEvent): void {
  if (!shouldBlockInteraction(event)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}

function handleClick(event: MouseEvent): void {
  if (isInlineAnnotationEvent(event) || isWorkflowBuddyUiElement(event.target)) {
    return;
  }

  if (isInlineAnnotationEditorOpen() && !isInlineAnnotationEvent(event)) {
    if (getBlockedInteractiveElement(event.target)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    return;
  }

  if (!isCaptureEnabled || !activeWorkflowId) return;
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
      targetLabel: getElementLabel(captureElement),
      timeoutId: window.setTimeout(scheduleFlushPendingClickCapture, clickAggregationWindowMs)
    };
    return;
  }

  void flushPendingClickCapture();
  pendingClickCapture = {
    captureKey,
    clientX: event.clientX,
    clientY: event.clientY,
    captureElement,
    targetLabel: getElementLabel(captureElement),
    detail: event.detail,
    startedAt: event.timeStamp,
    timeoutId: window.setTimeout(scheduleFlushPendingClickCapture, clickAggregationWindowMs)
  };
}

function handleFocusIn(event: FocusEvent): void {
  if (!isCaptureEnabled) return;
  if (isInlineAnnotationEvent(event) || isWorkflowBuddyUiElement(event.target)) return;
  cacheStartingValue(fieldValueCache, event.target);
}

function handleBlur(event: FocusEvent): void {
  if (!isCaptureEnabled || !activeWorkflowId) return;
  if (isInlineAnnotationEvent(event) || isWorkflowBuddyUiElement(event.target)) return;
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

  document.addEventListener("pointerdown", handlePointerDown, true);
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
      pendingAnnotationStepId = null;
      hideInlineAnnotationEditor();
    }

    if (parsed.data.type === "DISABLE_CAPTURE") {
      void flushPendingClickCapture();
      isCaptureEnabled = false;
      activeWorkflowId = null;
      clearPendingClickCapture();
      lastDispatchedClick = null;
      pendingAnnotationStepId = null;
      hideInlineAnnotationEditor();
    }
  });
}
