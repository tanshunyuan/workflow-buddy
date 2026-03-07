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

export function getElementHtml(element: Element): string {
  return element.outerHTML;
}

export function getFieldValue(element: HTMLInputElement | HTMLTextAreaElement): string {
  return element.value;
}
