import {
  startTransition,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useForm } from "react-hook-form";
import { Camera, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { createId } from "@/shared/ids";
import {
  extensionMessageSchema,
  type ExtensionMessage,
} from "@/shared/messages";
import {
  rootStorageSchema,
  storedScreenshotSchema,
  workflowSchema,
} from "@/shared/schemas";
import { nowIso } from "@/shared/time";
import type {
  RootStorage,
  StoredScreenshot,
  Workflow,
  WorkflowStep,
} from "@/shared/types";
import { useAutoScroll } from "./useAutoScroll";

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
  if (workflow.status === "completed" && workflow.steps.length === 0)
    return "completed-empty";
  return "completed-ready";
}

function createEmptyState(): RootStorage {
  return rootStorageSchema.parse({
    currentWorkflowId: null,
    workflowsById: {},
    screenshotsById: {},
    activeRecordingTabId: null,
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
    createdAt: nowIso(),
  });
}

function getImageFileFromClipboard(
  clipboardData: DataTransfer | null,
): File | null {
  if (!clipboardData) return null;

  const imageItem = Array.from(clipboardData.items).find((item) =>
    item.type.startsWith("image/"),
  );

  return imageItem?.getAsFile() ?? null;
}

function formatActionLabel(action: WorkflowStep["action"]): string {
  return action === "click" ? "Click" : "Type";
}

function formatActionChipLabel(action: WorkflowStep["action"]): string {
  return action;
}

function formatSessionLabel(viewState: SessionViewState): string {
  switch (viewState) {
    case "draft":
      return "Draft";
    case "recording":
      return "Recording";
    case "completed-empty":
      return "Paused";
    case "completed-ready":
      return "Completed";
    default:
      return "Idle";
  }
}

function getPanelBadgeLabel(viewState: SessionViewState): string | null {
  switch (viewState) {
    case "draft":
      return "Draft";
    case "recording":
      return "Recording";
    default:
      return null;
  }
}

function getSessionBadgeVariant(
  viewState: SessionViewState,
): "default" | "accent" | "completed" | "subtle" {
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
    ...(withSeconds ? { second: "2-digit" } : {}),
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
  return description || "No description yet";
}

