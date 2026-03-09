import { describe, expect, test } from "vitest";
import { rootStorageSchema } from "../shared/schemas.js";
import { deleteWorkflowFromState } from "./storage.js";

function createState() {
  return rootStorageSchema.parse({
    currentWorkflowId: "wf_current",
    activeRecordingTabId: 42,
    screenshotsById: {
      shot_orphan: {
        id: "shot_orphan",
        name: "orphan.png",
        mimeType: "image/png",
        dataUrl: "data:image/png;base64,AA==",
        createdAt: "2026-03-09T00:00:00.000Z"
      },
      shot_shared: {
        id: "shot_shared",
        name: "shared.png",
        mimeType: "image/png",
        dataUrl: "data:image/png;base64,AA==",
        createdAt: "2026-03-09T00:00:00.000Z"
      }
    },
    workflowsById: {
      wf_current: {
        id: "wf_current",
        name: "Current Workflow",
        status: "completed",
        createdAt: "2026-03-09T00:00:00.000Z",
        updatedAt: "2026-03-09T00:00:00.000Z",
        tabId: 42,
        steps: [
          {
            id: "step_1",
            index: 1,
            action: "click",
            timestamp: "2026-03-09T00:00:00.000Z",
            pageUrl: "https://example.com",
            elementHtml: "<button>Save</button>",
            description: "",
            screenshotId: "shot_orphan"
          },
          {
            id: "step_2",
            index: 2,
            action: "click",
            timestamp: "2026-03-09T00:01:00.000Z",
            pageUrl: "https://example.com",
            elementHtml: "<button>Next</button>",
            description: "",
            screenshotId: "shot_shared"
          }
        ]
      },
      wf_other: {
        id: "wf_other",
        name: "Other Workflow",
        status: "completed",
        createdAt: "2026-03-09T00:00:00.000Z",
        updatedAt: "2026-03-09T00:00:00.000Z",
        steps: [
          {
            id: "step_3",
            index: 1,
            action: "click",
            timestamp: "2026-03-09T00:02:00.000Z",
            pageUrl: "https://example.com",
            elementHtml: "<button>Keep</button>",
            description: "",
            screenshotId: "shot_shared"
          }
        ]
      }
    }
  });
}

describe("deleteWorkflowFromState", () => {
  test("clears the active workflow pointer and removes orphaned screenshots", () => {
    const nextState = deleteWorkflowFromState(createState(), "wf_current");

    expect(nextState.currentWorkflowId).toBeNull();
    expect(nextState.activeRecordingTabId).toBeNull();
    expect(nextState.workflowsById.wf_current).toBeUndefined();
    expect(nextState.screenshotsById.shot_orphan).toBeUndefined();
  });

  test("keeps screenshots that are still referenced by another workflow", () => {
    const nextState = deleteWorkflowFromState(createState(), "wf_current");

    expect(nextState.workflowsById.wf_other).toBeDefined();
    expect(nextState.screenshotsById.shot_shared).toBeDefined();
  });
});
