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

// src/liveblocks.ts
var liveblocks_exports = {};
__export(liveblocks_exports, {
  createLiveblocksUpgradeAdapter: () => createLiveblocksUpgradeAdapter
});
module.exports = __toCommonJS(liveblocks_exports);

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
function isEmptyYjsUpdate(update) {
  const doc = new import_yjs.Doc();
  try {
    (0, import_yjs.applyUpdate)(doc, update);
    return (0, import_yjs.encodeStateVector)(doc).byteLength === 1;
  } catch (error) {
    throw new CollaborationUpgradeError("UPGRADE_PROVIDER_READ_FAILED", "provider returned malformed Yjs bytes", {
      stage: "provider-read",
      cause: error
    });
  } finally {
    doc.destroy();
  }
}
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

// src/liveblocks.ts
function createLiveblocksUpgradeAdapter(options) {
  validateClient(options?.client);
  const client = options.client;
  return Object.freeze({
    providerId: "liveblocks",
    evidenceTier: "hosted-persistence",
    async readSource(input) {
      const document = await readSource(client, input.sourceRoomId, "document");
      const comments = input.commentsRoomId ? await readSource(client, input.commentsRoomId, "comments") : null;
      return Object.freeze({
        snapshots: Object.freeze([document, ...comments ? [comments] : []]),
        fencingGeneration: `maintenance-${document.storageVersion}${comments ? `-${comments.storageVersion}` : ""}`,
        providerEvidence: "liveblocks:hosted-binary-read"
      });
    },
    async createTargetIfAbsent(input) {
      let disposition = "created";
      try {
        await client.createRoom(input.providerRoomName, {
          ...options.privateRoomOptions ?? {},
          // A staged target is inaccessible until the customer's activation step.
          defaultAccesses: [],
          groupsAccesses: {},
          usersAccesses: {},
          metadata: {
            ...readMetadata(options.privateRoomOptions?.metadata),
            superdocMigrationId: input.migrationId,
            superdocTargetUpdateSha256: input.updateSha256
          }
        });
      } catch (error) {
        if (!isConflict(error)) throw error;
        disposition = "already-existed";
        const room = await client.getRoom(input.providerRoomName);
        if (room.metadata?.superdocMigrationId !== input.migrationId || room.metadata?.superdocTargetUpdateSha256 !== input.updateSha256) {
          throw new CollaborationUpgradeError(
            "UPGRADE_TARGET_CONFLICT",
            "Liveblocks target room already belongs to a different migration",
            { stage: "create-target", detail: { roomId: input.providerRoomName } }
          );
        }
        const existing = normalizeBytes(await client.getYjsDocumentAsBinaryUpdate(input.providerRoomName));
        if (!isEmptyYjsUpdate(existing)) {
          return Object.freeze({
            disposition,
            storageVersion: sha256(existing),
            durabilityEvidence: "liveblocks:existing-hosted-room"
          });
        }
      }
      await client.sendYjsBinaryUpdate(input.providerRoomName, new Uint8Array(input.update));
      return Object.freeze({
        disposition,
        storageVersion: input.updateSha256,
        durabilityEvidence: "liveblocks:binary-update-accepted"
      });
    },
    async readTargetFresh(input) {
      const update = normalizeBytes(await client.getYjsDocumentAsBinaryUpdate(input.providerRoomName));
      return Object.freeze({
        update,
        storageVersion: sha256(update),
        providerEvidence: "liveblocks:fresh-hosted-binary-readback"
      });
    }
  });
}
function validateClient(client) {
  if (!client || typeof client.createRoom !== "function" || typeof client.getRoom !== "function" || typeof client.sendYjsBinaryUpdate !== "function" || typeof client.getYjsDocumentAsBinaryUpdate !== "function") {
    throw new CollaborationUpgradeError(
      "UPGRADE_PROVIDER_CONTRACT_INVALID",
      "a server-side Liveblocks client with room and Yjs binary APIs is required",
      { stage: "preflight" }
    );
  }
}
async function readSource(client, roomId, role) {
  const update = normalizeBytes(await client.getYjsDocumentAsBinaryUpdate(roomId));
  return Object.freeze({
    role,
    roomId,
    update,
    stateVector: null,
    storageVersion: sha256(update),
    sourceSchemaVersion: null
  });
}
function isConflict(error) {
  if (!error || typeof error !== "object") return false;
  const value = error;
  return value.status === 409 || value.statusCode === 409 || value.code === 409 || value.code === "ROOM_ALREADY_EXISTS";
}
function readMetadata(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...value } : {};
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  createLiveblocksUpgradeAdapter
});
