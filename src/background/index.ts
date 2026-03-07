import { extensionMessageSchema } from "../shared/messages.js";
import { appendStep, attachScreenshot, createWorkflow, getState, startRecording, stopRecording, updateStep } from "./storage.js";
import { exportWorkflowToMarkdown } from "./exportMarkdown.js";

async function configureSidePanelBehavior(): Promise<void> {
  if (!chrome.sidePanel?.setPanelBehavior) return;

  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
}

async function sendMessageToTab(tabId: number, message: unknown): Promise<void> {
  await chrome.tabs.sendMessage(tabId, message);
}

async function exportWorkflow(workflowId: string): Promise<void> {
  const state = await getState();
  const workflow = state.workflowsById[workflowId];
  if (!workflow) return;

  const markdown = exportWorkflowToMarkdown(workflow, state.screenshotsById);
  const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown" }));

  await chrome.downloads.download({
    url,
    filename: `${workflow.name || "workflow"}.md`,
    saveAs: true
  });
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
      case "START_RECORDING": {
        const workflow = await startRecording(safeMessage.workflowId, safeMessage.tabId);
        if (workflow) {
          await sendMessageToTab(safeMessage.tabId, { type: "ENABLE_CAPTURE", workflowId: workflow.id });
        }
        sendResponse(workflow);
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
        await exportWorkflow(safeMessage.workflowId);
        sendResponse({ ok: true });
        return;
      }
    }
  })();

  return true;
});
