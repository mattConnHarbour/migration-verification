import { SuperDoc } from "superdoc";
import "superdoc/style.css";
import "./style.css";

const params = new URLSearchParams(location.search);
const mode = params.get("mode") ?? "document";
const response = await fetch(params.get("fixture") ?? "/fixture.docx");
if (!response.ok) throw new Error(`Fixture request failed: ${response.status}`);
const data = await response.blob();

window.__verification = { ready: false, error: null, instance: null };

const documentEntry = {
  id: "verification-document",
  type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  data,
};

if (mode === "collaboration") {
  documentEntry.v2Collaboration = {
    providerType: "hocuspocus",
    documentId: params.get("documentId"),
    serverUrl: params.get("serverUrl"),
    roomMode: "join",
    syncTimeoutMs: Number(params.get("timeoutMs") ?? "180000"),
  };
}

const ready = () => {
  window.__verification.ready = true;
};

const config = {
  selector: "#editor",
  documentMode: "viewing",
  pagination: true,
  onReady: mode === "document" ? ready : undefined,
  onCollaborationReady: mode === "collaboration" ? ready : undefined,
  onContentError: ({ error }) => {
    window.__verification.error = String(error?.stack ?? error);
  },
  onException: (payload) => {
    if ("diagnosticCode" in payload) return;
    window.__verification.error = String(payload.error?.stack ?? payload.error ?? payload.message ?? payload);
  },
};

if (mode === "collaboration") config.documents = [documentEntry];
else config.document = data;

const instance = new SuperDoc(config);

window.__verification.instance = instance;
window.addEventListener("beforeunload", () => instance.destroy());
