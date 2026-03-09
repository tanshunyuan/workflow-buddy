type InlineAnnotationRequest = {
  targetLabel: string;
  anchorElement: Element | null;
  initialValue?: string;
  onSave: (description: string) => Promise<void> | void;
  onCancel: () => void;
};

type InlineAnnotationControls = {
  host: HTMLDivElement;
  dialog: HTMLDivElement;
  highlight: HTMLDivElement;
  title: HTMLParagraphElement;
  textarea: HTMLTextAreaElement;
  saveButton: HTMLButtonElement;
  cancelButton: HTMLButtonElement;
};

const hostId = "__workflowBuddyInlineAnnotationHost__";
let controls: InlineAnnotationControls | null = null;
let activeRequest: InlineAnnotationRequest | null = null;
let activeAnchorElement: Element | null = null;
let isSaving = false;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function ensureControls(): InlineAnnotationControls {
  if (controls) return controls;

  const host = document.createElement("div");
  host.id = hostId;
  host.setAttribute("data-workflow-buddy-inline-annotation", "true");
  host.setAttribute("data-workflow-buddy-inline-annotation-host", "true");
  const shadow = host.attachShadow({ mode: "open" });

  shadow.innerHTML = `
    <style>
      :host {
        all: initial;
      }

      .layer {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        pointer-events: none;
      }

      .highlight {
        position: fixed;
        border: 2px solid rgba(218, 108, 67, 0.92);
        background: rgba(218, 108, 67, 0.08);
        border-radius: 10px;
        box-shadow: 0 0 0 1px rgba(255, 247, 236, 0.75) inset;
      }

      .dialog {
        position: fixed;
        width: min(320px, calc(100vw - 24px));
        pointer-events: auto;
        border-radius: 16px;
        border: 1px solid rgba(41, 30, 23, 0.18);
        background: rgba(24, 21, 19, 0.96);
        box-shadow: 0 18px 44px rgba(10, 8, 7, 0.28);
        color: #f8efe3;
        padding: 14px;
        font-family: "IBM Plex Mono", ui-monospace, SFMono-Regular, monospace;
      }

      .eyebrow {
        margin: 0 0 6px;
        font-size: 10px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: rgba(248, 239, 227, 0.58);
      }

      .title {
        margin: 0 0 10px;
        font-size: 12px;
        line-height: 1.45;
        color: rgba(248, 239, 227, 0.92);
      }

      .textarea {
        width: 100%;
        min-height: 88px;
        resize: vertical;
        border-radius: 10px;
        border: 1px solid rgba(218, 108, 67, 0.48);
        background: rgba(255, 252, 247, 0.05);
        color: #fff7ec;
        padding: 10px 11px;
        font: 400 13px/1.5 "Lora", Georgia, serif;
        box-sizing: border-box;
        outline: none;
      }

      .textarea::placeholder {
        color: rgba(248, 239, 227, 0.4);
      }

      .textarea:focus {
        border-color: rgba(218, 108, 67, 0.9);
        box-shadow: 0 0 0 3px rgba(218, 108, 67, 0.16);
      }

      .actions {
        margin-top: 12px;
        display: flex;
        justify-content: flex-end;
        gap: 10px;
      }

      .button {
        pointer-events: auto;
        border: 0;
        border-radius: 999px;
        padding: 9px 14px;
        font: 600 12px/1 "IBM Plex Mono", ui-monospace, SFMono-Regular, monospace;
        cursor: pointer;
      }

      .button:disabled {
        opacity: 0.45;
        cursor: default;
      }

      .cancel {
        background: transparent;
        color: rgba(248, 239, 227, 0.7);
      }

      .save {
        background: #3d74d8;
        color: white;
      }
    </style>
    <div class="layer">
      <div class="highlight" hidden></div>
      <div class="dialog" hidden>
        <p class="eyebrow">Captured Step</p>
        <p class="title"></p>
        <textarea class="textarea" placeholder="What is this step doing and why?"></textarea>
        <div class="actions">
          <button class="button cancel" type="button">Cancel</button>
          <button class="button save" type="button" disabled>Save</button>
        </div>
      </div>
    </div>
  `;

  const dialog = shadow.querySelector(".dialog");
  const highlight = shadow.querySelector(".highlight");
  const title = shadow.querySelector(".title");
  const textarea = shadow.querySelector(".textarea");
  const saveButton = shadow.querySelector(".save");
  const cancelButton = shadow.querySelector(".cancel");

  if (
    !(dialog instanceof HTMLDivElement) ||
    !(highlight instanceof HTMLDivElement) ||
    !(title instanceof HTMLParagraphElement) ||
    !(textarea instanceof HTMLTextAreaElement) ||
    !(saveButton instanceof HTMLButtonElement) ||
    !(cancelButton instanceof HTMLButtonElement)
  ) {
    throw new Error("Inline annotation UI could not be initialized.");
  }

  dialog.addEventListener("click", (event) => event.stopPropagation());
  dialog.addEventListener("pointerdown", (event) => event.stopPropagation());

  textarea.addEventListener("input", () => {
    saveButton.disabled = textarea.value.trim().length === 0 || isSaving;
  });

  textarea.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      activeRequest?.onCancel();
      hideInlineAnnotationEditor();
      return;
    }

    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      saveButton.click();
    }
  });

  cancelButton.addEventListener("click", () => {
    activeRequest?.onCancel();
    hideInlineAnnotationEditor();
  });

  saveButton.addEventListener("click", () => {
    if (!activeRequest || isSaving) return;

    const description = textarea.value.trim();
    if (!description) return;

    isSaving = true;
    saveButton.disabled = true;
    cancelButton.disabled = true;

    Promise.resolve(activeRequest.onSave(description))
      .then(() => {
        hideInlineAnnotationEditor();
      })
      .catch(() => {
        saveButton.disabled = false;
      })
      .finally(() => {
        isSaving = false;
        cancelButton.disabled = false;
      });
  });

  document.documentElement.appendChild(host);

  controls = { host, dialog, highlight, title, textarea, saveButton, cancelButton };
  return controls;
}

