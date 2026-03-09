export function isElement(target: EventTarget | null): target is Element {
  return target instanceof Element;
}

export function isTextEntryTarget(
  target: EventTarget | null
): target is HTMLInputElement | HTMLTextAreaElement {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}

export function isPasswordInput(element: Element): boolean {
  return element instanceof HTMLInputElement && element.type === "password";
}

const interactiveClickSelector = [
  "button",
  "label",
  "a[href]",
  "input:not([type='hidden'])",
  "select",
  "textarea",
  "[role='button']",
  "[role='link']",
  "[role='radio']",
  "[role='tab']",
  "[role='checkbox']",
  "[role='menuitem']"
].join(", ");

const blockedInteractiveSelector = [
  interactiveClickSelector,
  "[onclick]",
  "[contenteditable='true']",
  "[contenteditable='']"
].join(", ");

const workflowBuddyUiSelector = [
  "[data-workflow-buddy-inline-annotation='true']",
  "[data-workflow-buddy-inline-annotation-host='true']"
].join(", ");

export function getElementLabel(element: Element): string {
  const tag = element.tagName.toLowerCase();
  const ariaLabel = element.getAttribute("aria-label")?.trim();
  const textContent = element.textContent?.replace(/\s+/g, " ").trim() ?? "";

  if (tag === "button") {
    return ariaLabel || (textContent ? `Button: ${textContent.slice(0, 48)}` : "Button");
  }

  if (tag === "a") {
    if (ariaLabel) return ariaLabel;
    if (textContent) return `Link: ${textContent.slice(0, 48)}`;
    const href = element.getAttribute("href");
    return href ? `Link: ${href.slice(0, 48)}` : "Link";
  }

  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return (
      ariaLabel ||
      element.labels?.[0]?.textContent?.replace(/\s+/g, " ").trim() ||
      element.placeholder ||
      element.name ||
      `${element.type || "text"} input`
    );
  }

  if (tag === "label") {
    return textContent ? `Label: ${textContent.slice(0, 48)}` : "Label";
  }

  if (tag === "p") {
    return textContent ? `Paragraph: ${textContent.slice(0, 48)}` : "Paragraph";
  }

  if (ariaLabel) return ariaLabel;
  if (textContent) return `${tag}: ${textContent.slice(0, 48)}`;

  return tag;
}

export function getBlockedInteractiveElement(target: EventTarget | null): Element | null {
  if (!(target instanceof Element)) return null;
  return target.closest(blockedInteractiveSelector);
}

export function isWorkflowBuddyUiElement(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(workflowBuddyUiSelector) !== null;
}

const transientClickCaptureSelector = [".ant-wave", ".wave-motion", ".wave-motion-appear", ".wave-motion-appear-active"].join(
  ", "
);

const broadContainerSelector = ["[role='radiogroup']", ".ant-radio-group", ".ant-segmented", "[role='tablist']"].join(", ");

function isBroadClickContainer(element: Element): boolean {
  if (element.matches(broadContainerSelector)) return true;

  const interactiveDescendantCount = element.querySelectorAll(interactiveClickSelector).length;
  return interactiveDescendantCount > 1 && !element.matches(interactiveClickSelector);
}

function resolveCandidateCaptureElement(candidate: Element): Element | null {
  if (isWorkflowBuddyUiElement(candidate)) {
    return null;
  }

  const label = candidate.closest("label");
  if (label) return label;

  const interactiveAncestor = candidate.closest(interactiveClickSelector);
  if (interactiveAncestor && !isBroadClickContainer(interactiveAncestor)) {
    return interactiveAncestor;
  }

  if (!isBroadClickContainer(candidate)) {
    return candidate;
  }

  return null;
}

export function getClickCaptureElement(target: Element): Element | null {
  return resolveCandidateCaptureElement(target);
}

export function resolveClickCaptureElementAtPoint(clientX: number, clientY: number): Element | null {
  const pointCandidates = document.elementsFromPoint(clientX, clientY);

  for (const candidate of pointCandidates) {
    const captureElement = resolveCandidateCaptureElement(candidate);
    if (captureElement) {
      return captureElement;
    }
  }

  return null;
}

