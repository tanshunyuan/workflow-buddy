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

export function getClickCaptureElement(target: Element): Element {
  const label = target.closest("label");
  if (label) return label;

  return target.closest(interactiveClickSelector) ?? target;
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
