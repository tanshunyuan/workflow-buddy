import { assign, createActor, createMachine } from "xstate";
import type { RootStorage } from "../shared/types.js";

type StableRecordingSessionState =
  | "idle"
  | "draft"
  | "recording"
  | "paused"
  | "completedEmpty"
  | "completedReady";

type RecordingSessionEvent =
  | {
      type: "SYNC";
      status: StableRecordingSessionState;
      workflowId: string | null;
      tabId: number | null;
      stepCount: number;
    }
  | { type: "CREATE_WORKFLOW"; workflowId: string }
  | { type: "DELETE_WORKFLOW" }
  | { type: "START_REQUEST" }
  | { type: "START_SUCCESS"; workflowId: string; tabId: number; stepCount: number }
  | { type: "START_FAILURE"; error: string }
  | { type: "STEP_CAPTURED"; workflowId: string }
  | { type: "PAUSE_REQUEST" }
  | { type: "PAUSE_SUCCESS"; workflowId: string; stepCount: number }
  | { type: "PAUSE_FAILURE"; error: string }
  | { type: "FINISH_REQUEST" }
  | { type: "FINISH_SUCCESS"; stepCount: number }
  | { type: "FINISH_FAILURE"; error: string }
  | { type: "EXPORT_REQUEST" }
  | { type: "EXPORT_SUCCESS" }
  | { type: "EXPORT_FAILURE"; error: string }
  | { type: "CLEAR_ERROR" };

interface RecordingSessionContext {
  workflowId: string | null;
  tabId: number | null;
  stepCount: number;
  error: string | null;
  previousStableState: StableRecordingSessionState;
}

const initialContext: RecordingSessionContext = {
  workflowId: null,
  tabId: null,
  stepCount: 0,
  error: null,
  previousStableState: "idle"
};

const recordingSessionMachine = createMachine(
  {
    id: "recordingSession",
    types: {} as {
      context: RecordingSessionContext;
      events: RecordingSessionEvent;
    },
    initial: "idle",
    context: initialContext,
    on: {
      SYNC: [
        { guard: "isIdleSync", target: ".idle", actions: "applySyncState" },
        { guard: "isDraftSync", target: ".draft", actions: "applySyncState" },
        { guard: "isRecordingSync", target: ".recording", actions: "applySyncState" },
        { guard: "isPausedSync", target: ".paused", actions: "applySyncState" },
        { guard: "isCompletedEmptySync", target: ".completedEmpty", actions: "applySyncState" },
        { guard: "isCompletedReadySync", target: ".completedReady", actions: "applySyncState" }
      ],
      CREATE_WORKFLOW: {
        target: ".draft",
        actions: "assignCreatedWorkflow"
      },
      DELETE_WORKFLOW: {
        target: ".idle",
        actions: "resetSession"
      },
      CLEAR_ERROR: {
        actions: "clearError"
      }
    },
    states: {
      idle: {},
      draft: {
        on: {
          START_REQUEST: {
            target: "starting",
            actions: "prepareStartFromDraft"
          }
        }
      },
      starting: {
        on: {
          START_SUCCESS: {
            target: "recording",
            actions: "assignStartedSession"
          },
          START_FAILURE: [
            {
              guard: "wasPaused",
              target: "paused",
              actions: "assignError"
            },
            {
              target: "draft",
              actions: "assignError"
            }
          ]
        }
      },
      recording: {
        on: {
          STEP_CAPTURED: {
            guard: "matchesWorkflow",
            actions: "incrementStepCount"
          },
          PAUSE_REQUEST: {
            target: "pausing",
            actions: "preparePause"
          },
          FINISH_REQUEST: {
            target: "finishing",
            actions: "prepareFinish"
          }
        }
      },
      pausing: {
        on: {
          PAUSE_SUCCESS: {
            target: "paused",
            actions: "assignPausedSession"
          },
          PAUSE_FAILURE: {
            target: "recording",
            actions: "assignError"
          }
        }
      },
      paused: {
        on: {
          START_REQUEST: {
            target: "starting",
            actions: "prepareStartFromPaused"
          },
          FINISH_REQUEST: {
            target: "finishing",
            actions: "prepareFinish"
          }
        }
      },
      finishing: {
        on: {
          FINISH_SUCCESS: [
            {
              guard: "hasRecordedSteps",
              target: "completedReady",
              actions: "assignCompletedStepCount"
            },
            {
              target: "completedEmpty",
              actions: "assignCompletedStepCount"
            }
          ],
          FINISH_FAILURE: [
            {
              guard: "wasPaused",
              target: "paused",
              actions: "assignError"
            },
            {
              target: "recording",
              actions: "assignError"
            }
          ]
        }
      },
      completedEmpty: {},
      completedReady: {
        on: {
          EXPORT_REQUEST: {
            target: "exporting",
            actions: "prepareExport"
          }
        }
      },
      exporting: {
        on: {
          EXPORT_SUCCESS: {
            target: "idle",
            actions: "resetSession"
          },
          EXPORT_FAILURE: {
            target: "completedReady",
            actions: "assignError"
          }
        }
      }
    }
  },
  {
    actions: {
      applySyncState: assign(({ event }) => {
        if (event.type !== "SYNC") {
          return {};
        }

        return {
          workflowId: event.workflowId,
          tabId: event.tabId,
          stepCount: event.stepCount,
          error: null,
          previousStableState: event.status
        };
      }),
      assignCreatedWorkflow: assign(({ event }) => {
        if (event.type !== "CREATE_WORKFLOW") {
          return {};
        }

        return {
          workflowId: event.workflowId,
          tabId: null,
          stepCount: 0,
          error: null,
          previousStableState: "draft" as const
        };
      }),
      resetSession: assign(() => initialContext),
      clearError: assign({
        error: () => null
      }),
      prepareStartFromDraft: assign({
        error: () => null,
        previousStableState: () => "draft"
      }),
      prepareStartFromPaused: assign({
        error: () => null,
        previousStableState: () => "paused"
      }),
      assignStartedSession: assign(({ event }) => {
        if (event.type !== "START_SUCCESS") {
          return {};
        }

        return {
          workflowId: event.workflowId,
          tabId: event.tabId,
          stepCount: event.stepCount,
          error: null,
          previousStableState: "recording" as const
        };
      }),
      assignError: assign(({ event }) => {
        if (
          event.type !== "START_FAILURE" &&
          event.type !== "PAUSE_FAILURE" &&
          event.type !== "FINISH_FAILURE" &&
          event.type !== "EXPORT_FAILURE"
        ) {
          return {};
        }

        return {
          error: event.error
        };
      }),
      incrementStepCount: assign({
        stepCount: ({ context }) => context.stepCount + 1
      }),
      preparePause: assign({
        error: () => null,
        previousStableState: () => "recording"
      }),
      assignPausedSession: assign(({ event, context }) => {
        if (event.type !== "PAUSE_SUCCESS") {
          return {};
        }

        return {
          workflowId: event.workflowId,
          tabId: null,
          stepCount: event.stepCount,
          error: null,
          previousStableState: "paused" as const
        };
      }),
      prepareFinish: assign({
        error: () => null
      }),
      assignCompletedStepCount: assign(({ event }) => {
        if (event.type !== "FINISH_SUCCESS") {
          return {};
        }

        return {
          tabId: null,
          stepCount: event.stepCount,
          error: null,
          previousStableState: event.stepCount > 0 ? "completedReady" : "completedEmpty"
        };
      }),
      prepareExport: assign({
        error: () => null,
        previousStableState: () => "completedReady"
      })
    },
    guards: {
      isIdleSync: ({ event }) => event.type === "SYNC" && event.status === "idle",
      isDraftSync: ({ event }) => event.type === "SYNC" && event.status === "draft",
      isRecordingSync: ({ event }) => event.type === "SYNC" && event.status === "recording",
      isPausedSync: ({ event }) => event.type === "SYNC" && event.status === "paused",
      isCompletedEmptySync: ({ event }) => event.type === "SYNC" && event.status === "completedEmpty",
      isCompletedReadySync: ({ event }) => event.type === "SYNC" && event.status === "completedReady",
      wasPaused: ({ context }) => context.previousStableState === "paused",
      matchesWorkflow: ({ context, event }) =>
        event.type === "STEP_CAPTURED" && context.workflowId !== null && event.workflowId === context.workflowId,
      hasRecordedSteps: ({ event }) => event.type === "FINISH_SUCCESS" && event.stepCount > 0
    }
  }
);

