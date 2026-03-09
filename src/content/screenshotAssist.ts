import type { ScreenshotAssistResponse, ScreenshotSelection } from "../shared/types.js";

const overlayZIndex = "2147483647";
const minimumSelectionSizePx = 24;
const scrollKeys = new Set([
  " ",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "End",
  "Home",
  "PageDown",
  "PageUp"
]);

interface AssistSession {
  cancel: (message?: string) => void;
}

let activeSession: AssistSession | null = null;

export function isScreenshotAssistActive(): boolean {
  return activeSession !== null;
}

export function cancelScreenshotAssist(message = "Screenshot capture canceled."): void {
  activeSession?.cancel(message);
}

function clampToViewport(value: number, max: number): number {
  return Math.min(Math.max(value, 0), max);
}

function toSelectionRect(startX: number, startY: number, endX: number, endY: number) {
  const x = Math.min(startX, endX);
  const y = Math.min(startY, endY);
  const width = Math.abs(endX - startX);
  const height = Math.abs(endY - startY);

  return { x, y, width, height };
}

function isSelectionLargeEnough(selection: ScreenshotSelection["rect"]): boolean {
  return selection.width >= minimumSelectionSizePx && selection.height >= minimumSelectionSizePx;
}

export function beginScreenshotAssist(): Promise<ScreenshotAssistResponse> {
  if (activeSession) {
    return Promise.resolve({
      ok: false,
      error: "A screenshot capture is already in progress."
    });
  }

  const root = document.documentElement;
  if (!root) {
    return Promise.resolve({
      ok: false,
      error: "This page is not ready for screenshot capture."
    });
  }

  return new Promise((resolve) => {
    const host = document.createElement("div");
    host.setAttribute("data-workflow-buddy-screenshot-assist", "true");
    host.style.position = "fixed";
    host.style.inset = "0";
    host.style.zIndex = overlayZIndex;
    host.style.pointerEvents = "auto";

    const shadowRoot = host.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = `
      :host {
        all: initial;
      }

      .overlay {
        position: fixed;
        inset: 0;
        cursor: crosshair;
        background: rgba(24, 18, 13, 0.14);
        pointer-events: auto;
        user-select: none;
      }

      .selection {
        position: absolute;
        border: 2px solid rgba(218, 108, 67, 0.95);
        background: rgba(218, 108, 67, 0.12);
        box-shadow: 0 0 0 1px rgba(255, 250, 244, 0.8) inset;
        display: none;
      }

      .hud {
        position: fixed;
        left: 16px;
        bottom: 16px;
        max-width: min(320px, calc(100vw - 32px));
        border: 1px solid rgba(91, 75, 58, 0.28);
        border-radius: 12px;
        padding: 12px 14px;
        background: rgba(255, 251, 246, 0.96);
        color: rgb(62, 46, 31);
        box-shadow: 0 18px 45px rgba(33, 23, 13, 0.2);
        font-family: "IBM Plex Mono", ui-monospace, SFMono-Regular, monospace;
      }

      .title {
        margin: 0 0 6px;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }

      .body {
        margin: 0;
        font-size: 11px;
        line-height: 1.5;
      }

      .hint {
        margin-top: 8px;
        color: rgba(62, 46, 31, 0.72);
      }
    `;

    const overlay = document.createElement("div");
    overlay.className = "overlay";

    const selectionBox = document.createElement("div");
    selectionBox.className = "selection";

    const hud = document.createElement("div");
    hud.className = "hud";

    const title = document.createElement("p");
    title.className = "title";
    title.textContent = "Capture Area";

    const body = document.createElement("p");
    body.className = "body";
    body.textContent = "Drag a region in the page to attach a screenshot to this step.";

    const hint = document.createElement("p");
    hint.className = "body hint";
    hint.textContent = "Esc cancels. Minimum selection is 24 x 24 pixels.";

    hud.append(title, body, hint);
    overlay.append(selectionBox, hud);
    shadowRoot.append(style, overlay);
    root.append(host);

    let startX = 0;
    let startY = 0;
    let isDragging = false;

    function updateSelectionBox(selection: ScreenshotSelection["rect"] | null): void {
      if (!selection) {
        selectionBox.style.display = "none";
        return;
      }

      selectionBox.style.display = "block";
      selectionBox.style.left = `${selection.x}px`;
      selectionBox.style.top = `${selection.y}px`;
      selectionBox.style.width = `${selection.width}px`;
      selectionBox.style.height = `${selection.height}px`;
    }

    function cleanup(): void {
      window.removeEventListener("blur", handleWindowBlur, true);
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("wheel", preventScroll, { capture: true });
      window.removeEventListener("touchmove", preventScroll, { capture: true });
      window.removeEventListener("scroll", handleScroll, true);
      host.remove();
      activeSession = null;
    }

    function finish(result: ScreenshotAssistResponse): void {
      cleanup();
      resolve(result);
    }

    function cancel(message = "Screenshot capture canceled."): void {
      finish({ ok: false, error: message, canceled: true });
    }

    function commit(selection: ScreenshotSelection["rect"]): void {
      if (!isSelectionLargeEnough(selection)) {
        body.textContent = "The selected area is too small. Drag a larger region.";
        hud.style.display = "block";
        updateSelectionBox(null);
        return;
      }

      hud.style.display = "none";
      finish({
        ok: true,
        selection: {
          rect: selection,
          viewport: {
            width: window.innerWidth,
            height: window.innerHeight,
            devicePixelRatio: window.devicePixelRatio || 1
          }
        }
      });
    }

    function handlePointerDown(event: PointerEvent): void {
      if (event.button !== 0) return;

      isDragging = true;
      startX = clampToViewport(event.clientX, window.innerWidth);
      startY = clampToViewport(event.clientY, window.innerHeight);
      updateSelectionBox({
        x: startX,
        y: startY,
        width: 0,
        height: 0
      });

      hud.style.display = "none";
      body.textContent = "Release to capture the selected area.";
      overlay.setPointerCapture(event.pointerId);
      event.preventDefault();
    }

    function handlePointerMove(event: PointerEvent): void {
      if (!isDragging) return;

      const currentX = clampToViewport(event.clientX, window.innerWidth);
      const currentY = clampToViewport(event.clientY, window.innerHeight);
      updateSelectionBox(toSelectionRect(startX, startY, currentX, currentY));
      event.preventDefault();
    }

    function handlePointerUp(event: PointerEvent): void {
      if (!isDragging) return;

      isDragging = false;
      const endX = clampToViewport(event.clientX, window.innerWidth);
      const endY = clampToViewport(event.clientY, window.innerHeight);
      overlay.releasePointerCapture(event.pointerId);
      event.preventDefault();
      commit(toSelectionRect(startX, startY, endX, endY));
    }

    function handleWindowBlur(): void {
      cancel("Screenshot capture canceled because the tab lost focus.");
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        cancel();
        return;
      }

      if (scrollKeys.has(event.key)) {
        event.preventDefault();
      }
    }

    function preventScroll(event: Event): void {
      event.preventDefault();
    }

    function handleScroll(): void {
      cancel("Screenshot capture canceled because the page scrolled.");
    }

    activeSession = { cancel };

    overlay.addEventListener("pointerdown", handlePointerDown);
    overlay.addEventListener("pointermove", handlePointerMove);
    overlay.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("blur", handleWindowBlur, true);
    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("wheel", preventScroll, { capture: true, passive: false });
    window.addEventListener("touchmove", preventScroll, { capture: true, passive: false });
    window.addEventListener("scroll", handleScroll, true);
  });
}
