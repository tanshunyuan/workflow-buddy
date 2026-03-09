import { createId } from "../shared/ids.js";
import { extensionMessageSchema } from "../shared/messages.js";
import { screenshotAssistResponseSchema, storedScreenshotSchema } from "../shared/schemas.js";
import { nowIso } from "../shared/time.js";
import type { ExportFormat, ScreenshotAssistResponse } from "../shared/types.js";
import {
  appendStep,
  attachScreenshot,
  clearCurrentWorkflow,
  createWorkflow,
  detachScreenshot,
  deleteStep,
  deleteWorkflow,
  finishRecording,
  getState,
  pauseRecording,
  startRecording,
  updateStep
} from "./storage.js";
import { cropScreenshotDataUrl } from "./cropScreenshot.js";
import {
  getRecordingSessionSnapshot,
  sendRecordingSessionEvent,
  syncRecordingSessionActor
} from "./recordingSessionMachine.js";
import { getWorkflowExporter } from "./export/getWorkflowExporter.js";

async function configureSidePanelBehavior(): Promise<void> {
  if (!chrome.sidePanel?.setPanelBehavior) return;

  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
}

async function sendMessageToTab(tabId: number, message: unknown): Promise<void> {
  await chrome.tabs.sendMessage(tabId, message);
}

async function requestMessageFromTab<T>(tabId: number, message: unknown): Promise<T> {
  return chrome.tabs.sendMessage(tabId, message) as Promise<T>;
}

async function waitForNextAnimationFrameInTab(tabId: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () =>
        new Promise<void>((resolve) => {
          window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => resolve());
          });
        })
    });
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function pingContentScript(tabId: number): Promise<boolean> {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: "PING" });
    return response?.ok === true;
  } catch {
    return false;
  }
}

async function ensureContentScriptReady(tabId: number): Promise<{ ok: true } | { ok: false; error: string }> {
  if (await pingContentScript(tabId)) {
    return { ok: true };
  }

  const files = chrome.runtime.getManifest().content_scripts?.[0]?.js;
  if (!files?.length) {
    return { ok: false, error: "Recorder script is missing from the extension bundle." };
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files
    });
  } catch {
    return {
      ok: false,
      error: "This page cannot be recorded automatically. Try a standard website tab instead."
    };
  }

  if (await pingContentScript(tabId)) {
    return { ok: true };
  }

  return {
    ok: false,
    error: "The recorder could not attach to this tab. Refresh the page and try again."
  };
}

