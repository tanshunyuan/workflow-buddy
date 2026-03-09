import JSZip from "jszip";
import { describe, expect, test } from "vitest";
import { MarkdownZipExporter } from "./markdownZipExporter.js";

describe("MarkdownZipExporter", () => {
  test("writes workflow markdown and screenshot assets into the zip bundle", async () => {
    const exporter = new MarkdownZipExporter();
    const artifact = await exporter.export(
      {
        id: "wf_1",
        name: "Login Flow",
        status: "completed",
        createdAt: "2026-03-09T00:00:00.000Z",
        updatedAt: "2026-03-09T00:00:00.000Z",
        steps: [
          {
            id: "step_1",
            index: 1,
            action: "click",
            timestamp: "2026-03-09T00:00:00.000Z",
            pageUrl: "https://example.com/login",
            elementHtml: "<button>Sign in</button>",
            description: "Submit the login form.",
            screenshotId: "shot_1"
          }
        ]
      },
      {
        shot_1: {
          id: "shot_1",
          name: "step-01.png",
          mimeType: "image/png",
          dataUrl: "data:image/png;base64,AA==",
          createdAt: "2026-03-09T00:00:00.000Z"
        }
      }
    );

    const zip = await JSZip.loadAsync(artifact.bytes);
    const markdown = await zip.file("workflow.md")?.async("string");

    expect(artifact.filename).toBe("login-flow.zip");
    expect(markdown).toContain("![Step 1 screenshot](./images/step-01.png)");
    expect(zip.file("images/step-01.png")).toBeTruthy();
  });
});
