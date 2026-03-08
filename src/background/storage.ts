import { createId } from "../shared/ids.js";
import { nowIso } from "../shared/time.js";
import { rootStorageSchema, storedScreenshotSchema, workflowSchema, workflowStepDraftSchema, workflowStepSchema } from "../shared/schemas.js";
import type { RootStorage, StoredScreenshot, Workflow, WorkflowStep, WorkflowStepDraft, WorkflowStepPatch } from "../shared/types.js";

const STORAGE_KEY = "workflowBuddyState";
const recentDuplicateClickWindowMs = 500;

interface HashableStepPayload {
  action: WorkflowStepDraft["action"];
  pageUrl: string;
  elementHtml: string;
  typedValue?: string;
}

async function hashStepPayload(payload: HashableStepPayload): Promise<string> {
  const encoded = new TextEncoder().encode(JSON.stringify(payload));
  const digest = await crypto.subtle.digest("SHA-256", encoded);

  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function parseTimestamp(timestamp: string): number | null {
  const value = Date.parse(timestamp);
  return Number.isNaN(value) ? null : value;
}

async function isRecentDuplicateClickStep(previousStep: WorkflowStep | undefined, nextStep: WorkflowStepDraft): Promise<boolean> {
  if (!previousStep || previousStep.action !== "click" || nextStep.action !== "click") {
    return false;
  }

  const previousTimestamp = parseTimestamp(previousStep.timestamp);
  const nextTimestamp = parseTimestamp(nextStep.timestamp);
  if (previousTimestamp == null || nextTimestamp == null) {
    return false;
  }

  if (Math.abs(nextTimestamp - previousTimestamp) > recentDuplicateClickWindowMs) {
    return false;
  }

  const [previousHash, nextHash] = await Promise.all([
    hashStepPayload({
      action: previousStep.action,
      pageUrl: previousStep.pageUrl,
      elementHtml: previousStep.elementHtml
    }),
    hashStepPayload({
      action: nextStep.action,
      pageUrl: nextStep.pageUrl,
      elementHtml: nextStep.elementHtml
    })
  ]);

  return previousHash === nextHash;
}

function createEmptyState(): RootStorage {
  return rootStorageSchema.parse({
    currentWorkflowId: null,
    workflowsById: {},
    screenshotsById: {},
    activeRecordingTabId: null
  });
}

export async function getState(): Promise<RootStorage> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return rootStorageSchema.parse(result[STORAGE_KEY] ?? createEmptyState());
}

export async function saveState(state: RootStorage): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: rootStorageSchema.parse(state) });
}

export async function createWorkflow(name: string): Promise<Workflow> {
  const state = await getState();
  const timestamp = nowIso();
  const workflow = workflowSchema.parse({
    id: createId("wf"),
    name: name.trim(),
    status: "draft",
    createdAt: timestamp,
    updatedAt: timestamp,
    steps: []
  });

  state.currentWorkflowId = workflow.id;
  state.workflowsById[workflow.id] = workflow;
  await saveState(state);
  return workflow;
}

export async function clearCurrentWorkflow(): Promise<RootStorage> {
  const state = await getState();
  state.currentWorkflowId = null;
  state.activeRecordingTabId = null;
  await saveState(state);
  return state;
}

export async function deleteWorkflow(workflowId: string): Promise<RootStorage> {
  const state = await getState();
  const workflow = state.workflowsById[workflowId];

  if (!workflow) {
    return state;
  }

  if (state.currentWorkflowId === workflowId) {
    state.currentWorkflowId = null;
  }

  if (state.activeRecordingTabId != null && workflow.tabId === state.activeRecordingTabId) {
    state.activeRecordingTabId = null;
  }

  delete state.workflowsById[workflowId];
  await saveState(state);
  return state;
}

