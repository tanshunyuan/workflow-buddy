import { useEffect, useState, startTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { createId } from "@/shared/ids";
import { extensionMessageSchema, type ExtensionMessage } from "@/shared/messages";
import { rootStorageSchema, storedScreenshotSchema, workflowSchema } from "@/shared/schemas";
import { nowIso } from "@/shared/time";
import type { RootStorage, StoredScreenshot, Workflow } from "@/shared/types";
import { Download, FileImage, PencilLine, SquareMousePointer, StopCircle, Trash2 } from "lucide-react";

type SessionViewState =
  | "idle"
  | "draft"
  | "recording"
  | "completed-empty"
  | "completed-ready";

function getSessionViewState(workflow: Workflow | undefined): SessionViewState {
  if (!workflow) return "idle";
  if (workflow.status === "draft") return "draft";
  if (workflow.status === "recording") return "recording";
  if (workflow.status === "completed" && workflow.steps.length === 0) return "completed-empty";
  return "completed-ready";
}

function createEmptyState(): RootStorage {
  return rootStorageSchema.parse({
    currentWorkflowId: null,
    workflowsById: {},
    screenshotsById: {},
    activeRecordingTabId: null
  });
}

async function sendMessage(message: ExtensionMessage): Promise<unknown> {
  extensionMessageSchema.parse(message);
  return chrome.runtime.sendMessage(message);
}

async function getActiveTabId(): Promise<number | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id ?? null;
}

async function fileToStoredScreenshot(file: File): Promise<StoredScreenshot> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });

  return storedScreenshotSchema.parse({
    id: createId("shot"),
    name: file.name,
    mimeType: file.type || "image/png",
    dataUrl,
    createdAt: nowIso()
  });
}