export function resolveClickCaptureElement(event: MouseEvent): Element | null {
  const candidates: Element[] = [];
  candidates.push(...document.elementsFromPoint(event.clientX, event.clientY));

  if (isElement(event.target)) {
    candidates.push(event.target);
  }

  for (const pathEntry of event.composedPath()) {
    if (pathEntry instanceof Element) {
      candidates.push(pathEntry);
    }
  }

  for (const candidate of candidates) {
    const captureElement = resolveCandidateCaptureElement(candidate);
    if (captureElement) {
      return captureElement;
    }
  }

  return null;
}

function isTransientWrapper(parent: Element, child: Element, root: Element): boolean {
  return (
    parent !== root &&
    parent.firstElementChild === child &&
    parent.childElementCount === 1 &&
    parent.textContent?.trim() === "" &&
    Array.from(parent.attributes).every((attribute) => attribute.name === "style" || attribute.name.startsWith("data-"))
  );
}

export function getCapturedElementHtml(element: Element): string {
  if (isWorkflowBuddyUiElement(element)) {
    return "";
  }

  const clone = element.cloneNode(true);
  if (!(clone instanceof Element)) {
    return element.outerHTML;
  }

  const transientNodes = Array.from(clone.querySelectorAll(transientClickCaptureSelector));
  for (const transientNode of transientNodes) {
    let removalTarget: Element = transientNode;

    while (removalTarget.parentElement && isTransientWrapper(removalTarget.parentElement, removalTarget, clone)) {
      removalTarget = removalTarget.parentElement;
    }

    removalTarget.remove();
  }

  return clone.outerHTML;
}

function normalizeFingerprintText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function getElementFingerprintPath(element: Element, maxDepth = 4): string {
  const parts: string[] = [];
  let current: Element | null = element;
  let depth = 0;

  while (current && depth < maxDepth) {
    const tag = current.tagName.toLowerCase();
    if (tag === "html" || tag === "body") break;

    const segmentParts = [tag];
    const role = normalizeFingerprintText(current.getAttribute("role"));
    const id = normalizeFingerprintText(current.getAttribute("id"));
    const name = normalizeFingerprintText(current.getAttribute("name"));
    const testId = normalizeFingerprintText(current.getAttribute("data-testid"));

    if (role) segmentParts.push(`role=${role}`);
    if (id) segmentParts.push(`id=${id}`);
    if (name) segmentParts.push(`name=${name}`);
    if (testId) segmentParts.push(`testid=${testId}`);

    parts.unshift(segmentParts.join(":"));
    current = current.parentElement;
    depth += 1;
  }

  return parts.join(">");
}

function getChoiceControlFingerprint(element: Element): string | null {
  const choiceControl =
    element.matches("input[type='radio'], input[type='checkbox']")
      ? element
      : element.querySelector("input[type='radio'], input[type='checkbox']");

  if (!(choiceControl instanceof HTMLInputElement)) {
    return null;
  }

  const parts = [
    `control=${choiceControl.type}`,
    `name=${normalizeFingerprintText(choiceControl.name)}`,
    `value=${normalizeFingerprintText(choiceControl.value)}`,
    `label=${normalizeFingerprintText(element.textContent)}`
  ].filter((part) => !part.endsWith("="));

  return parts.join("|");
}

export function getClickFingerprint(element: Element): string {
  const tag = element.tagName.toLowerCase();
  const ariaLabel = normalizeFingerprintText(element.getAttribute("aria-label"));
  const role = normalizeFingerprintText(element.getAttribute("role"));
  const text = normalizeFingerprintText(element.textContent);
  const path = getElementFingerprintPath(element);
  const parts = [`tag=${tag}`];

  const choiceFingerprint = getChoiceControlFingerprint(element);
  if (choiceFingerprint) {
    parts.push(choiceFingerprint);
  } else if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    parts.push(`type=${normalizeFingerprintText(element.type)}`);
    parts.push(`name=${normalizeFingerprintText(element.name)}`);
    parts.push(`placeholder=${normalizeFingerprintText(element.placeholder)}`);
  } else {
    const href = normalizeFingerprintText(element.getAttribute("href"));
    if (href) parts.push(`href=${href}`);
  }

  if (role) parts.push(`role=${role}`);
  if (ariaLabel) parts.push(`aria=${ariaLabel}`);
  if (text) parts.push(`text=${text}`);
  if (path) parts.push(`path=${path}`);

  return parts.join("|");
}

export function getElementHtml(element: Element): string {
  return element.outerHTML;
}

export function getFieldValue(element: HTMLInputElement | HTMLTextAreaElement): string {
  return element.value;
}
