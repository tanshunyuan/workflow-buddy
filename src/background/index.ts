import { createId } from "../shared/ids.js";
import { extensionMessageSchema } from "../shared/messages.js";
import { storedScreenshotSchema } from "../shared/schemas.js";
import { nowIso } from "../shared/time.js";
import {
  appendStep,
  attachScreenshot,
  clearCurrentWorkflow,
  createWorkflow,
  detachScreenshot,
  deleteStep,
  deleteWorkflow,
  getState,
  startRecording,
  stopRecording,
  updateStep
} from "./storage.js";
import { exportWorkflowToMarkdown } from "./exportMarkdown.js";
import {
  getRecordingSessionSnapshot,
  sendRecordingSessionEvent,
  syncRecordingSessionActor
} from "./recordingSessionMachine.js";

async function configureSidePanelBehavior(): Promise<void> {
  if (!chrome.sidePanel?.setPanelBehavior) return;

  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
}

async function sendMessageToTab(tabId: number, message: unknown): Promise<void> {
  await chrome.tabs.sendMessage(tabId, message);
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

function toSafeFileSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "workflow";
}

function buildScreenshotName(workflowName: string, stepIndex: number): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${toSafeFileSegment(workflowName)}-step-${String(stepIndex).padStart(2, "0")}-${stamp}.png`;
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

async function exportWorkflow(workflowId: string): Promise<void> {
  const state = await getState();
  const workflow = state.workflowsById[workflowId];
  if (!workflow) {
    throw new Error("Workflow not found.");
  }

  const markdown = exportWorkflowToMarkdown(workflow, state.screenshotsById);
  const safeFilename = `${(workflow.name || "workflow").replace(/[\\/:*?"<>|]/g, "-")}.md`;
  const url = `data:text/markdown;charset=utf-8,${encodeURIComponent(markdown)}`;

  const downloadId = await chrome.downloads.download({
    url,
    filename: safeFilename,
    saveAs: true
  });

  if (typeof downloadId !== "number") {
    throw new Error("Chrome did not start the download.");
  }
}

function canStartRecording(): boolean {
  const snapshot = getRecordingSessionSnapshot();
  return (
    snapshot.matches("draft") ||
    snapshot.matches("completedEmpty") ||
    snapshot.matches("completedReady")
  );
}

function canStopRecording(): boolean {
  return getRecordingSessionSnapshot().matches("recording");
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
          sendResponse({ ok: false, error: "Recording can only start from a draft or completed workflow." });
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
      case "STOP_RECORDING": {
        if (!canStopRecording()) {
          sendResponse({ ok: false, error: "No recording session is active." });
          return;
        }

        sendRecordingSessionEvent({ type: "STOP_REQUEST" });
        const workflow = await stopRecording(safeMessage.workflowId);
        if (workflow?.tabId !== undefined) {
          await sendMessageToTab(workflow.tabId, { type: "DISABLE_CAPTURE" });
        }
        if (workflow) {
          sendRecordingSessionEvent({ type: "STOP_SUCCESS", stepCount: workflow.steps.length });
        } else {
          sendRecordingSessionEvent({ type: "STOP_FAILURE", error: "Workflow not found." });
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
          await exportWorkflow(safeMessage.workflowId);
          const nextState = await clearCurrentWorkflow();
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
