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

export function resolveClickCaptureElement(event: MouseEvent): Element | null {
  const candidates: Element[] = [];
  const pointElement = document.elementFromPoint(event.clientX, event.clientY);
  if (pointElement instanceof Element) {
    candidates.push(pointElement);
  }

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

export function getElementHtml(element: Element): string {
  return element.outerHTML;
}

export function getFieldValue(element: HTMLInputElement | HTMLTextAreaElement): string {
  return element.value;
}