export function App() {
  const [storageState, setStorageState] = useState<RootStorage>(createEmptyState);
  const [workflowName, setWorkflowName] = useState("");
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [failureNotes, setFailureNotes] = useState("");
  const [pendingScreenshot, setPendingScreenshot] = useState<StoredScreenshot | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);

  const currentWorkflow = storageState.currentWorkflowId
    ? storageState.workflowsById[storageState.currentWorkflowId]
    : undefined;
  const selectedStep = currentWorkflow?.steps.find((step) => step.id === selectedStepId);
  const sessionViewState = getSessionViewState(currentWorkflow);
  const isRecording = sessionViewState === "recording";
  const isCompleted = sessionViewState === "completed-empty" || sessionViewState === "completed-ready";

  async function refreshState() {
    const response = await sendMessage({ type: "GET_STATE" });
    const nextState = rootStorageSchema.parse(response);

    startTransition(() => {
      setStorageState(nextState);
      setSelectedStepId((currentId) => {
        if (currentId && nextState.currentWorkflowId) {
          const nextWorkflow = nextState.workflowsById[nextState.currentWorkflowId];
          if (nextWorkflow?.steps.some((step) => step.id === currentId)) {
            return currentId;
          }
        }

        return nextState.currentWorkflowId
          ? nextState.workflowsById[nextState.currentWorkflowId]?.steps.at(-1)?.id ?? null
          : null;
      });
    });
  }

  useEffect(() => {
    void refreshState();

    const handleStorageChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string
    ) => {
      if (areaName === "local" && changes.workflowBuddyState) {
        void refreshState();
      }
    };

    chrome.storage.onChanged.addListener(handleStorageChange);

    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, []);

  useEffect(() => {
    setDescription(selectedStep?.description ?? "");
    setFailureNotes(selectedStep?.failureNotes ?? "");
    setPendingScreenshot(null);
  }, [selectedStepId, selectedStep?.description, selectedStep?.failureNotes]);

  function getStartErrorMessage(response: unknown): string | null {
    if (
      typeof response === "object" &&
      response !== null &&
      "ok" in response &&
      response.ok === true &&
      "workflow" in response &&
      workflowSchema.safeParse(response.workflow).success
    ) {
      return null;
    }

    if (
      typeof response === "object" &&
      response !== null &&
      "ok" in response &&
      response.ok === false &&
      "error" in response &&
      typeof response.error === "string"
    ) {
      return response.error;
    }

    return "Recording could not start in this tab.";
  }

  async function handleCreateWorkflow() {
    const trimmed = workflowName.trim();
    if (!trimmed) return;

    const createdWorkflow = workflowSchema.parse(
      await sendMessage({ type: "CREATE_WORKFLOW", name: trimmed })
    );

    const tabId = await getActiveTabId();
    if (tabId == null) {
      setSessionError("No active browser tab is available for recording.");
      return;
    }

    const startResponse = await sendMessage({
      type: "START_RECORDING",
      workflowId: createdWorkflow.id,
      tabId
    });
    setSessionError(getStartErrorMessage(startResponse));

    setWorkflowName("");
    await refreshState();
  }

  async function handleStartRecording(workflowOverride?: Workflow) {
    const workflow = workflowOverride ?? currentWorkflow;
    if (!workflow) return;

    const tabId = await getActiveTabId();
    if (tabId == null) {
      setSessionError("No active browser tab is available for recording.");
      return;
    }

    const startResponse = await sendMessage({
      type: "START_RECORDING",
      workflowId: workflow.id,
      tabId
    });
    setSessionError(getStartErrorMessage(startResponse));
    await refreshState();
  }

  async function handleStopRecording() {
    if (!currentWorkflow) return;

    setSessionError(null);
    await sendMessage({
      type: "STOP_RECORDING",
      workflowId: currentWorkflow.id
    });
    await refreshState();
  }

  async function handleExport() {
    if (!currentWorkflow) return;

    setSessionError(null);
    const exportResponse = await sendMessage({
      type: "EXPORT_WORKFLOW",
      workflowId: currentWorkflow.id
    });

    if (
      typeof exportResponse === "object" &&
      exportResponse !== null &&
      "ok" in exportResponse &&
      exportResponse.ok === false &&
      "error" in exportResponse &&
      typeof exportResponse.error === "string"
    ) {
      setSessionError(exportResponse.error);
      return;
    }

    await refreshState();
  }

  async function handleSaveStep() {
    if (!currentWorkflow || !selectedStep) return;

    setSessionError(null);
    await sendMessage({
      type: "UPDATE_STEP",
      workflowId: currentWorkflow.id,
      stepId: selectedStep.id,
      patch: {
        description,
        failureNotes: failureNotes || undefined
      }
    });

    if (pendingScreenshot) {
      await sendMessage({
        type: "ATTACH_SCREENSHOT",
        workflowId: currentWorkflow.id,
        stepId: selectedStep.id,
        screenshot: pendingScreenshot
      });
    }

    await refreshState();
  }

  async function handleDiscardWorkflow() {
    if (!currentWorkflow) return;

    setSessionError(null);
    await sendMessage({
      type: "DELETE_WORKFLOW",
      workflowId: currentWorkflow.id
    });
    setWorkflowName("");
    setSelectedStepId(null);
    setDescription("");
    setFailureNotes("");
    setPendingScreenshot(null);
    await refreshState();
  }

  return (
    <div className="grain min-h-screen p-4 text-[color:var(--foreground)]">
      <div className="space-y-4">
        <Card
          className={cn(
            "transition-all duration-300",
            isRecording && "recording-pulse border-[rgba(218,108,67,0.45)] bg-[rgba(255,248,240,0.92)]"
          )}
        >
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[color:var(--muted-foreground)]">
                  Session
                </p>
                <CardTitle className="mt-2">Workflow Buddy</CardTitle>
              </div>
              <Badge variant={isRecording ? "accent" : currentWorkflow ? "default" : "subtle"}>
                {sessionViewState}
              </Badge>
            </div>
            <CardDescription>
              Create a workflow, keep this panel open while you work in the page, then export only after the capture is complete.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {sessionError ? (
              <div className="rounded-[20px] border border-[rgba(167,54,31,0.22)] bg-[rgba(218,108,67,0.12)] px-4 py-3 text-sm leading-relaxed text-[color:var(--ink-soft)]">
                {sessionError}
              </div>
            ) : null}
            <Input
              placeholder="Name your workflow"
              value={workflowName}
              onChange={(event) => setWorkflowName(event.target.value)}
              disabled={sessionViewState !== "idle"}
            />
            {sessionViewState === "idle" ? (
              <Button variant="outline" onClick={handleCreateWorkflow}>
                <PencilLine className="size-4" />
                Create
              </Button>
            ) : null}
            {sessionViewState === "draft" ? (
              <div className="grid grid-cols-2 gap-3">
                <Button variant="secondary" onClick={() => void handleStartRecording()}>
                  <StopCircle className="size-4" />
                  Start
                </Button>
                <Button variant="outline" onClick={handleDiscardWorkflow}>
                  <Trash2 className="size-4" />
                  Discard
                </Button>
              </div>
            ) : null}
            {sessionViewState === "recording" ? (
              <Button variant="secondary" onClick={handleStopRecording}>
                <StopCircle className="size-4" />
                Stop
              </Button>
            ) : null}
            {sessionViewState === "completed-empty" ? (
              <div className="grid grid-cols-2 gap-3">
                <Button variant="secondary" onClick={() => void handleStartRecording()}>
                  <StopCircle className="size-4" />
                  Resume
                </Button>
                <Button variant="outline" onClick={handleDiscardWorkflow}>
                  <Trash2 className="size-4" />
                  Discard
                </Button>
              </div>
            ) : null}
            {sessionViewState === "completed-ready" ? (
              <div className="grid grid-cols-2 gap-3">
                <Button onClick={handleExport}>
                  <Download className="size-4" />
                  Export
                </Button>
                <Button variant="outline" onClick={handleDiscardWorkflow}>
                  <Trash2 className="size-4" />
                  New
                </Button>
              </div>
            ) : null}
            {currentWorkflow ? (
              <div className="rounded-[24px] border border-[color:var(--line)] bg-[color:var(--background)] p-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[color:var(--muted-foreground)]">
                  Active Workflow
                </p>
                <p className="mt-2 text-lg">{currentWorkflow.name}</p>
                <p className="mt-1 text-sm text-[color:var(--muted-foreground)]">
                  {currentWorkflow.steps.length} recorded step{currentWorkflow.steps.length === 1 ? "" : "s"}
                </p>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Captured Steps</CardTitle>
            <CardDescription>
              The raw interaction log. Pick a step to add meaning, failure notes, and screenshots.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="max-h-[36vh] space-y-3 overflow-y-auto pr-1">
              {currentWorkflow?.steps.length ? (
                currentWorkflow.steps.map((step) => (
                  <button
                    key={step.id}
                    type="button"
                    onClick={() => setSelectedStepId(step.id)}
                    className={[
                      "w-full rounded-[24px] border p-4 text-left transition-all",
                      selectedStepId === step.id
                        ? "border-[color:var(--accent)] bg-[rgba(218,108,67,0.12)] shadow-[0_12px_24px_rgba(218,108,67,0.12)]"
                        : "border-[color:var(--line)] bg-[color:var(--background)] hover:border-[rgba(61,43,31,0.25)]"
                    ].join(" ")}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <Badge variant={step.action === "click" ? "default" : "accent"}>{step.action}</Badge>
                        <span className="font-mono text-xs text-[color:var(--muted-foreground)]">
                          Step {step.index}
                        </span>
                      </div>
                      {step.screenshotId ? (
                        <span className="inline-flex items-center gap-1 text-xs text-[color:var(--muted-foreground)]">
                          <FileImage className="size-3.5" />
                          image
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-[color:var(--foreground)]">
                      {step.description || "No description yet. This step still needs narrative context."}
                    </p>
                    <p className="mt-3 inline-flex items-center gap-2 text-xs text-[color:var(--muted-foreground)]">
                      <SquareMousePointer className="size-3.5" />
                      {new URL(step.pageUrl).hostname}
                    </p>
                  </button>
                ))
              ) : (
                <div className="rounded-[24px] border border-dashed border-[color:var(--line)] bg-[rgba(255,255,255,0.32)] p-6 text-sm leading-relaxed text-[color:var(--muted-foreground)]">
                  No steps yet. Record interactions in the active tab and the capture log will appear here automatically.
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Step Editor</CardTitle>
            <CardDescription>
              Turn the raw event into a reusable instruction for the downstream model.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {selectedStep ? (
              <>
                <div className="rounded-[24px] border border-[color:var(--line)] bg-[color:var(--background)] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <Badge variant="subtle">Step {selectedStep.index}</Badge>
                    <span className="font-mono text-xs text-[color:var(--muted-foreground)]">
                      {selectedStep.action}
                    </span>
                  </div>
                  <Separator className="my-3" />
                  <p className="line-clamp-4 text-xs leading-relaxed text-[color:var(--muted-foreground)]">
                    {selectedStep.elementHtml}
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
                    Description
                  </label>
                  <Textarea
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="Describe what this step does in plain language."
                  />
                </div>

                <div className="space-y-2">
                  <label className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
                    Failure Notes
                  </label>
                  <Textarea
                    value={failureNotes}
                    onChange={(event) => setFailureNotes(event.target.value)}
                    placeholder="Optional: explain what to do if this interaction fails."
                  />
                </div>

                <div className="space-y-2">
                  <label className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
                    Screenshot
                  </label>
                  <Input
                    type="file"
                    accept="image/*"
                    onChange={async (event) => {
                      const file = event.target.files?.[0];
                      if (!file) {
                        setPendingScreenshot(null);
                        return;
                      }

                      setPendingScreenshot(await fileToStoredScreenshot(file));
                    }}
                  />
                  {pendingScreenshot ? (
                    <p className="text-xs text-[color:var(--muted-foreground)]">
                      Pending attachment: {pendingScreenshot.name}
                    </p>
                  ) : null}
                </div>

                <Button className="w-full" onClick={handleSaveStep}>
                  Save Step
                </Button>
              </>
            ) : (
              <div className="rounded-[24px] border border-dashed border-[color:var(--line)] bg-[rgba(255,255,255,0.32)] p-6 text-sm leading-relaxed text-[color:var(--muted-foreground)]">
                Select a recorded step to add a description, screenshot, and failure notes.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
