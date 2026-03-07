import { useEffect, useState, startTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { createId } from "@/shared/ids";
import { extensionMessageSchema, type ExtensionMessage } from "@/shared/messages";
import { rootStorageSchema, storedScreenshotSchema } from "@/shared/schemas";
import { nowIso } from "@/shared/time";
import type { RootStorage, StoredScreenshot } from "@/shared/types";
import { Download, FileImage, PencilLine, Radio, SquareMousePointer } from "lucide-react";

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

  const currentWorkflow = storageState.currentWorkflowId
    ? storageState.workflowsById[storageState.currentWorkflowId]
    : undefined;
  const selectedStep = currentWorkflow?.steps.find((step) => step.id === selectedStepId);

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

  async function handleCreateWorkflow() {
    const trimmed = workflowName.trim();
    if (!trimmed) return;

    await sendMessage({ type: "CREATE_WORKFLOW", name: trimmed });
    setWorkflowName("");
    await refreshState();
  }

  async function handleStartRecording() {
    if (!currentWorkflow) return;

    const tabId = await getActiveTabId();
    if (tabId == null) return;

    await sendMessage({
      type: "START_RECORDING",
      workflowId: currentWorkflow.id,
      tabId
    });
    await refreshState();
  }

  async function handleStopRecording() {
    if (!currentWorkflow) return;

    await sendMessage({
      type: "STOP_RECORDING",
      workflowId: currentWorkflow.id
    });
    await refreshState();
  }

  async function handleExport() {
    if (!currentWorkflow) return;

    await sendMessage({
      type: "EXPORT_WORKFLOW",
      workflowId: currentWorkflow.id
    });
  }

  async function handleSaveStep() {
    if (!currentWorkflow || !selectedStep) return;

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

  return (
    <div className="grain min-h-screen p-4 text-[color:var(--foreground)]">
      <div className="flex items-start justify-between gap-4 rounded-[30px] border border-[color:var(--line)] bg-[rgba(255,252,247,0.75)] p-5 shadow-[0_20px_45px_rgba(41,32,24,0.09)] backdrop-blur-sm">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-[color:var(--muted-foreground)]">
            Recording Panel
          </p>
          <h1 className="mt-2 text-3xl leading-none">Workflow Buddy</h1>
          <p className="mt-3 max-w-[16rem] text-sm leading-relaxed text-[color:var(--muted-foreground)]">
            Keep this panel open while you work in the page. Capture the workflow, then polish each step into a model-ready brief.
          </p>
        </div>
        <Badge variant={currentWorkflow?.status === "recording" ? "accent" : "subtle"}>
          {currentWorkflow ? currentWorkflow.status : "idle"}
        </Badge>
      </div>

      <div className="mt-4 space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Session</CardTitle>
            <CardDescription>
              Create a workflow, then start recording clicks and input from the current tab without closing this panel.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              placeholder="Name your workflow"
              value={workflowName}
              onChange={(event) => setWorkflowName(event.target.value)}
            />
            <div className="grid grid-cols-2 gap-3">
              <Button variant="outline" onClick={handleCreateWorkflow}>
                <PencilLine className="size-4" />
                Create
              </Button>
              <Button variant="secondary" onClick={handleStartRecording} disabled={!currentWorkflow}>
                <Radio className="size-4" />
                Start
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Button variant="outline" onClick={handleStopRecording} disabled={!currentWorkflow}>
                Stop
              </Button>
              <Button onClick={handleExport} disabled={!currentWorkflow || currentWorkflow.steps.length === 0}>
                <Download className="size-4" />
                Export
              </Button>
            </div>
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
                  No steps yet. Start recording, keep this panel open, and interact with the recorded tab to capture each action.
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
