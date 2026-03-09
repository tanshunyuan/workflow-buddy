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

function getSemanticRole(element: Element): string {
  const explicitRole = normalizeFingerprintText(element.getAttribute("role"));
  if (explicitRole) return explicitRole;

  const tag = element.tagName.toLowerCase();
  if (tag === "a" && element.hasAttribute("href")) return "link";
  if (tag === "button") return "button";
  if (tag === "select") return "select";
  if (tag === "textarea") return "textarea";
  if (tag === "label") return "label";

  if (element instanceof HTMLInputElement) {
    return normalizeFingerprintText(element.type) || "input";
  }

  return tag;
}

export function isSameClickCaptureTarget(originalElement: Element, candidateElement: Element): boolean {
  if (originalElement === candidateElement) {
    return true;
  }

  if (originalElement.contains(candidateElement) || candidateElement.contains(originalElement)) {
    return true;
  }

  const originalFingerprint = getClickFingerprint(originalElement);
  const candidateFingerprint = getClickFingerprint(candidateElement);
  if (originalFingerprint === candidateFingerprint) {
    return true;
  }

  const originalRole = getSemanticRole(originalElement);
  const candidateRole = getSemanticRole(candidateElement);

  if (originalRole !== candidateRole) {
    return false;
  }

  const originalText = normalizeFingerprintText(originalElement.textContent);
  const candidateText = normalizeFingerprintText(candidateElement.textContent);
  if (originalText && candidateText && originalText === candidateText) {
    return true;
  }

  const originalAriaLabel = normalizeFingerprintText(originalElement.getAttribute("aria-label"));
  const candidateAriaLabel = normalizeFingerprintText(candidateElement.getAttribute("aria-label"));
  if (originalAriaLabel && candidateAriaLabel && originalAriaLabel === candidateAriaLabel) {
    return true;
  }

  return false;
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
