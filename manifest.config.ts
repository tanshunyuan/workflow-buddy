import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "Workflow Buddy",
  version: "0.1.0",
  description: "Record browser workflows as LLM-ready step documents.",
  permissions: ["storage", "activeTab", "downloads", "sidePanel"],
  host_permissions: ["<all_urls>"],
  background: {
    service_worker: "src/background/index.ts"
  },
  action: {
    default_title: "Open Workflow Buddy"
  },
  side_panel: {
    default_path: "sidepanel.html"
  },
  content_scripts: [
    {
      matches: ["<all_urls>"],
      js: ["src/content/index.ts"],
      run_at: "document_idle"
    }
  ]
});