function buildScreenshotName(workflowName: string, stepIndex: number): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${workflowName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "workflow"}-step-${String(stepIndex).padStart(2, "0")}-${stamp}.png`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";

  for (let index = 0; index < bytes.length; index += 0x8000) {
    const chunk = bytes.subarray(index, index + 0x8000);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

function bytesToDataUrl(bytes: Uint8Array, mimeType: string): string {
  return `data:${mimeType};base64,${bytesToBase64(bytes)}`;
}

async function captureScreenshotForStep(
  workflowId: string,
  stepId: string,
  tabId: number
): Promise<{ ok: true } | { ok: false; error: string }> {
  const state = await getState();
  const workflow = state.workflowsById[workflowId];
  if (!workflow) {
    return { ok: false, error: "Workflow not found." };
  }

  const step = workflow.steps.find((item) => item.id === stepId);
  if (!step) {
    return { ok: false, error: "Step not found." };
  }

  if (workflow.tabId != null && workflow.tabId !== tabId) {
    return {
      ok: false,
      error: "Switch back to the recorded tab before capturing a screenshot."
    };
  }

  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    return { ok: false, error: "The recorded tab is no longer available." };
  }

  if (!tab.active) {
    return {
      ok: false,
      error: "Activate the recorded tab before capturing a screenshot."
    };
  }

  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    const screenshot = storedScreenshotSchema.parse({
      id: createId("shot"),
      name: buildScreenshotName(workflow.name, step.index),
      mimeType: "image/png",
      dataUrl,
      createdAt: nowIso()
    });

    const attachedStep = await attachScreenshot(workflowId, stepId, screenshot);
    if (!attachedStep) {
      return { ok: false, error: "Screenshot could not be attached." };
    }

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Screenshot capture failed."
    };
  }
}

async function startScreenshotAssistForStep(
  workflowId: string,
  stepId: string,
  tabId: number
): Promise<{ ok: true } | { ok: false; error: string; canceled?: boolean }> {
  const state = await getState();
  const workflow = state.workflowsById[workflowId];
  if (!workflow) {
    return { ok: false, error: "Workflow not found." };
  }

  const step = workflow.steps.find((item) => item.id === stepId);
  if (!step) {
    return { ok: false, error: "Step not found." };
  }

  if (workflow.tabId != null && workflow.tabId !== tabId) {
    return {
      ok: false,
      error: "Switch back to the recorded tab before capturing a screenshot."
    };
  }

  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    return { ok: false, error: "The recorded tab is no longer available." };
  }

  if (!tab.active) {
    return {
      ok: false,
      error: "Activate the recorded tab before capturing a screenshot."
    };
  }

  const readiness = await ensureContentScriptReady(tabId);
  if (!readiness.ok) {
    return readiness;
  }

  let assistResponse: ScreenshotAssistResponse;
  try {
    const rawResponse = await requestMessageFromTab<unknown>(tabId, { type: "BEGIN_SCREENSHOT_ASSIST" });
    assistResponse = screenshotAssistResponseSchema.parse(rawResponse);
  } catch {
    return {
      ok: false,
      error: "The screenshot selection overlay could not start in this tab."
    };
  }

  if (!assistResponse.ok) {
    return assistResponse;
  }

  try {
    await waitForNextAnimationFrameInTab(tabId);
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    const croppedDataUrl = await cropScreenshotDataUrl(dataUrl, assistResponse.selection);
    const screenshot = storedScreenshotSchema.parse({
      id: createId("shot"),
      name: buildScreenshotName(workflow.name, step.index),
      mimeType: "image/png",
      dataUrl: croppedDataUrl,
      createdAt: nowIso()
    });

    const attachedStep = await attachScreenshot(workflowId, stepId, screenshot);
    if (!attachedStep) {
      return { ok: false, error: "Screenshot could not be attached." };
    }

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Screenshot capture failed."
    };
  }
}

async function exportWorkflow(workflowId: string, format: ExportFormat): Promise<void> {
  const state = await getState();
  const workflow = state.workflowsById[workflowId];
  if (!workflow) {
    throw new Error("Workflow not found.");
  }

  const exporter = getWorkflowExporter(format);
  const artifact = await exporter.export(workflow, state.screenshotsById);
  const url = bytesToDataUrl(artifact.bytes, artifact.mimeType);

  const downloadId = await chrome.downloads.download({
    url,
    filename: artifact.filename,
    saveAs: true
  });

  if (typeof downloadId !== "number") {
    throw new Error("Chrome did not start the download.");
  }
}

function canStartRecording(): boolean {
  const snapshot = getRecordingSessionSnapshot();
  return snapshot.matches("draft") || snapshot.matches("paused");
}

function canPauseRecording(): boolean {
  return getRecordingSessionSnapshot().matches("recording");
}

function canFinishRecording(): boolean {
  const snapshot = getRecordingSessionSnapshot();
  return snapshot.matches("recording") || snapshot.matches("paused");
}

function canExportWorkflow(): boolean {
  return getRecordingSessionSnapshot().matches("completedReady");
}

async function readAndSyncStorageState() {
  const state = await getState();
  syncRecordingSessionActor(state);
  return state;
}

void configureSidePanelBehavior();

chrome.runtime.onInstalled.addListener(() => {
  void configureSidePanelBehavior();
});

chrome.runtime.onStartup.addListener(() => {
  void configureSidePanelBehavior();
});

chrome.runtime.onMessage.addListener((
  message: unknown,
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void
) => {
  void (async () => {
    const storageState = await readAndSyncStorageState();
    const parsed = extensionMessageSchema.safeParse(message);
    if (!parsed.success) {
      sendResponse({ error: "Invalid message payload" });
      return;
    }

    const safeMessage = parsed.data;

    switch (safeMessage.type) {
      case "GET_STATE": {
        sendResponse(storageState);
        return;
      }
      case "CREATE_WORKFLOW": {
        const workflow = await createWorkflow(safeMessage.name);
        sendRecordingSessionEvent({ type: "CREATE_WORKFLOW", workflowId: workflow.id });
        sendResponse(workflow);
        return;
      }
      case "CLEAR_CURRENT_WORKFLOW": {
        const nextState = await clearCurrentWorkflow();
        syncRecordingSessionActor(nextState);
        sendResponse(nextState);
        return;
      }
      case "DELETE_WORKFLOW": {
        const nextState = await deleteWorkflow(safeMessage.workflowId);
        syncRecordingSessionActor(nextState);
        sendResponse(nextState);
        return;
      }
      case "DELETE_STEP": {
        const workflow = await deleteStep(safeMessage.workflowId, safeMessage.stepId);
        if (!workflow) {
          sendResponse({ ok: false, error: "Workflow not found." });
          return;
        }

        const nextState = await getState();
        syncRecordingSessionActor(nextState);
        sendResponse({ ok: true, workflow });
        return;
      }
      case "START_RECORDING": {
        if (!canStartRecording()) {
          sendResponse({ ok: false, error: "Recording can only start from a draft or paused workflow." });
          return;
        }

        sendRecordingSessionEvent({ type: "START_REQUEST" });
        const readiness = await ensureContentScriptReady(safeMessage.tabId);
        if (!readiness.ok) {
          sendRecordingSessionEvent({ type: "START_FAILURE", error: readiness.error });
          sendResponse(readiness);
          return;
        }

        const workflow = await startRecording(safeMessage.workflowId, safeMessage.tabId);
        if (workflow) {
          await sendMessageToTab(safeMessage.tabId, { type: "ENABLE_CAPTURE", workflowId: workflow.id });
          sendRecordingSessionEvent({
            type: "START_SUCCESS",
            workflowId: workflow.id,
            tabId: safeMessage.tabId,
            stepCount: workflow.steps.length
          });
          sendResponse({ ok: true, workflow });
          return;
        }
        sendRecordingSessionEvent({ type: "START_FAILURE", error: "Workflow not found." });
        sendResponse({ ok: false, error: "Workflow not found." });
        return;
      }
      case "PAUSE_RECORDING": {
        if (!canPauseRecording()) {
          sendResponse({ ok: false, error: "Only an active recording can be paused." });
          return;
        }

        sendRecordingSessionEvent({ type: "PAUSE_REQUEST" });
        const workflow = await pauseRecording(safeMessage.workflowId);
        if (workflow?.tabId !== undefined) {
          await sendMessageToTab(workflow.tabId, { type: "DISABLE_CAPTURE" });
        }
        if (workflow) {
          sendRecordingSessionEvent({
            type: "PAUSE_SUCCESS",
            workflowId: workflow.id,
            stepCount: workflow.steps.length
          });
        } else {
          sendRecordingSessionEvent({ type: "PAUSE_FAILURE", error: "Workflow not found." });
        }
        sendResponse(workflow);
        return;
      }
      case "FINISH_RECORDING": {
        if (!canFinishRecording()) {
          sendResponse({ ok: false, error: "Only a recording in progress or paused session can be finished." });
          return;
        }

        sendRecordingSessionEvent({ type: "FINISH_REQUEST" });
        const workflow = await finishRecording(safeMessage.workflowId);
        if (workflow?.tabId !== undefined && storageState.activeRecordingTabId != null) {
          await sendMessageToTab(workflow.tabId, { type: "DISABLE_CAPTURE" });
        }
        if (workflow) {
          sendRecordingSessionEvent({ type: "FINISH_SUCCESS", stepCount: workflow.steps.length });
        } else {
          sendRecordingSessionEvent({ type: "FINISH_FAILURE", error: "Workflow not found." });
        }
        sendResponse(workflow);
        return;
      }
      case "STEP_CAPTURED": {
        const sessionSnapshot = getRecordingSessionSnapshot();
        if (
          !sessionSnapshot.matches("recording") ||
          sessionSnapshot.context.workflowId !== safeMessage.workflowId
        ) {
          sendResponse(null);
          return;
        }

        const step = await appendStep(safeMessage.workflowId, safeMessage.step);
        if (step) {
          sendRecordingSessionEvent({ type: "STEP_CAPTURED", workflowId: safeMessage.workflowId });
        } else {
          const nextState = await getState();
          syncRecordingSessionActor(nextState);
        }
        sendResponse(step);
        return;
      }
      case "UPDATE_STEP": {
        sendResponse(await updateStep(safeMessage.workflowId, safeMessage.stepId, safeMessage.patch));
        return;
      }
      case "CAPTURE_SCREENSHOT": {
        sendResponse(await captureScreenshotForStep(safeMessage.workflowId, safeMessage.stepId, safeMessage.tabId));
        return;
      }
      case "START_SCREENSHOT_ASSIST": {
        sendResponse(await startScreenshotAssistForStep(safeMessage.workflowId, safeMessage.stepId, safeMessage.tabId));
        return;
      }
      case "ATTACH_SCREENSHOT": {
        sendResponse(await attachScreenshot(safeMessage.workflowId, safeMessage.stepId, safeMessage.screenshot));
        return;
      }
      case "DETACH_SCREENSHOT": {
        sendResponse(await detachScreenshot(safeMessage.workflowId, safeMessage.stepId));
        return;
      }
      case "EXPORT_WORKFLOW": {
        if (!canExportWorkflow()) {
          sendResponse({ ok: false, error: "Only a completed workflow with recorded steps can be exported." });
          return;
        }

        sendRecordingSessionEvent({ type: "EXPORT_REQUEST" });
        try {
          await exportWorkflow(safeMessage.workflowId, safeMessage.format);
          const nextState = await deleteWorkflow(safeMessage.workflowId);
          syncRecordingSessionActor(nextState);
          sendRecordingSessionEvent({ type: "EXPORT_SUCCESS" });
          sendResponse({ ok: true });
        } catch (error) {
          sendRecordingSessionEvent({
            type: "EXPORT_FAILURE",
            error: error instanceof Error ? error.message : "Export failed."
          });
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : "Export failed."
          });
        }
        return;
      }
    }
  })();

  return true;
});