function deriveSyncState(storageState: RootStorage): Extract<RecordingSessionEvent, { type: "SYNC" }> {
  const workflow = storageState.currentWorkflowId
    ? storageState.workflowsById[storageState.currentWorkflowId]
    : undefined;

  if (!workflow) {
    return {
      type: "SYNC",
      status: "idle",
      workflowId: null,
      tabId: null,
      stepCount: 0
    };
  }

  if (workflow.status === "draft") {
    return {
      type: "SYNC",
      status: "draft",
      workflowId: workflow.id,
      tabId: workflow.tabId ?? storageState.activeRecordingTabId,
      stepCount: workflow.steps.length
    };
  }

  if (workflow.status === "recording") {
    return {
      type: "SYNC",
      status: "recording",
      workflowId: workflow.id,
      tabId: storageState.activeRecordingTabId ?? workflow.tabId ?? null,
      stepCount: workflow.steps.length
    };
  }

  if (workflow.status === "paused") {
    return {
      type: "SYNC",
      status: "paused",
      workflowId: workflow.id,
      tabId: workflow.tabId ?? null,
      stepCount: workflow.steps.length
    };
  }

  return {
    type: "SYNC",
    status: workflow.steps.length > 0 ? "completedReady" : "completedEmpty",
    workflowId: workflow.id,
    tabId: null,
    stepCount: workflow.steps.length
  };
}

const recordingSessionActor = createActor(recordingSessionMachine);
recordingSessionActor.start();

export function getRecordingSessionSnapshot() {
  return recordingSessionActor.getSnapshot();
}

export function syncRecordingSessionActor(storageState: RootStorage): void {
  recordingSessionActor.send(deriveSyncState(storageState));
}

export function sendRecordingSessionEvent(event: RecordingSessionEvent): void {
  recordingSessionActor.send(event);
}
