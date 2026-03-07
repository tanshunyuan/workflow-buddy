import { extensionMessageSchema } from "../shared/messages.js";
import {
  appendStep,
  attachScreenshot,
  clearCurrentWorkflow,
  createWorkflow,
  deleteWorkflow,
  getState,
  startRecording,
  stopRecording,
  updateStep
} from "./storage.js";
import { exportWorkflowToMarkdown } from "./exportMarkdown.js";

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
    const parsed = extensionMessageSchema.safeParse(message);
    if (!parsed.success) {
      sendResponse({ error: "Invalid message payload" });
      return;
    }

    const safeMessage = parsed.data;

    switch (safeMessage.type) {
      case "GET_STATE": {
        sendResponse(await getState());
        return;
      }
      case "CREATE_WORKFLOW": {
        sendResponse(await createWorkflow(safeMessage.name));
        return;
      }
      case "CLEAR_CURRENT_WORKFLOW": {
        sendResponse(await clearCurrentWorkflow());
        return;
      }
      case "DELETE_WORKFLOW": {
        sendResponse(await deleteWorkflow(safeMessage.workflowId));
        return;
      }
      case "START_RECORDING": {
        const readiness = await ensureContentScriptReady(safeMessage.tabId);
        if (!readiness.ok) {
          sendResponse(readiness);
          return;
        }

        const workflow = await startRecording(safeMessage.workflowId, safeMessage.tabId);
        if (workflow) {
          await sendMessageToTab(safeMessage.tabId, { type: "ENABLE_CAPTURE", workflowId: workflow.id });
          sendResponse({ ok: true, workflow });
          return;
        }
        sendResponse({ ok: false, error: "Workflow not found." });
        return;
      }
      case "STOP_RECORDING": {
        const workflow = await stopRecording(safeMessage.workflowId);
        if (workflow?.tabId !== undefined) {
          await sendMessageToTab(workflow.tabId, { type: "DISABLE_CAPTURE" });
        }
        sendResponse(workflow);
        return;
      }
      case "STEP_CAPTURED": {
        sendResponse(await appendStep(safeMessage.workflowId, safeMessage.step));
        return;
      }
      case "UPDATE_STEP": {
        sendResponse(await updateStep(safeMessage.workflowId, safeMessage.stepId, safeMessage.patch));
        return;
      }
      case "ATTACH_SCREENSHOT": {
        sendResponse(await attachScreenshot(safeMessage.workflowId, safeMessage.stepId, safeMessage.screenshot));
        return;
      }
      case "EXPORT_WORKFLOW": {
        try {
          await exportWorkflow(safeMessage.workflowId);
          await clearCurrentWorkflow();
          sendResponse({ ok: true });
        } catch (error) {
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
