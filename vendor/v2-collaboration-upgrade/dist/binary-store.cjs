const __superdocUpgradeModuleUrl = require("node:url").pathToFileURL(__filename).href;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/binary-store.ts
var binary_store_exports = {};
__export(binary_store_exports, {
  createBinaryStoreUpgradeAdapter: () => createBinaryStoreUpgradeAdapter
});
module.exports = __toCommonJS(binary_store_exports);

// src/errors.ts
var CollaborationUpgradeError = class extends Error {
  code;
  stage;
  detail;
  resume;
  constructor(code, message, options = {}) {
    super(message, options.cause === void 0 ? void 0 : { cause: options.cause });
    this.name = "CollaborationUpgradeError";
    this.code = code;
    this.stage = options.stage ?? "preflight";
    this.detail = Object.freeze({ ...options.detail ?? {} });
    this.resume = options.resume ? Object.freeze({ ...options.resume }) : null;
  }
};

// src/provider-utils.ts
var import_node_crypto = require("crypto");
var import_yjs = require("yjs");
function sha256(bytes) {
  return (0, import_node_crypto.createHash)("sha256").update(bytes).digest("hex");
}
function normalizeBytes(value) {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  throw new CollaborationUpgradeError("UPGRADE_PROVIDER_READ_FAILED", "provider did not return binary Yjs data", {
    stage: "provider-read"
  });
}

// src/binary-store.ts
function createBinaryStoreUpgradeAdapter(options) {
  if (typeof options?.read !== "function" || typeof options?.create !== "function") {
    throw new CollaborationUpgradeError(
      "UPGRADE_PROVIDER_CONTRACT_INVALID",
      "binary-store read and atomic create callbacks are required",
      { stage: "preflight" }
    );
  }
  const providerId = options.providerId ?? "binary-store";
  return Object.freeze({
    providerId,
    evidenceTier: "authoritative-persistence",
    async readSource(input) {
      const document = await readRequired(options, input.sourceRoomId, true, "document");
      const comments = input.commentsRoomId ? await readRequired(options, input.commentsRoomId, true, "comments") : null;
      return Object.freeze({
        snapshots: Object.freeze([
          toSourceSnapshot("document", input.sourceRoomId, document),
          ...comments ? [toSourceSnapshot("comments", input.commentsRoomId, comments)] : []
        ]),
        ...document.capturedAt ? { capturedAt: document.capturedAt } : {},
        fencingGeneration: `maintenance-${document.storageVersion}${comments ? `-${comments.storageVersion}` : ""}`,
        providerEvidence: document.providerEvidence ?? `${providerId}:authoritative-read`
      });
    },
    async createTargetIfAbsent(input) {
      const raw = await options.create(input.providerRoomName, new Uint8Array(input.update), {
        migrationId: input.migrationId,
        updateSha256: input.updateSha256
      });
      const result = typeof raw === "string" ? { disposition: raw } : raw;
      if (!result || result.disposition !== "created" && result.disposition !== "already-existed") {
        throw new CollaborationUpgradeError(
          "UPGRADE_PROVIDER_CONTRACT_INVALID",
          "binary-store create returned an invalid disposition",
          { stage: "create-target" }
        );
      }
      return Object.freeze({
        disposition: result.disposition,
        storageVersion: result.storageVersion ?? input.updateSha256,
        durabilityEvidence: result.durabilityEvidence ?? `${providerId}:atomic-create`
      });
    },
    async readTargetFresh(input) {
      const target = await readRequired(options, input.providerRoomName, true, "target");
      return Object.freeze({
        update: new Uint8Array(target.update),
        storageVersion: target.storageVersion,
        providerEvidence: target.providerEvidence ?? `${providerId}:fresh-authoritative-read`
      });
    }
  });
}
async function readRequired(options, roomId, fresh, role) {
  const raw = await options.read(roomId, { fresh, role });
  if (raw === null) {
    throw new CollaborationUpgradeError("UPGRADE_PROVIDER_READ_FAILED", `room does not exist: ${roomId}`, {
      stage: role === "target" ? "read-target" : "read-source"
    });
  }
  if (raw instanceof Uint8Array || raw instanceof ArrayBuffer) {
    const update2 = normalizeBytes(raw);
    return {
      update: update2,
      stateVector: null,
      storageVersion: sha256(update2),
      sourceSchemaVersion: null
    };
  }
  if (!raw || !(raw.update instanceof Uint8Array)) {
    throw new CollaborationUpgradeError("UPGRADE_PROVIDER_READ_FAILED", "binary-store read returned invalid bytes", {
      stage: role === "target" ? "read-target" : "read-source"
    });
  }
  const update = new Uint8Array(raw.update);
  return {
    update,
    stateVector: raw.stateVector ? new Uint8Array(raw.stateVector) : null,
    storageVersion: raw.storageVersion ?? sha256(update),
    ...raw.capturedAt ? { capturedAt: raw.capturedAt } : {},
    sourceSchemaVersion: raw.sourceSchemaVersion ?? null,
    ...raw.providerEvidence ? { providerEvidence: raw.providerEvidence } : {}
  };
}
function toSourceSnapshot(role, roomId, read) {
  return Object.freeze({
    role,
    roomId,
    update: new Uint8Array(read.update),
    stateVector: read.stateVector ? new Uint8Array(read.stateVector) : null,
    storageVersion: read.storageVersion,
    sourceSchemaVersion: read.sourceSchemaVersion
  });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  createBinaryStoreUpgradeAdapter
});
