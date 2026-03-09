// @vitest-environment jsdom

import { beforeEach, describe, expect, test } from "vitest";
import { cacheStartingValue, createTypeStep } from "./captureType.js";

describe("createTypeStep", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  test("returns a redacted typed value for sensitive fields", () => {
    const cache = new WeakMap<Element, string>();
    const input = document.createElement("input");
    input.setAttribute("autocomplete", "one-time-code");
    input.value = "111111";

    cacheStartingValue(cache, input);
    input.value = "222222";

    const step = createTypeStep(cache, input);

    expect(step?.action).toBe("type");
    expect(step?.typedValue).toBe("[redacted sensitive value]");
  });

  test("returns the actual typed value for non-sensitive fields", () => {
    const cache = new WeakMap<Element, string>();
    const input = document.createElement("input");
    input.name = "workspaceName";
    input.value = "Old value";

    cacheStartingValue(cache, input);
    input.value = "New value";

    const step = createTypeStep(cache, input);

    expect(step?.typedValue).toBe("New value");
    expect(step?.elementHtml).toContain("workspaceName");
  });
});
