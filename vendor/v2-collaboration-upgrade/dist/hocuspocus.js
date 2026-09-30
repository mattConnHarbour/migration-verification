const __superdocUpgradeModuleUrl = import.meta.url;

// src/hocuspocus.ts
import { Doc as YDoc2 } from "yjs";

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
import { createHash } from "crypto";
import { applyUpdate, Doc as YDoc, encodeStateAsUpdate, encodeStateVector } from "yjs";
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
        const existing = encodeStateAsUpdate(connection.doc);
        if (!isEmptyYjsUpdate(existing)) {
          return Object.freeze({
            disposition: "already-existed",
            storageVersion: sha256(existing),
            durabilityEvidence: `${config.providerId}:existing-room-sync`
          });
        }
        applyUpdate(connection.doc, new Uint8Array(input.update), "superdoc-collaboration-upgrade");
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
        const update = encodeStateAsUpdate(connection.doc);
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
  const doc = new YDoc();
  try {
    applyUpdate(doc, update);
    return encodeStateVector(doc).byteLength === 1;
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
  return createHash("sha256").update(bytes).digest("hex");
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
    const update = encodeStateAsUpdate(connection.doc);
    return Object.freeze({
      role,
      roomId,
      update: new Uint8Array(update),
      stateVector: new Uint8Array(encodeStateVector(connection.doc)),
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
  const module = await importOptional("@hocuspocus/provider");
  if (typeof module.HocuspocusProvider !== "function") {
    throw new CollaborationUpgradeError(
      "UPGRADE_PROVIDER_CONTRACT_INVALID",
      "installed @hocuspocus/provider package does not export HocuspocusProvider",
      { stage: "provider-connect" }
    );
  }
  const doc = new YDoc2();
  let resolveSync = null;
  let rejectSync = null;
  const provider = new module.HocuspocusProvider({
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
export {
  createHocuspocusUpgradeAdapter
};
