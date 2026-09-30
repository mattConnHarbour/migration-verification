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

// src/hocuspocus.ts
var hocuspocus_exports = {};
__export(hocuspocus_exports, {
  createHocuspocusUpgradeAdapter: () => createHocuspocusUpgradeAdapter
});
module.exports = __toCommonJS(hocuspocus_exports);
var import_yjs2 = require("yjs");

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
function createSyncedYjsUpgradeAdapter(config) {
  return Object.freeze({
    providerId: config.providerId,
    evidenceTier: "synchronized-provider",
    async readSource(input) {
      const document = await readYjsRoom(config, input.sourceRoomId, "document");
      const snapshots = [document];
      if (input.commentsRoomId) snapshots.push(await readYjsRoom(config, input.commentsRoomId, "comments"));
      return Object.freeze({
        snapshots: Object.freeze(snapshots),
        fencingGeneration: `maintenance-${snapshots.map((snapshot) => snapshot.storageVersion).join("-")}`,
        providerEvidence: `${config.providerId}:fresh-sync`
      });
    },
    async createTargetIfAbsent(input) {
      const connection = await config.connect(input.providerRoomName);
      try {
        const existing = (0, import_yjs.encodeStateAsUpdate)(connection.doc);
        if (!isEmptyYjsUpdate(existing)) {
          return Object.freeze({
            disposition: "already-existed",
            storageVersion: sha256(existing),
            durabilityEvidence: `${config.providerId}:existing-room-sync`
          });
        }
        (0, import_yjs.applyUpdate)(connection.doc, new Uint8Array(input.update), "superdoc-collaboration-upgrade");
        if (config.writePropagationMs > 0) await delay(config.writePropagationMs);
        return Object.freeze({
          disposition: "created",
          storageVersion: input.updateSha256,
          durabilityEvidence: `${config.providerId}:write-sent`
        });
      } finally {
        await connection.destroy();
      }
    },
    async readTargetFresh(input) {
      const connection = await config.connect(input.providerRoomName);
      try {
        const update = (0, import_yjs.encodeStateAsUpdate)(connection.doc);
        return Object.freeze({
          update: new Uint8Array(update),
          storageVersion: sha256(update),
          providerEvidence: `${config.providerId}:fresh-reconnect-sync`
        });
      } finally {
        await connection.destroy();
      }
    }
  });
}
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
function positiveTimeout(value, fallback, field) {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new CollaborationUpgradeError("UPGRADE_INPUT_INVALID", `${field} must be a positive integer`, {
      stage: "preflight"
    });
  }
  return resolved;
}
function waitForSignal(register, timeoutMs, providerId) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new CollaborationUpgradeError(
          "UPGRADE_PROVIDER_READ_FAILED",
          `${providerId} did not synchronize before the timeout`,
          { stage: "provider-sync", detail: { timeoutMs } }
        )
      );
    }, timeoutMs);
    const finish = () => {
      clearTimeout(timer);
      resolve();
    };
    const fail = (error) => {
      clearTimeout(timer);
      reject(error);
    };
    try {
      register(finish, fail);
    } catch (error) {
      fail(error);
    }
  });
}
async function readYjsRoom(config, roomId, role) {
  const connection = await config.connect(roomId);
  try {
    const update = (0, import_yjs.encodeStateAsUpdate)(connection.doc);
    return Object.freeze({
      role,
      roomId,
      update: new Uint8Array(update),
      stateVector: new Uint8Array((0, import_yjs.encodeStateVector)(connection.doc)),
      storageVersion: sha256(update),
      sourceSchemaVersion: null
    });
  } finally {
    await connection.destroy();
  }
}
function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

// src/hocuspocus.ts
function createHocuspocusUpgradeAdapter(options) {
  if (typeof options?.url !== "string" || options.url.length === 0) {
    throw new CollaborationUpgradeError("UPGRADE_INPUT_INVALID", "Hocuspocus url is required", {
      stage: "preflight"
    });
  }
  const timeoutMs = positiveTimeout(options.connectTimeoutMs, 15e3, "connectTimeoutMs");
  const writePropagationMs = positiveTimeout(options.writePropagationMs, 100, "writePropagationMs");
  return createSyncedYjsUpgradeAdapter({
    providerId: "hocuspocus",
    writePropagationMs,
    connect: options.connect ?? ((roomId) => connectHocuspocus(options, roomId, timeoutMs))
  });
}
async function connectHocuspocus(options, roomId, timeoutMs) {
  const module2 = await importOptional("@hocuspocus/provider");
  if (typeof module2.HocuspocusProvider !== "function") {
    throw new CollaborationUpgradeError(
      "UPGRADE_PROVIDER_CONTRACT_INVALID",
      "installed @hocuspocus/provider package does not export HocuspocusProvider",
      { stage: "provider-connect" }
    );
  }
  const doc = new import_yjs2.Doc();
  let resolveSync = null;
  let rejectSync = null;
  const provider = new module2.HocuspocusProvider({
    url: options.url,
    name: roomId,
    document: doc,
    token: options.token,
    parameters: options.parameters,
    connect: false,
    quiet: true,
    onSynced: () => resolveSync?.(),
    onAuthenticationFailed: (event) => rejectSync?.(event)
  });
  try {
    await waitForSignal(
      (resolve, reject) => {
        resolveSync = resolve;
        rejectSync = reject;
        provider.connect();
      },
      timeoutMs,
      "hocuspocus"
    );
  } catch (error) {
    provider.destroy();
    doc.destroy();
    throw error;
  }
  return {
    doc,
    destroy() {
      const websocketProvider = provider.configuration?.websocketProvider;
      provider.destroy();
      websocketProvider?.destroy();
      doc.destroy();
    }
  };
}
async function importOptional(specifier) {
  return import(specifier);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  createHocuspocusUpgradeAdapter
});
