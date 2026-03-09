// @vitest-environment jsdom

import { describe, expect, test } from "vitest";
import { getCapturedElementHtml, sanitizeTypedValueForCapture, shouldRedactTypedValue } from "./dom.js";

describe("DOM capture helpers", () => {
  test("removes transient click-capture markup from exported html", () => {
    document.body.innerHTML = `
      <button id="save-button">
        <span data-temp="true" style="display:block">
          <span class="ant-wave"></span>
        </span>
        <span>Save</span>
      </button>
    `;

    const button = document.getElementById("save-button");
    expect(button).toBeTruthy();

    const html = getCapturedElementHtml(button!);

    expect(html).toContain("<button");
    expect(html).toContain("Save");
    expect(html).not.toContain("ant-wave");
    expect(html).not.toContain("data-temp=");
  });

  test("redacts values from sensitive text-entry fields", () => {
    const input = document.createElement("input");
    input.name = "otp_code";
    input.value = "123456";

    expect(shouldRedactTypedValue(input)).toBe(true);
    expect(sanitizeTypedValueForCapture(input, input.value)).toBe("[redacted sensitive value]");
  });

  test("keeps values for ordinary text-entry fields", () => {
    const input = document.createElement("input");
    input.name = "projectName";
    input.value = "Workflow Buddy";

    expect(shouldRedactTypedValue(input)).toBe(false);
    expect(sanitizeTypedValueForCapture(input, input.value)).toBe("Workflow Buddy");
  });
});