function positionInlineAnnotation(): void {
  if (!controls || !activeAnchorElement) return;

  const rect = activeAnchorElement.getBoundingClientRect();
  const hasSize = rect.width > 0 && rect.height > 0;

  if (!hasSize) {
    controls.highlight.hidden = true;
    return;
  }

  controls.highlight.hidden = false;
  controls.highlight.style.left = `${rect.left}px`;
  controls.highlight.style.top = `${rect.top}px`;
  controls.highlight.style.width = `${rect.width}px`;
  controls.highlight.style.height = `${rect.height}px`;

  const dialogWidth = Math.min(320, window.innerWidth - 24);
  const estimatedHeight = 190;
  const horizontalCenter = rect.left + rect.width / 2 - dialogWidth / 2;
  const left = clamp(horizontalCenter, 12, Math.max(12, window.innerWidth - dialogWidth - 12));
  const roomBelow = window.innerHeight - rect.bottom;
  const top =
    roomBelow >= estimatedHeight + 16
      ? rect.bottom + 12
      : Math.max(12, rect.top - estimatedHeight - 12);

  controls.dialog.style.left = `${left}px`;
  controls.dialog.style.top = `${top}px`;
}

function handleViewportUpdate(): void {
  positionInlineAnnotation();
}

export function showInlineAnnotationEditor(request: InlineAnnotationRequest): void {
  const nextControls = ensureControls();

  activeRequest = request;
  activeAnchorElement = request.anchorElement;
  isSaving = false;

  nextControls.title.textContent = request.targetLabel;
  nextControls.textarea.value = request.initialValue ?? "";
  nextControls.saveButton.disabled = nextControls.textarea.value.trim().length === 0;
  nextControls.cancelButton.disabled = false;
  nextControls.dialog.hidden = false;
  positionInlineAnnotation();

  window.addEventListener("scroll", handleViewportUpdate, true);
  window.addEventListener("resize", handleViewportUpdate);

  window.setTimeout(() => {
    nextControls.textarea.focus();
    nextControls.textarea.selectionStart = nextControls.textarea.value.length;
    nextControls.textarea.selectionEnd = nextControls.textarea.value.length;
  }, 0);
}

export function hideInlineAnnotationEditor(): void {
  if (!controls) return;

  window.removeEventListener("scroll", handleViewportUpdate, true);
  window.removeEventListener("resize", handleViewportUpdate);

  controls.dialog.hidden = true;
  controls.highlight.hidden = true;
  controls.textarea.value = "";
  controls.saveButton.disabled = true;
  controls.cancelButton.disabled = false;

  activeRequest = null;
  activeAnchorElement = null;
  isSaving = false;
}

export function isInlineAnnotationEditorOpen(): boolean {
  return Boolean(activeRequest);
}

export function isInlineAnnotationEvent(event: Event): boolean {
  return Boolean(controls && event.composedPath().includes(controls.host));
}