function NoticeCard({
  tone,
  title,
  children,
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
          : "border-[color:var(--error-border)] bg-[color:var(--error-bg)]",
      )}
    >
      <div
        className={cn(
          "[font-family:var(--font-mono)] pt-px text-[12px] font-semibold",
          isWarning
            ? "text-[color:var(--warning)]"
            : "text-[color:var(--error)]",
        )}
      >
        {isWarning ? "△" : "✕"}
      </div>
      <div className="min-w-0">
        <p
          className={cn(
            "[font-family:var(--font-mono)] mb-1 text-[10px] font-semibold uppercase tracking-[0.16em]",
            isWarning
              ? "text-[color:var(--warning)]"
              : "text-[color:var(--error)]",
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
  optional,
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

function ActionChip({
  action,
  className,
}: {
  action: WorkflowStep["action"];
  className?: string;
}) {
  return (
    <span
      className={cn(
        "[font-family:var(--font-mono)] inline-flex items-center rounded-[4px] px-2 py-[2px] text-[10px] font-semibold uppercase tracking-[0.14em]",
        action === "click"
          ? "bg-[rgba(62,46,31,0.08)] text-[color:var(--ink-soft)]"
          : "bg-[color:var(--typed-value-bg)] text-[color:var(--typed-value-fg)]",
        className,
      )}
    >
      {formatActionChipLabel(action)}
    </span>
  );
}

function AnnotationChip({
  label,
  active,
}: {
  label: ReactNode;
  active: boolean;
}) {
  return (
    <span
      className={cn(
        "[font-family:var(--font-mono)] inline-flex items-center rounded-[4px] px-[6px] py-[2px] text-[9px] font-semibold uppercase tracking-[0.1em]",
        active
          ? "bg-[rgba(218,108,67,0.1)] text-[color:var(--typed-value-fg)]"
          : "bg-[rgba(62,46,31,0.07)] text-[color:var(--muted-foreground)]",
      )}
    >
      {label}
    </span>
  );
}

export function App() {
  const [storageState, setStorageState] =
    useState<RootStorage>(createEmptyState);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [failureNotes, setFailureNotes] = useState("");
  const [isNotesExpanded, setIsNotesExpanded] = useState(false);
  const [isScreenshotExpanded, setIsScreenshotExpanded] = useState(false);
  const [isAttachingScreenshot, setIsAttachingScreenshot] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [previewScreenshot, setPreviewScreenshot] =
    useState<StoredScreenshot | null>(null);
  const screenshotInputId = useId();
  const stepsBottomRef = useRef<HTMLDivElement | null>(null);
  const descriptionRef = useRef<HTMLTextAreaElement | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<{ workflowName: string }>({
    defaultValues: {
      workflowName: "",
    },
  });

  const currentWorkflow = storageState.currentWorkflowId
    ? storageState.workflowsById[storageState.currentWorkflowId]
    : undefined;
  const selectedStep = currentWorkflow?.steps.find(
    (step) => step.id === selectedStepId,
  );
  const sessionViewState = getSessionViewState(currentWorkflow);
  const isRecording = sessionViewState === "recording";
  const panelBadgeLabel = getPanelBadgeLabel(sessionViewState);
  const missingDescriptionCount =
    currentWorkflow?.steps.filter(
      (step) => step.description.trim().length === 0,
    ).length ?? 0;

  useAutoScroll(stepsBottomRef.current, currentWorkflow?.steps.length ?? 0);

  async function refreshState() {
    const response = await sendMessage({ type: "GET_STATE" });
    const nextState = rootStorageSchema.parse(response);

    startTransition(() => {
      setStorageState(nextState);
      setSelectedStepId((currentId) => {
        if (!currentId || !nextState.currentWorkflowId) {
          return null;
        }

        const nextWorkflow =
          nextState.workflowsById[nextState.currentWorkflowId];
        return nextWorkflow?.steps.some((step) => step.id === currentId)
          ? currentId
          : null;
      });
    });
  }

  useEffect(() => {
    void refreshState();

    const handleStorageChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
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
  }, [selectedStepId, selectedStep?.description, selectedStep?.failureNotes]);

  useEffect(() => {
    if (!previewScreenshot) return;

    if (!storageState.screenshotsById[previewScreenshot.id]) {
      setPreviewScreenshot(null);
    }
  }, [previewScreenshot, storageState.screenshotsById]);

  useEffect(() => {
    setIsNotesExpanded(false);
    setIsScreenshotExpanded(Boolean(selectedStepId));
  }, [selectedStepId]);

  useEffect(() => {
    if (!selectedStepId) return;

    const timer = window.setTimeout(() => {
      descriptionRef.current?.focus();
    }, 80);

    return () => {
      window.clearTimeout(timer);
    };
  }, [selectedStepId]);

  async function handleDeleteStep(stepId: string) {
    if (!currentWorkflow) return;

    setSessionError(null);
    const currentIndex = currentWorkflow.steps.findIndex(
      (step) => step.id === stepId,
    );
    if (currentIndex === -1) return;

    await sendMessage({
      type: "DELETE_STEP",
      workflowId: currentWorkflow.id,
      stepId,
    });

    if (selectedStepId === stepId) {
      setSelectedStepId(null);
      setDescription("");
      setFailureNotes("");
    }

    await refreshState();
  }

  async function attachScreenshotToSelectedStep(screenshot: StoredScreenshot) {
    if (!currentWorkflow || !selectedStep) return;

    setSessionError(null);
    setIsAttachingScreenshot(true);

    try {
      const response = await sendMessage({
        type: "ATTACH_SCREENSHOT",
        workflowId: currentWorkflow.id,
        stepId: selectedStep.id,
        screenshot,
      });

      if (!response) {
        setSessionError("Screenshot could not be attached.");
      }
    } finally {
      setIsAttachingScreenshot(false);
      await refreshState();
    }
  }

  async function handleCaptureScreenshot() {
    if (!currentWorkflow || !selectedStep) return;

    const tabId = await getActiveTabId();
    if (tabId == null) {
      setSessionError(
        "No active browser tab is available for screenshot capture.",
      );
      return;
    }

    setSessionError(null);
    setIsAttachingScreenshot(true);

    try {
      const response = await sendMessage({
        type: "CAPTURE_SCREENSHOT",
        workflowId: currentWorkflow.id,
        stepId: selectedStep.id,
        tabId,
      });

      if (
        typeof response === "object" &&
        response !== null &&
        "ok" in response &&
        response.ok === false &&
        "error" in response &&
        typeof response.error === "string"
      ) {
        setSessionError(response.error);
      }
    } finally {
      setIsAttachingScreenshot(false);
      await refreshState();
    }
  }

  async function handleScreenshotFile(file: File) {
    await attachScreenshotToSelectedStep(await fileToStoredScreenshot(file));
  }

  async function handleDetachScreenshot(stepId: string) {
    if (!currentWorkflow) return;

    const step = currentWorkflow.steps.find((item) => item.id === stepId);
    const screenshotId = step?.screenshotId;

    setSessionError(null);
    await sendMessage({
      type: "DETACH_SCREENSHOT",
      workflowId: currentWorkflow.id,
      stepId,
    });

    if (previewScreenshot && screenshotId === previewScreenshot.id) {
      setPreviewScreenshot(null);
    }

    await refreshState();
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

  async function handleCreateWorkflow(values: { workflowName: string }) {
    const trimmed = values.workflowName.trim();
    if (!trimmed) return;

    const createdWorkflow = workflowSchema.parse(
      await sendMessage({ type: "CREATE_WORKFLOW", name: trimmed }),
    );

    const tabId = await getActiveTabId();
    if (tabId == null) {
      setSessionError("No active browser tab is available for recording.");
      return;
    }

    const startResponse = await sendMessage({
      type: "START_RECORDING",
      workflowId: createdWorkflow.id,
      tabId,
    });
    setSessionError(getStartErrorMessage(startResponse));

    reset({ workflowName: "" });
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
      tabId,
    });
    setSessionError(getStartErrorMessage(startResponse));
    await refreshState();
  }

  async function handleStopRecording() {
    if (!currentWorkflow) return;

    setSessionError(null);
    await sendMessage({
      type: "STOP_RECORDING",
      workflowId: currentWorkflow.id,
    });
    await refreshState();
  }

  async function handleExport() {
    if (!currentWorkflow) return;

    setSessionError(null);
    const exportResponse = await sendMessage({
      type: "EXPORT_WORKFLOW",
      workflowId: currentWorkflow.id,
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

  function closeAnnotationCard() {
    setSelectedStepId(null);
  }

  async function persistStepDraft(stepId: string) {
    if (!currentWorkflow) return;

    const currentStep = currentWorkflow.steps.find(
      (step) => step.id === stepId,
    );
    if (!currentStep) return;

    const nextDescription = description.trim();
    const nextFailureNotes = failureNotes.trim();
    const currentDescription = currentStep.description;
    const currentFailureNotes = currentStep.failureNotes ?? "";

    const patch: {
      description?: string;
      failureNotes?: string | undefined;
    } = {};

    if (nextDescription !== currentDescription) {
      patch.description = nextDescription;
    }

    if (nextFailureNotes !== currentFailureNotes) {
      patch.failureNotes = nextFailureNotes || undefined;
    }

    if (Object.keys(patch).length === 0) {
      return;
    }

    setSessionError(null);
    await sendMessage({
      type: "UPDATE_STEP",
      workflowId: currentWorkflow.id,
      stepId,
      patch,
    });
    await refreshState();
  }

  async function saveAndCloseAnnotation() {
    if (!selectedStepId) return;

    await persistStepDraft(selectedStepId);
    closeAnnotationCard();
  }

  async function handleStepSelection(stepId: string) {
    if (selectedStepId === stepId) {
      await saveAndCloseAnnotation();
      return;
    }

    if (selectedStepId) {
      await persistStepDraft(selectedStepId);
    }

    setSelectedStepId(stepId);
  }

  async function handleDiscardWorkflow() {
    if (!currentWorkflow) return;

    setSessionError(null);
    await sendMessage({
      type: "DELETE_WORKFLOW",
      workflowId: currentWorkflow.id,
    });
    reset({ workflowName: "" });
    setSelectedStepId(null);
    setDescription("");
    setFailureNotes("");
    await refreshState();
  }

  useEffect(() => {
    if (!selectedStep || !currentWorkflow) {
      return;
    }

    const handleGlobalPaste = (event: ClipboardEvent) => {
      const file = getImageFileFromClipboard(event.clipboardData);
      if (!file) {
        return;
      }

      event.preventDefault();
      void handleScreenshotFile(file);
    };

    document.addEventListener("paste", handleGlobalPaste);

    return () => {
      document.removeEventListener("paste", handleGlobalPaste);
    };
  }, [currentWorkflow, selectedStep]);

  useEffect(() => {
    if (!selectedStepId) {
      return;
    }

    const handleDocumentClick = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;

      if (
        target instanceof Element &&
        target.closest("[data-step-card='true']")
      ) {
        return;
      }

      void saveAndCloseAnnotation();
    };

    const handleDocumentKeydown = (event: KeyboardEvent) => {
      if (previewScreenshot && event.key === "Escape") {
        event.preventDefault();
        setPreviewScreenshot(null);
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        void saveAndCloseAnnotation();
      }

      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        void saveAndCloseAnnotation();
      }
    };

    document.addEventListener("click", handleDocumentClick);
    document.addEventListener("keydown", handleDocumentKeydown);

    return () => {
      document.removeEventListener("click", handleDocumentClick);
      document.removeEventListener("keydown", handleDocumentKeydown);
    };
  }, [
    selectedStepId,
    description,
    failureNotes,
    currentWorkflow,
    selectedStep,
    previewScreenshot,
  ]);

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
                  Keep this panel open while you record. Capture stays narrow,
                  readable, and ready for export.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {currentWorkflow ? (
              <div
                className={cn(
                  "relative overflow-hidden rounded-[16px] border bg-[color:var(--panel-strong)] p-4 before:pointer-events-none before:absolute before:inset-0 before:rounded-[16px] before:bg-[linear-gradient(135deg,rgba(218,108,67,0.08)_0%,transparent_60%)]",
                  isRecording
                    ? "recording-pulse border-[color:var(--accent-border)]"
                    : "border-[color:var(--line)]",
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
                      Started {formatClock(currentWorkflow.createdAt)} ·{" "}
                      {currentWorkflow.steps.length} step
                      {currentWorkflow.steps.length === 1 ? "" : "s"} captured
                    </p>
                  </div>
                  <Badge variant={getSessionBadgeVariant(sessionViewState)}>
                    {isRecording ? (
                      <span className="mr-0.5 inline-block size-[5px] rounded-full bg-current opacity-90" />
                    ) : null}
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

            {!sessionError &&
            currentWorkflow &&
            currentWorkflow.steps.length > 0 &&
            missingDescriptionCount > 0 ? (
              <NoticeCard tone="warning" title="Missing Descriptions">
                {missingDescriptionCount} step
                {missingDescriptionCount === 1 ? "" : "s"} still need narrative
                context before export.
              </NoticeCard>
            ) : null}

            {sessionViewState === "idle" ? (
              <form
                className="space-y-3"
                onSubmit={handleSubmit(handleCreateWorkflow)}
                noValidate
              >
                <div className="space-y-1.5">
                  <FieldLabel>Workflow Name</FieldLabel>
                  <Input
                    aria-invalid={errors.workflowName ? "true" : "false"}
                    className={cn(
                      errors.workflowName &&
                        "border-[color:var(--error-border)] focus-visible:border-[color:var(--error-border)] focus-visible:shadow-[0_0_0_3px_rgba(167,54,31,0.12)]",
                    )}
                    placeholder="Login and submit support ticket"
                    {...register("workflowName", {
                      validate: (value) =>
                        value.trim().length > 0 ||
                        "You need to enter a workflow name before recording.",
                    })}
                  />
                  {errors.workflowName ? (
                    <p className="[font-family:var(--font-serif)] text-[13px] leading-[1.5] text-[color:var(--error)]">
                      {errors.workflowName.message}
                    </p>
                  ) : null}
                </div>
                <Button className="w-full" type="submit">
                  Create Workflow
                </Button>
              </form>
            ) : null}

            {sessionViewState === "draft" ? (
              <div className="grid grid-cols-2 gap-2">
                <Button onClick={() => void handleStartRecording()}>
                  Start Recording
                </Button>
                <Button variant="ghost" onClick={handleDiscardWorkflow}>
                  Discard
                </Button>
              </div>
            ) : null}

            {sessionViewState === "recording" ? (
              <Button
                className="w-full"
                variant="stop"
                onClick={handleStopRecording}
              >
                Stop Recording
              </Button>
            ) : null}

            {sessionViewState === "completed-empty" ? (
              <div className="grid grid-cols-2 gap-2">
                <Button onClick={() => void handleStartRecording()}>
                  Resume Recording
                </Button>
                <Button variant="ghost" onClick={handleDiscardWorkflow}>
                  Discard
                </Button>
              </div>
            ) : null}

            {sessionViewState === "completed-ready" ? (
              <div className="space-y-2">
                <Button
                  className="w-full"
                  variant="outline"
                  onClick={handleExport}
                >
                  Export as Markdown
                </Button>
                <Button
                  className="w-full"
                  variant="ghost"
                  onClick={handleDiscardWorkflow}
                >
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
              Click any step to annotate it in place without leaving the full
              list.
            </CardDescription>
          </CardHeader>
          <CardContent className="py-4">
            <div className="max-h-[52vh] overflow-y-auto pr-1">
              <div className="space-y-3">
                {currentWorkflow?.steps.length ? (
                  currentWorkflow.steps.map((step) => {
                    const isActiveRow = selectedStepId === step.id;
                    const hasFailureNotes = Boolean(step.failureNotes?.trim());
                    const hasScreenshot = Boolean(step.screenshotId);
                    const isDescriptionEmpty =
                      step.description.trim().length === 0;
                    const stepScreenshot = step.screenshotId
                      ? storageState.screenshotsById[step.screenshotId]
                      : null;

                    return (
                      <div
                        key={step.id}
                        data-step-card="true"
                        className={cn(
                          "overflow-hidden rounded-[16px] border transition-[border-color,background-color,box-shadow] duration-150",
                          isActiveRow
                            ? "border-[color:var(--accent-border)] bg-[color:var(--accent-muted)] shadow-[0_2px_6px_rgba(218,108,67,0.06)]"
                            : "border-[rgba(62,46,31,0.12)] bg-[rgba(255,252,247,0.62)] hover:border-[color:var(--line)] hover:bg-[rgba(239,228,213,0.38)]",
                        )}
                      >
                        <div className="flex items-start gap-2 px-[14px] py-3">
                          <button
                            type="button"
                            onClick={() => void handleStepSelection(step.id)}
                            className="min-w-0 flex-1 text-left"
                          >
                            <div className="mb-1 flex items-center gap-2">
                              <span className="[font-family:var(--font-mono)] min-w-[20px] text-[10px] font-semibold tracking-[0.08em] text-[color:var(--muted-foreground)]">
                                {String(step.index).padStart(2, "0")}
                              </span>
                              <ActionChip action={step.action} />
                              <span className="[font-family:var(--font-mono)] ml-auto text-[10px] text-[color:var(--muted-foreground)]">
                                {formatClock(step.timestamp, true)}
                              </span>
                            </div>

                            <p
                              className={cn(
                                "pl-7 text-[13px] leading-[1.5]",
                                isDescriptionEmpty
                                  ? "italic text-[color:var(--muted-foreground)]"
                                  : "text-[color:var(--foreground)]",
                              )}
                            >
                              {getStepHeading(step)}
                            </p>

                            {step.typedValue ? (
                              <div className="pl-7 pt-1">
                                <span className="[font-family:var(--font-mono)] inline-block rounded-[4px] bg-[color:var(--typed-value-bg)] px-[6px] py-[2px] text-[11px] text-[color:var(--typed-value-fg)]">
                                  {step.typedValue}
                                </span>
                              </div>
                            ) : null}

                            <div className="flex flex-wrap gap-1 pl-7 pt-[6px]">
                              <AnnotationChip
                                active={hasFailureNotes}
                                label="⚑ note"
                              />
                              <AnnotationChip
                                active={hasScreenshot}
                                label="◫ screenshot"
                              />
                            </div>

                            <p className="[font-family:var(--font-mono)] mt-[5px] truncate pl-7 text-[10px] text-[color:var(--muted-foreground)]">
                              {getPageHost(step.pageUrl)}
                            </p>
                          </button>

                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              void handleDeleteStep(step.id);
                            }}
                            className="inline-flex size-7 shrink-0 items-center justify-center rounded-[8px] border border-transparent text-[color:var(--muted-foreground)] transition-colors hover:border-[color:var(--error-border)] hover:bg-[color:var(--error-bg)] hover:text-[color:var(--error)]"
                            aria-label={`Remove step ${step.index}`}
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>

                        {isActiveRow ? (
                          <div className="space-y-4 border-t border-[color:var(--accent-border)] px-[14px] pb-4 pt-4">
                            <div className="space-y-1.5">
                              <FieldLabel>Description</FieldLabel>
                              <Textarea
                                ref={descriptionRef}
                                value={description}
                                onChange={(event) =>
                                  setDescription(event.target.value)
                                }
                                className="min-h-[92px] rounded-[10px] px-3 py-[9px] text-[13px]"
                                placeholder="What is this step doing and why…"
                              />
                            </div>

                            <div className="space-y-1.5">
                              <FieldLabel>Element HTML</FieldLabel>
                              <pre className="[font-family:var(--font-mono)] overflow-x-auto whitespace-pre-wrap break-all rounded-[12px] border border-[color:var(--line)] bg-[color:var(--background)] px-[14px] py-3 text-[11px] leading-[1.5] text-[color:var(--muted-foreground)]">
                                {step.elementHtml}
                              </pre>
                            </div>

                            <div className="space-y-2">
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setIsNotesExpanded((current) => !current)
                                  }
                                  className={cn(
                                    "[font-family:var(--font-mono)] inline-flex items-center gap-[6px] rounded-[6px] border px-[10px] py-[5px] text-[10px] font-semibold uppercase tracking-[0.12em] transition-colors",
                                    isNotesExpanded
                                      ? "border-[color:var(--accent-border)] bg-[color:var(--typed-value-bg)] text-[color:var(--typed-value-fg)]"
                                      : "border-[color:var(--line)] bg-[color:var(--background)] text-[color:var(--muted-foreground)] hover:border-[rgba(62,46,31,0.25)] hover:bg-[color:var(--panel-strong)] hover:text-[color:var(--foreground)]",
                                  )}
                                >
                                  <span>⚑</span>
                                  Failure Notes
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setIsScreenshotExpanded(
                                      (current) => !current,
                                    )
                                  }
                                  className={cn(
                                    "[font-family:var(--font-mono)] inline-flex items-center gap-[6px] rounded-[6px] border px-[10px] py-[5px] text-[10px] font-semibold uppercase tracking-[0.12em] transition-colors",
                                    isScreenshotExpanded
                                      ? "border-[color:var(--accent-border)] bg-[color:var(--typed-value-bg)] text-[color:var(--typed-value-fg)]"
                                      : "border-[color:var(--line)] bg-[color:var(--background)] text-[color:var(--muted-foreground)] hover:border-[rgba(62,46,31,0.25)] hover:bg-[color:var(--panel-strong)] hover:text-[color:var(--foreground)]",
                                  )}
                                >
                                  <span>◫</span>
                                  Screenshot
                                </button>
                              </div>

                              {isNotesExpanded ? (
                                <div className="space-y-1.5">
                                  <FieldLabel optional>
                                    Failure Notes
                                  </FieldLabel>
                                  <Textarea
                                    value={failureNotes}
                                    onChange={(event) =>
                                      setFailureNotes(event.target.value)
                                    }
                                    className="min-h-[78px] rounded-[10px] px-3 py-[9px] text-[13px]"
                                    placeholder="What might go wrong at this step…"
                                  />
                                </div>
                              ) : null}

                              {isScreenshotExpanded ? (
                                <div className="space-y-2">
                                  <div className="flex flex-wrap gap-2">
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      disabled={isAttachingScreenshot}
                                      onClick={() =>
                                        void handleCaptureScreenshot()
                                      }
                                    >
                                      <Camera className="size-3.5" />
                                      {isAttachingScreenshot
                                        ? "Capturing..."
                                        : "Capture Current Tab"}
                                    </Button>
                                  </div>
                                  <input
                                    id={screenshotInputId}
                                    type="file"
                                    accept="image/*"
                                    className="sr-only"
                                    onChange={async (event) => {
                                      const file = event.target.files?.[0];
                                      event.currentTarget.value = "";
                                      if (!file) return;
                                      await handleScreenshotFile(file);
                                    }}
                                  />
                                  <div
                                    tabIndex={0}
                                    onPaste={(event) => {
                                      const file = getImageFileFromClipboard(
                                        event.clipboardData,
                                      );
                                      if (!file) return;
                                      event.preventDefault();
                                      void handleScreenshotFile(file);
                                    }}
                                    className="rounded-[10px] border-[1.5px] border-dashed border-[rgba(62,46,31,0.18)] px-4 py-4 text-center transition-colors hover:border-[rgba(218,108,67,0.3)] hover:bg-[rgba(218,108,67,0.03)] focus-visible:border-[rgba(218,108,67,0.35)] focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_rgba(218,108,67,0.12)]"
                                  >
                                    <label
                                      htmlFor={screenshotInputId}
                                      className="block cursor-pointer"
                                    >
                                      <p className="text-[12px] italic text-[color:var(--muted-foreground)]">
                                        Paste an image here, or click to upload
                                      </p>
                                      <p className="[font-family:var(--font-mono)] mt-1 text-[9px] tracking-[0.1em] text-[rgba(119,106,93,0.55)]">
                                        PNG · JPG · WEBP
                                      </p>
                                    </label>
                                  </div>

                                  {stepScreenshot ? (
                                    <div className="relative rounded-[10px] border border-[color:var(--line)] bg-[color:var(--background)] p-3">
                                      <button
                                        type="button"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          setPreviewScreenshot(stepScreenshot);
                                        }}
                                        className="group flex w-full items-center gap-3 rounded-[8px] text-left transition-colors hover:bg-[rgba(62,46,31,0.04)] focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_rgba(218,108,67,0.12)]"
                                        aria-label={`Expand screenshot ${stepScreenshot.name}`}
                                      >
                                        <div className="h-[56px] w-[74px] shrink-0 overflow-hidden rounded-[8px] border border-[color:var(--line)] bg-[color:var(--panel-strong)]">
                                          <img
                                            src={stepScreenshot.dataUrl}
                                            alt={stepScreenshot.name}
                                            className="h-full w-full object-cover transition-transform duration-150 group-hover:scale-[1.02]"
                                          />
                                        </div>
                                        <div className="min-w-0 flex-1 pr-8">
                                          <p className="[font-family:var(--font-mono)] truncate text-[10px] text-[color:var(--foreground)]">
                                            {stepScreenshot.name}
                                          </p>
                                          <p className="[font-family:var(--font-mono)] mt-1 text-[9px] uppercase tracking-[0.1em] text-[color:var(--muted-foreground)]">
                                            Attached · click to enlarge
                                          </p>
                                        </div>
                                      </button>
                                      <button
                                        type="button"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          void handleDetachScreenshot(step.id);
                                        }}
                                        className="absolute right-2 top-2 inline-flex size-7 items-center justify-center rounded-full border border-[rgba(62,46,31,0.12)] bg-[rgba(255,252,247,0.92)] text-[color:var(--muted-foreground)] transition-colors hover:border-[color:var(--error-border)] hover:bg-[color:var(--error-bg)] hover:text-[color:var(--error)]"
                                        aria-label={`Remove screenshot from step ${step.index}`}
                                      >
                                        <X className="size-3.5" />
                                      </button>
                                    </div>
                                  ) : isAttachingScreenshot ? (
                                    <p className="[font-family:var(--font-mono)] text-[10px] uppercase tracking-[0.12em] text-[color:var(--muted-foreground)]">
                                      Attaching screenshot...
                                    </p>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>

                            <div className="flex items-center justify-end pt-1">
                              <p className="[font-family:var(--font-mono)] text-right text-[9px] uppercase tracking-[0.12em] text-[rgba(119,106,93,0.65)]">
                                Click the step again, click outside, press Esc,
                                or press Cmd/Ctrl+Enter to save
                              </p>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })
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
                <div ref={stepsBottomRef} aria-hidden="true" className="h-px" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
      {previewScreenshot ? (
        <div
          data-step-card="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(24,20,18,0.42)] p-4 backdrop-blur-[2px]"
          onClick={() => setPreviewScreenshot(null)}
        >
          <div
            className="relative w-full max-w-[560px] rounded-[22px] border border-[rgba(62,46,31,0.12)] bg-[color:var(--panel)] p-4 shadow-[0_18px_48px_rgba(23,19,17,0.24)]"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setPreviewScreenshot(null)}
              className="absolute right-3 top-3 inline-flex size-8 items-center justify-center rounded-full border border-[rgba(62,46,31,0.12)] bg-[rgba(255,252,247,0.92)] text-[color:var(--muted-foreground)] transition-colors hover:border-[color:var(--line)] hover:text-[color:var(--foreground)]"
              aria-label="Close screenshot preview"
            >
              <X className="size-4" />
            </button>
            <div className="space-y-3 pr-10">
              <div>
                <p className="[font-family:var(--font-mono)] text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
                  Screenshot Preview
                </p>
                <p className="[font-family:var(--font-mono)] mt-1 truncate text-[10px] text-[color:var(--foreground)]">
                  {previewScreenshot.name}
                </p>
              </div>
              <div className="overflow-hidden rounded-[16px] border border-[color:var(--line)] bg-[color:var(--background)]">
                <img
                  src={previewScreenshot.dataUrl}
                  alt={previewScreenshot.name}
                  className="max-h-[70vh] w-full object-contain"
                />
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
