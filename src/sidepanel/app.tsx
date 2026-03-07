import { useEffect, useId, useState, startTransition, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { createId } from "@/shared/ids";
import { extensionMessageSchema, type ExtensionMessage } from "@/shared/messages";
import { rootStorageSchema, storedScreenshotSchema, workflowSchema } from "@/shared/schemas";
import { nowIso } from "@/shared/time";
import type { RootStorage, StoredScreenshot, Workflow, WorkflowStep } from "@/shared/types";

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

function formatActionLabel(action: WorkflowStep["action"]): string {
  return action === "click" ? "Click" : "Type";
}

function formatSessionLabel(viewState: SessionViewState): string {
  switch (viewState) {
    case "draft":
      return "Draft";
    case "recording":
      return "Recording";
    case "completed-empty":
    case "completed-ready":
      return "Completed";
    default:
      return "Idle";
  }
}

function getSessionBadgeVariant(viewState: SessionViewState): "default" | "accent" | "completed" | "subtle" {
  switch (viewState) {
    case "draft":
      return "default";
    case "recording":
      return "accent";
    case "completed-empty":
    case "completed-ready":
      return "completed";
    default:
      return "subtle";
  }
}

function formatClock(timestamp: string, withSeconds = false): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }

  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    ...(withSeconds ? { second: "2-digit" } : {})
  });
}

function getPageHost(pageUrl: string): string {
  try {
    return new URL(pageUrl).host;
  } catch {
    return pageUrl;
  }
}

function getStepHeading(step: WorkflowStep): string {
  const description = step.description.trim();
  if (description) return description;
  return step.action === "click" ? "Clicked an element" : "Typed into a field";
}

function NoticeCard({
  tone,
  title,
  children
}: {
  tone: "warning" | "error";
  title: string;
  children: ReactNode;
}) {
  const isWarning = tone === "warning";

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-[14px] border px-4 py-3",
        isWarning
          ? "border-[color:var(--warning-border)] bg-[color:var(--warning-bg)]"
          : "border-[color:var(--error-border)] bg-[color:var(--error-bg)]"
      )}
    >
      <div
        className={cn(
          "[font-family:var(--font-mono)] pt-px text-[12px] font-semibold",
          isWarning ? "text-[color:var(--warning)]" : "text-[color:var(--error)]"
        )}
      >
        {isWarning ? "△" : "✕"}
      </div>
      <div className="min-w-0">
        <p
          className={cn(
            "[font-family:var(--font-mono)] mb-1 text-[10px] font-semibold uppercase tracking-[0.16em]",
            isWarning ? "text-[color:var(--warning)]" : "text-[color:var(--error)]"
          )}
        >
          {title}
        </p>
        <p className="[font-family:var(--font-serif)] text-[13px] leading-[1.5] text-[color:var(--foreground)]">
          {children}
        </p>
      </div>
    </div>
  );
}

function FieldLabel({
  children,
  optional
}: {
  children: ReactNode;
  optional?: boolean;
}) {
  return (
    <label className="[font-family:var(--font-mono)] text-[10px] font-semibold uppercase tracking-[0.2em] text-[color:var(--muted-foreground)]">
      {children}
      {optional ? (
        <span className="ml-2 [font-family:var(--font-serif)] text-[11px] font-normal normal-case tracking-normal text-[rgba(119,106,93,0.6)] italic">
          optional
        </span>
      ) : null}
    </label>
  );
}