export async function deleteStep(workflowId: string, stepId: string): Promise<Workflow | null> {
  const state = await getState();
  const workflow = state.workflowsById[workflowId];
  if (!workflow) return null;

  const stepIndex = workflow.steps.findIndex((item) => item.id === stepId);
  if (stepIndex === -1) return workflow;

  const [removedStep] = workflow.steps.splice(stepIndex, 1);
  if (removedStep?.screenshotId) {
    delete state.screenshotsById[removedStep.screenshotId];
  }

  workflow.steps = workflow.steps.map((step, index) => ({
    ...step,
    index: index + 1
  }));
  workflow.updatedAt = nowIso();
  await saveState(state);
  return workflow;
}

export async function startRecording(workflowId: string, tabId: number): Promise<Workflow | null> {
  const state = await getState();
  const workflow = state.workflowsById[workflowId];
  if (!workflow) return null;

  workflow.status = "recording";
  workflow.tabId = tabId;
  workflow.updatedAt = nowIso();
  state.currentWorkflowId = workflowId;
  state.activeRecordingTabId = tabId;
  await saveState(state);
  return workflow;
}

export async function stopRecording(workflowId: string): Promise<Workflow | null> {
  const state = await getState();
  const workflow = state.workflowsById[workflowId];
  if (!workflow) return null;

  workflow.status = "completed";
  workflow.updatedAt = nowIso();
  state.activeRecordingTabId = null;
  await saveState(state);
  return workflow;
}

export async function appendStep(workflowId: string, draft: WorkflowStepDraft): Promise<WorkflowStep | null> {
  const state = await getState();
  const workflow = state.workflowsById[workflowId];
  if (!workflow) return null;

  const safeDraft = workflowStepDraftSchema.parse(draft);
  if (await isRecentDuplicateClickStep(workflow.steps.at(-1), safeDraft)) {
    return null;
  }

  const step = workflowStepSchema.parse({
    id: createId("step"),
    index: workflow.steps.length + 1,
    action: safeDraft.action,
    timestamp: safeDraft.timestamp,
    pageUrl: safeDraft.pageUrl,
    elementHtml: safeDraft.elementHtml,
    typedValue: safeDraft.typedValue,
    description: ""
  });

  workflow.steps.push(step);
  workflow.updatedAt = nowIso();
  await saveState(state);
  return step;
}

export async function updateStep(
  workflowId: string,
  stepId: string,
  patch: WorkflowStepPatch
): Promise<WorkflowStep | null> {
  const state = await getState();
  const workflow = state.workflowsById[workflowId];
  if (!workflow) return null;

  const step = workflow.steps.find((item) => item.id === stepId);
  if (!step) return null;

  Object.assign(step, patch);
  workflow.updatedAt = nowIso();
  await saveState(state);
  return step;
}

export async function attachScreenshot(
  workflowId: string,
  stepId: string,
  screenshot: StoredScreenshot
): Promise<WorkflowStep | null> {
  const state = await getState();
  const workflow = state.workflowsById[workflowId];
  if (!workflow) return null;

  const step = workflow.steps.find((item) => item.id === stepId);
  if (!step) return null;

  state.screenshotsById[screenshot.id] = storedScreenshotSchema.parse(screenshot);
  step.screenshotId = screenshot.id;
  workflow.updatedAt = nowIso();
  await saveState(state);
  return step;
}

export async function detachScreenshot(
  workflowId: string,
  stepId: string
): Promise<WorkflowStep | null> {
  const state = await getState();
  const workflow = state.workflowsById[workflowId];
  if (!workflow) return null;

  const step = workflow.steps.find((item) => item.id === stepId);
  if (!step) return null;

  const screenshotId = step.screenshotId;
  if (!screenshotId) {
    return step;
  }

  delete step.screenshotId;

  const isScreenshotStillReferenced = Object.values(state.workflowsById).some((item) =>
    item.steps.some((workflowStep) => workflowStep.screenshotId === screenshotId)
  );

  if (!isScreenshotStillReferenced) {
    delete state.screenshotsById[screenshotId];
  }

  workflow.updatedAt = nowIso();
  await saveState(state);
  return step;
}