export function App() {
  const [storageState, setStorageState] = useState<RootStorage>(createEmptyState);
  const [workflowName, setWorkflowName] = useState("");
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [failureNotes, setFailureNotes] = useState("");
  const [pendingScreenshot, setPendingScreenshot] = useState<StoredScreenshot | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const screenshotInputId = useId();

  const currentWorkflow = storageState.currentWorkflowId
    ? storageState.workflowsById[storageState.currentWorkflowId]
    : undefined;
  const selectedStep = currentWorkflow?.steps.find((step) => step.id === selectedStepId);
  const selectedScreenshot = selectedStep?.screenshotId
    ? storageState.screenshotsById[selectedStep.screenshotId]
    : null;
  const sessionViewState = getSessionViewState(currentWorkflow);
  const isRecording = sessionViewState === "recording";
  const missingDescriptionCount =
    currentWorkflow?.steps.filter((step) => step.description.trim().length === 0).length ?? 0;

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

  function resetSelectedStepDraft() {
    setDescription(selectedStep?.description ?? "");
    setFailureNotes(selectedStep?.failureNotes ?? "");
    setPendingScreenshot(null);
  }

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
    <div className="grain min-h-screen bg-transparent px-4 py-5 text-[color:var(--foreground)]">
      <div className="mx-auto flex w-full max-w-[620px] flex-col gap-4">
        <Card>
          <CardHeader className="gap-2">
            <p className="[font-family:var(--font-mono)] text-[10px] font-semibold uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]">
              Extension · Side Panel
            </p>
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <CardTitle className="text-[18px]">Workflow Buddy</CardTitle>
                <CardDescription>
                  Keep this panel open while you record. Capture stays narrow, readable, and ready for export.
                </CardDescription>
              </div>
              <Badge variant={getSessionBadgeVariant(sessionViewState)}>
                {isRecording ? <span className="mr-0.5 inline-block size-[5px] rounded-full bg-current opacity-90" /> : null}
                {formatSessionLabel(sessionViewState)}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {currentWorkflow ? (
              <div
                className={cn(
                  "relative overflow-hidden rounded-[16px] border bg-[color:var(--panel-strong)] p-4 before:pointer-events-none before:absolute before:inset-0 before:rounded-[16px] before:bg-[linear-gradient(135deg,rgba(218,108,67,0.08)_0%,transparent_60%)]",
                  isRecording ? "recording-pulse border-[color:var(--accent-border)]" : "border-[color:var(--line)]"
                )}
              >
                <div className="relative z-10 flex items-start justify-between gap-3">
                  <div>
                    <p className="[font-family:var(--font-mono)] text-[10px] font-semibold uppercase tracking-[0.2em] text-[color:var(--muted-foreground)]">
                      Active Session
                    </p>
                    <p className="mt-2 text-[16px] font-semibold leading-[1.4] text-[color:var(--foreground)]">
                      {currentWorkflow.name}
                    </p>
                    <p className="[font-family:var(--font-mono)] mt-1 text-[11px] leading-[1.4] text-[color:var(--muted-foreground)]">
                      Started {formatClock(currentWorkflow.createdAt)} · {currentWorkflow.steps.length} step
                      {currentWorkflow.steps.length === 1 ? "" : "s"} captured
                    </p>
                  </div>
                  <Badge variant={getSessionBadgeVariant(sessionViewState)}>
                    {isRecording ? <span className="mr-0.5 inline-block size-[5px] rounded-full bg-current opacity-90" /> : null}
                    {formatSessionLabel(sessionViewState)}
                  </Badge>
                </div>
              </div>
            ) : (
              <div className="rounded-[16px] border border-dashed border-[rgba(62,46,31,0.18)] px-5 py-7 text-center">
                <p className="text-[15px] font-medium italic text-[color:var(--muted-foreground)]">
                  No active workflow yet
                </p>
                <p className="[font-family:var(--font-mono)] mt-2 text-[10px] uppercase tracking-[0.14em] text-[rgba(119,106,93,0.55)]">
                  Name a workflow to begin recording in this tab
                </p>
              </div>
            )}

            {sessionError ? (
              <NoticeCard tone="error" title="Session Issue">
                {sessionError}
              </NoticeCard>
            ) : null}

            {!sessionError && currentWorkflow && currentWorkflow.steps.length > 0 && missingDescriptionCount > 0 ? (
              <NoticeCard tone="warning" title="Missing Descriptions">
                {missingDescriptionCount} step{missingDescriptionCount === 1 ? "" : "s"} still need narrative context before export.
              </NoticeCard>
            ) : null}

            {sessionViewState === "idle" ? (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <FieldLabel>Workflow Name</FieldLabel>
                  <Input
                    placeholder="Login and submit support ticket"
                    value={workflowName}
                    onChange={(event) => setWorkflowName(event.target.value)}
                  />
                </div>
                <Button className="w-full" onClick={handleCreateWorkflow}>
                  Create Workflow
                </Button>
              </div>
            ) : null}

            {sessionViewState === "draft" ? (
              <div className="grid grid-cols-2 gap-2">
                <Button onClick={() => void handleStartRecording()}>Start Recording</Button>
                <Button variant="ghost" onClick={handleDiscardWorkflow}>
                  Discard
                </Button>
              </div>
            ) : null}

            {sessionViewState === "recording" ? (
              <Button className="w-full" variant="stop" onClick={handleStopRecording}>
                Stop Recording
              </Button>
            ) : null}

            {sessionViewState === "completed-empty" ? (
              <div className="grid grid-cols-2 gap-2">
                <Button onClick={() => void handleStartRecording()}>Resume Recording</Button>
                <Button variant="ghost" onClick={handleDiscardWorkflow}>
                  Discard
                </Button>
              </div>
            ) : null}

            {sessionViewState === "completed-ready" ? (
              <div className="space-y-2">
                <Button className="w-full" variant="outline" onClick={handleExport}>
                  Export as Markdown
                </Button>
                <Button className="w-full" variant="ghost" onClick={handleDiscardWorkflow}>
                  New Workflow
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="gap-2">
            <p className="[font-family:var(--font-mono)] text-[10px] font-semibold uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]">
              Capture Log
            </p>
            <CardTitle className="text-[18px]">Captured Steps</CardTitle>
            <CardDescription>
              Each row is a recorded interaction. Select one to add explanation, failure notes, and a screenshot.
            </CardDescription>
          </CardHeader>
          <CardContent className="py-4">
            <div className="max-h-[34vh] space-y-1.5 overflow-y-auto">
              {currentWorkflow?.steps.length ? (
                currentWorkflow.steps.map((step) => (
                  <button
                    key={step.id}
                    type="button"
                    onClick={() => setSelectedStepId(step.id)}
                    className={cn(
                      "w-full rounded-[12px] border border-transparent bg-transparent px-[14px] py-3 text-left transition-colors hover:border-[color:var(--line)] hover:bg-[rgba(239,228,213,0.5)]",
                      selectedStepId === step.id &&
                        "border-[color:var(--accent-border)] bg-[color:var(--accent-muted)]"
                    )}
                  >
                    <div className="mb-1 flex items-center gap-2">
                      <span className="[font-family:var(--font-mono)] min-w-[20px] text-[10px] font-semibold tracking-[0.08em] text-[color:var(--muted-foreground)]">
                        {String(step.index).padStart(2, "0")}
                      </span>
                      <span
                        className={cn(
                          "[font-family:var(--font-mono)] inline-flex items-center rounded-[4px] px-2 py-[2px] text-[10px] font-semibold uppercase tracking-[0.14em]",
                          step.action === "click"
                            ? "bg-[rgba(62,46,31,0.08)] text-[color:var(--ink-soft)]"
                            : "bg-[color:var(--typed-value-bg)] text-[color:var(--typed-value-fg)]"
                        )}
                      >
                        {formatActionLabel(step.action)}
                      </span>
                      <span className="[font-family:var(--font-mono)] ml-auto text-[10px] text-[color:var(--muted-foreground)]">
                        {formatClock(step.timestamp, true)}
                      </span>
                    </div>

                    <p className="pl-7 text-[13px] leading-[1.5] text-[color:var(--foreground)]">
                      {getStepHeading(step)}
                    </p>

                    {step.typedValue ? (
                      <div className="pl-7 pt-1">
                        <span className="[font-family:var(--font-mono)] inline-block rounded-[4px] bg-[color:var(--typed-value-bg)] px-[6px] py-[2px] text-[11px] text-[color:var(--typed-value-fg)]">
                          {step.typedValue}
                        </span>
                      </div>
                    ) : null}

                    <p className="[font-family:var(--font-mono)] mt-[3px] truncate pl-7 text-[10px] text-[color:var(--muted-foreground)]">
                      {getPageHost(step.pageUrl)}
                    </p>
                  </button>
                ))
              ) : (
                <div className="rounded-[16px] border border-dashed border-[rgba(62,46,31,0.18)] px-5 py-8 text-center">
                  <p className="text-[15px] font-medium italic text-[color:var(--muted-foreground)]">
                    No steps recorded yet
                  </p>
                  <p className="[font-family:var(--font-mono)] mt-2 text-[10px] uppercase tracking-[0.14em] text-[rgba(119,106,93,0.55)]">
                    Start recording to capture clicks and typed values
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="gap-2">
            <p className="[font-family:var(--font-mono)] text-[10px] font-semibold uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]">
              Step Editor
            </p>
            <CardTitle className="text-[18px]">
              {selectedStep ? getStepHeading(selectedStep) : "No step selected"}
            </CardTitle>
            <CardDescription>
              Turn the raw event into an instruction another model can use reliably.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-[18px]">
            {selectedStep ? (
              <>
                <div className="space-y-1">
                  <p className="[font-family:var(--font-mono)] text-[10px] font-semibold uppercase tracking-[0.2em] text-[color:var(--muted-foreground)]">
                    Step {String(selectedStep.index).padStart(2, "0")} · {formatActionLabel(selectedStep.action)}
                  </p>
                </div>

                <div className="space-y-1.5">
                  <FieldLabel>Description</FieldLabel>
                  <Textarea
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="Describe what this step does and why it matters."
                  />
                </div>

                <div className="space-y-1.5">
                  <FieldLabel>Element HTML</FieldLabel>
                  <pre className="[font-family:var(--font-mono)] overflow-x-auto whitespace-pre rounded-[12px] border border-[color:var(--line)] bg-[color:var(--background)] px-[14px] py-3 text-[11px] leading-[1.5] text-[color:var(--muted-foreground)]">
                    {selectedStep.elementHtml}
                  </pre>
                </div>

                <div className="space-y-1.5">
                  <FieldLabel optional>Failure Notes</FieldLabel>
                  <Textarea
                    value={failureNotes}
                    onChange={(event) => setFailureNotes(event.target.value)}
                    placeholder="Describe what might go wrong and how to recover."
                  />
                </div>

                <div className="space-y-1.5">
                  <FieldLabel optional>Screenshot</FieldLabel>
                  <input
                    id={screenshotInputId}
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={async (event) => {
                      const file = event.target.files?.[0];
                      if (!file) {
                        setPendingScreenshot(null);
                        return;
                      }

                      setPendingScreenshot(await fileToStoredScreenshot(file));
                    }}
                  />
                  <label
                    htmlFor={screenshotInputId}
                    className="block cursor-pointer rounded-[14px] border-[1.5px] border-dashed border-[rgba(62,46,31,0.2)] px-5 py-5 text-center transition-colors hover:border-[rgba(218,108,67,0.3)] hover:bg-[rgba(218,108,67,0.03)]"
                  >
                    <p className="text-[13px] italic text-[color:var(--muted-foreground)]">
                      Drop a screenshot here, or click to attach
                    </p>
                    <p className="[font-family:var(--font-mono)] mt-1 text-[10px] tracking-[0.1em] text-[rgba(119,106,93,0.55)]">
                      PNG · JPG · WEBP
                    </p>
                  </label>
                  {pendingScreenshot ? (
                    <p className="[font-family:var(--font-mono)] text-[10px] uppercase tracking-[0.12em] text-[color:var(--muted-foreground)]">
                      Pending attachment · {pendingScreenshot.name}
                    </p>
                  ) : selectedScreenshot ? (
                    <p className="[font-family:var(--font-mono)] text-[10px] uppercase tracking-[0.12em] text-[color:var(--muted-foreground)]">
                      Attached · {selectedScreenshot.name}
                    </p>
                  ) : null}
                </div>

                <div className="flex justify-end gap-2 pt-1">
                  <Button variant="ghost" onClick={resetSelectedStepDraft}>
                    Discard
                  </Button>
                  <Button onClick={handleSaveStep}>Save Step</Button>
                </div>
              </>
            ) : (
              <div className="rounded-[16px] border border-dashed border-[rgba(62,46,31,0.18)] px-5 py-8 text-center">
                <p className="text-[15px] font-medium italic text-[color:var(--muted-foreground)]">
                  Select a recorded step to begin editing
                </p>
                <p className="[font-family:var(--font-mono)] mt-2 text-[10px] uppercase tracking-[0.14em] text-[rgba(119,106,93,0.55)]">
                  Add descriptions, failure notes, and screenshots here
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
