const __superdocUpgradeModuleUrl = import.meta.url;

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

// src/upgrade.ts
import { createHash as createHash2 } from "crypto";

// ../../v2/collaboration-v2/dist/manifest/constants.js
var COLLAB_V2_ROOM_PRODUCT = "superdoc-v2";
var COLLAB_V2_ROOM_SCHEMA_VERSION = Object.freeze({
  major: 2,
  minor: 0
});
var ROOT_MAP = Object.freeze({
  meta: "meta",
  package: "package",
  shards: "shards",
  /**
   * Single-doc collaboration content container. Keyed by stable `shardId`, each
   * entry holds the logical unit's nested subtree (story or package-part). This
   * is what lets the single root `Y.Doc` carry every logical unit without a
   * separate doc, provider room, or awareness scope per unit.
   */
  content: "content",
  operations: "operations",
  checkpoints: "checkpoints",
  capabilities: "capabilities",
  /** Negotiated kernel-prepared journal contract for this room. */
  journalCapability: "journal-capability",
  /** Per-shard durable operation evidence when logical shards share the root doc. */
  rootOpEvidence: "root-op-evidence",
  /** Document-level edit lock state. */
  lock: "superdoc.v2.lock"
});
var META_KEY = Object.freeze({
  product: "product",
  roomSchemaVersion: "roomSchemaVersion",
  roomDocumentId: "roomDocumentId",
  createdAt: "createdAt",
  createdBy: "createdBy",
  createdFrom: "createdFrom",
  bootstrapState: "bootstrapState",
  compatibilityPolicy: "compatibilityPolicy",
  /** Canonical initial-content digest; never the recursive hash of the encoded Y.Doc update. */
  contentDigest: "contentDigest",
  /** Sorted logical-unit ids proven seeded before a single-doc room commits. */
  contentUnitIds: "contentUnitIds",
  contentUnitDigests: "contentUnitDigests",
  /** Nested Y.Map of bootstrap claims keyed by claimer id (pending phase only). */
  bootstrap: "bootstrap"
});
var CONTENT_UNIT_META_KEY = Object.freeze({
  seedComplete: "seedComplete"
});
var PACKAGE_KEY = Object.freeze({
  /** Y.Map of part descriptors keyed by normalized part key. */
  parts: "parts",
  /** Optional graph metadata. */
  rootRelsPartKey: "rootRelsPartKey",
  mainDocumentPartKey: "mainDocumentPartKey",
  mainDocumentRelsPartKey: "mainDocumentRelsPartKey",
  /**
   * Exact normalized DOCX base embedded by coordinated upgrades. The room
   * update owns these bytes so a late join never depends on a caller cache or
   * the original v1 room.
   */
  migrationCarrierBytes: "migrationCarrierBytes",
  migrationCarrierSha256: "migrationCarrierSha256",
  migrationCarrierByteLength: "migrationCarrierByteLength"
});
var RESERVED_NAMESPACE = Object.freeze({
  operations: "operations",
  checkpoints: "checkpoints",
  capabilities: "capabilities"
});
var BOOTSTRAP_STATE = Object.freeze({
  pending: "pending",
  committed: "committed",
  aborted: "aborted"
});
var SHARD_KIND = Object.freeze({
  story: "story",
  relationships: "relationships",
  contentTypes: "content-types",
  styles: "styles",
  numbering: "numbering",
  comments: "comments",
  settings: "settings",
  mediaManifest: "media-manifest",
  binary: "binary",
  opaquePart: "opaque-part"
});
var SHARD_LOAD_POLICY = Object.freeze({
  /** Required for body-editable readiness (main story + main rels + content-types + package rels). */
  eager: "eager",
  /** Loaded only when needed (secondary stories, large parts). */
  lazy: "lazy"
});
var SHARD_BOOTSTRAP_STATUS = Object.freeze({
  descriptorOnly: "descriptor-only",
  seeded: "seeded"
});
var SHARD_REQUIREMENT = Object.freeze({
  required: "required",
  optional: "optional"
});
var READINESS_CLASS = Object.freeze({
  rootOnly: "root-only",
  bodyEditable: "body-editable",
  fullPackage: "full-package"
});
var ROOM_CLASSIFICATION = Object.freeze({
  empty: "empty",
  /** Persisted state exists, but it is not a marked SuperDoc v2 room. */
  unsupportedFormat: "unsupported-format",
  /** A v2 marker coexists with state outside the closed v2 root schema. */
  formatConflict: "format-conflict",
  /** A v2 marker exists, but required v2 bootstrap metadata is malformed. */
  corruptV2: "corrupt-v2",
  v2Pending: "v2-pending",
  v2Committed: "v2-committed"
});
var ROOT_DOC_SIZE_BUDGET_BYTES = 512 * 1024;

// ../../v2/collaboration-v2/dist/diagnostics.js
var COLLAB_V2_DIAGNOSTICS = {
  /** Sync wait exceeded the supplied timeout. */
  COLLAB_V2_SYNC_TIMEOUT: "COLLAB_V2_SYNC_TIMEOUT",
  /** Caller invoked a method on a destroyed connection or provider. */
  COLLAB_V2_CONNECTION_DESTROYED: "COLLAB_V2_CONNECTION_DESTROYED",
  /** Caller attempted to connect a shard before connecting the root. */
  COLLAB_V2_ROOT_NOT_CONNECTED: "COLLAB_V2_ROOT_NOT_CONNECTED",
  /** Caller asked for a capability the provider does not support. */
  COLLAB_V2_PROVIDER_CAPABILITY_UNSUPPORTED: "COLLAB_V2_PROVIDER_CAPABILITY_UNSUPPORTED",
  /** Caller asked for shard awareness on a provider that cannot scope awareness to shards. */
  COLLAB_V2_AWARENESS_SCOPE_UNSUPPORTED: "COLLAB_V2_AWARENESS_SCOPE_UNSUPPORTED",
  /** Adapter configuration was missing or invalid. */
  COLLAB_V2_ADAPTER_CONFIG_INVALID: "COLLAB_V2_ADAPTER_CONFIG_INVALID",
  /** Provider explicitly rejected authentication or room access. */
  COLLAB_V2_ACCESS_DENIED: "COLLAB_V2_ACCESS_DENIED",
  /** Provider transport reported another terminal failure. */
  COLLAB_V2_PROVIDER_TRANSPORT_FAILED: "COLLAB_V2_PROVIDER_TRANSPORT_FAILED",
  /** Room name carries a v1 marker or otherwise collides with v1 rooms. */
  COLLAB_V2_ROOM_NAME_COLLISION: "COLLAB_V2_ROOM_NAME_COLLISION",
  /** Caller passed a v1-style room name into a v2 id input. */
  COLLAB_V2_ROOM_NAME_INVALID: "COLLAB_V2_ROOM_NAME_INVALID",
  /** Sharded connect requires a `shardId` input; root requires `rootId`. */
  COLLAB_V2_CONNECTION_INPUT_INVALID: "COLLAB_V2_CONNECTION_INPUT_INVALID",
  /** Root doc does not carry the `superdoc-v2` product marker. */
  COLLAB_V2_ROOM_PRODUCT_MISMATCH: "COLLAB_V2_ROOM_PRODUCT_MISMATCH",
  /** Root manifest is structurally invalid or unreadable. */
  COLLAB_V2_ROOM_MANIFEST_CORRUPT: "COLLAB_V2_ROOM_MANIFEST_CORRUPT",
  /** Joining client cannot speak the room's schema major version. */
  COLLAB_V2_ROOM_SCHEMA_MAJOR_MISMATCH: "COLLAB_V2_ROOM_SCHEMA_MAJOR_MISMATCH",
  /** Joining client did not advertise compatibility for the room's schema minor. */
  COLLAB_V2_ROOM_SCHEMA_MINOR_INCOMPATIBLE: "COLLAB_V2_ROOM_SCHEMA_MINOR_INCOMPATIBLE",
  /** Caller attempted to bootstrap a room that is already committed. */
  COLLAB_V2_ROOM_ALREADY_BOOTSTRAPPED: "COLLAB_V2_ROOM_ALREADY_BOOTSTRAPPED",
  /** Join intent targeted an empty v2 namespace. */
  COLLAB_V2_ROOM_NOT_FOUND: "COLLAB_V2_ROOM_NOT_FOUND",
  /** Create intent targeted an already-committed v2 room. */
  COLLAB_V2_ROOM_ALREADY_EXISTS: "COLLAB_V2_ROOM_ALREADY_EXISTS",
  /** Join intent observed an incomplete bootstrap and refused to write recovery state. */
  COLLAB_V2_ROOM_INITIALIZING: "COLLAB_V2_ROOM_INITIALIZING",
  COLLAB_V2_ROOM_BOOTSTRAP_STALLED: "COLLAB_V2_ROOM_BOOTSTRAP_STALLED",
  /** Persisted room state is not a marked SuperDoc v2 format. */
  COLLAB_V2_ROOM_FORMAT_UNSUPPORTED: "COLLAB_V2_ROOM_FORMAT_UNSUPPORTED",
  /** A v2 product marker coexists with state outside the closed v2 root schema. */
  COLLAB_V2_ROOM_FORMAT_CONFLICT: "COLLAB_V2_ROOM_FORMAT_CONFLICT",
  /** A marked v2 room is structurally corrupt and cannot be joined or created over. */
  COLLAB_V2_ROOM_CORRUPT: "COLLAB_V2_ROOM_CORRUPT",
  /** JavaScript or version-skewed caller supplied an invalid collaboration open intent. */
  COLLAB_V2_OPEN_INTENT_INVALID: "COLLAB_V2_OPEN_INTENT_INVALID",
  /** Required shard descriptor is missing from the manifest. */
  COLLAB_V2_SHARD_REQUIRED_MISSING: "COLLAB_V2_SHARD_REQUIRED_MISSING",
  /** Caller attempted to read shard registry on a non-v2 room. */
  COLLAB_V2_SHARD_REGISTRY_UNAVAILABLE: "COLLAB_V2_SHARD_REGISTRY_UNAVAILABLE",
  /** Bootstrap aborted because another claim won the deterministic race. */
  COLLAB_V2_BOOTSTRAP_CLAIM_LOST: "COLLAB_V2_BOOTSTRAP_CLAIM_LOST",
  /** Encoded root doc exceeds the agreed root-size budget. */
  COLLAB_V2_ROOT_SIZE_BUDGET_EXCEEDED: "COLLAB_V2_ROOT_SIZE_BUDGET_EXCEEDED",
  /** DOCX bootstrap source is invalid (e.g. not a zip). */
  COLLAB_V2_BOOTSTRAP_SOURCE_INVALID: "COLLAB_V2_BOOTSTRAP_SOURCE_INVALID",
  /** Caller attempted to edit a read-only story shard (footnotes/endnotes/comments/preserved). */
  COLLAB_V2_STORY_SHARD_NOT_EDITABLE: "COLLAB_V2_STORY_SHARD_NOT_EDITABLE",
  /** Block id was not found in the story shard's blocks array. */
  COLLAB_V2_STORY_SHARD_BLOCK_NOT_FOUND: "COLLAB_V2_STORY_SHARD_BLOCK_NOT_FOUND",
  /** Block carries an ambiguous source paraId so edits cannot route deterministically. */
  COLLAB_V2_STORY_SHARD_PARAID_AMBIGUOUS: "COLLAB_V2_STORY_SHARD_PARAID_AMBIGUOUS",
  /** Block has no native paraId AND no session-generated id (close-criterion fail-closed). */
  COLLAB_V2_STORY_SHARD_PARAID_MISSING: "COLLAB_V2_STORY_SHARD_PARAID_MISSING",
  /** Offset or range argument is outside the valid bounds for the target block. */
  COLLAB_V2_STORY_SHARD_RANGE_INVALID: "COLLAB_V2_STORY_SHARD_RANGE_INVALID",
  /** Block is opaque (preserved) and cannot accept text edits. */
  COLLAB_V2_STORY_SHARD_BLOCK_OPAQUE: "COLLAB_V2_STORY_SHARD_BLOCK_OPAQUE",
  /** Block move is not yet supported because it must not lose concurrent edits. */
  COLLAB_V2_STORY_SHARD_MOVE_UNSUPPORTED: "COLLAB_V2_STORY_SHARD_MOVE_UNSUPPORTED",
  /** Package-part shard already seeded; cannot re-seed. */
  COLLAB_V2_PACKAGE_PART_ALREADY_SEEDED: "COLLAB_V2_PACKAGE_PART_ALREADY_SEEDED",
  /** Package-part shard expected a different schema kind. */
  COLLAB_V2_PACKAGE_PART_KIND_MISMATCH: "COLLAB_V2_PACKAGE_PART_KIND_MISMATCH",
  /** Caller attempted to mutate a part class that has no typed editor for the operation. */
  COLLAB_V2_PACKAGE_PART_UNSUPPORTED_FIELD: "COLLAB_V2_PACKAGE_PART_UNSUPPORTED_FIELD",
  /** Relationship/numbering/comments/etc. record is missing required identity. */
  COLLAB_V2_PACKAGE_PART_IDENTITY_MISSING: "COLLAB_V2_PACKAGE_PART_IDENTITY_MISSING",
  /** Two records collide on a canonical identity that must remain unique. */
  COLLAB_V2_PACKAGE_PART_IDENTITY_CONFLICT: "COLLAB_V2_PACKAGE_PART_IDENTITY_CONFLICT",
  /** Content-Types extension rule maps the same extension to incompatible content types. */
  COLLAB_V2_CONTENT_TYPES_DEFAULT_CONFLICT: "COLLAB_V2_CONTENT_TYPES_DEFAULT_CONFLICT",
  /** Opaque package part observed concurrent mutation with non-matching expected hashes. */
  COLLAB_V2_OPAQUE_PART_CONFLICT: "COLLAB_V2_OPAQUE_PART_CONFLICT",
  /** Opaque package part was overwritten with stale expected hash. */
  COLLAB_V2_OPAQUE_PART_EXPECTED_HASH_MISMATCH: "COLLAB_V2_OPAQUE_PART_EXPECTED_HASH_MISMATCH",
  /** Caller attempted blob-mode binary access without a blob adapter. */
  COLLAB_V2_BLOB_ADAPTER_REQUIRED: "COLLAB_V2_BLOB_ADAPTER_REQUIRED",
  /** Blob adapter reported the asset bytes are missing. */
  COLLAB_V2_BLOB_REF_MISSING: "COLLAB_V2_BLOB_REF_MISSING",
  /** Blob adapter reported the asset bytes are unavailable (transient). */
  COLLAB_V2_BLOB_REF_UNAVAILABLE: "COLLAB_V2_BLOB_REF_UNAVAILABLE",
  /** Blob adapter reported the asset bytes are corrupt or did not match the hash. */
  COLLAB_V2_BLOB_REF_CORRUPT: "COLLAB_V2_BLOB_REF_CORRUPT",
  /** Asset hash did not match the bytes/ref provided. */
  COLLAB_V2_ASSET_HASH_MISMATCH: "COLLAB_V2_ASSET_HASH_MISMATCH",
  /** Room declares enterprise blob mode but joining client did not bring a blob adapter. */
  COLLAB_V2_BLOB_MODE_INCOMPATIBLE: "COLLAB_V2_BLOB_MODE_INCOMPATIBLE",
  /** Digital signature part observed after collaborative mutation; signature is invalid. */
  COLLAB_V2_SIGNATURE_INVALIDATED: "COLLAB_V2_SIGNATURE_INVALIDATED",
  /** Source DOCX contains digital signatures; bootstrap or save must address them. */
  COLLAB_V2_SIGNATURE_PRESENT: "COLLAB_V2_SIGNATURE_PRESENT",
  /** Source DOCX contains macros; bootstrap must preserve them as opaque non-executable bytes. */
  COLLAB_V2_MACRO_PRESENT: "COLLAB_V2_MACRO_PRESENT",
  /** Dispatcher routing matrix has no entry for the requested operation id. */
  COLLAB_V2_DISPATCHER_OPERATION_UNKNOWN: "COLLAB_V2_DISPATCHER_OPERATION_UNKNOWN",
  /** Operation classified as journal-required but the cross-shard operation journal seam is not yet wired. */
  COLLAB_V2_DISPATCHER_JOURNAL_REQUIRED: "COLLAB_V2_DISPATCHER_JOURNAL_REQUIRED",
  /** Operation not yet supported by the v2 collaboration dispatcher. */
  COLLAB_V2_DISPATCHER_DEFERRED: "COLLAB_V2_DISPATCHER_DEFERRED",
  /** Read-only operation; not routed through the dispatcher. */
  COLLAB_V2_DISPATCHER_READ_ONLY: "COLLAB_V2_DISPATCHER_READ_ONLY",
  /** Operation has no v2 wiring at all; remains unavailable in collaborative mode. */
  COLLAB_V2_DISPATCHER_UNAVAILABLE: "COLLAB_V2_DISPATCHER_UNAVAILABLE",
  /** Collaborative undo/redo rejected until the collaborative undo policy ships. */
  COLLAB_V2_DISPATCHER_HISTORY_UNAVAILABLE: "COLLAB_V2_DISPATCHER_HISTORY_UNAVAILABLE",
  /** Comment mutation creates or moves anchors; deferred until durable anchors ship. */
  COLLAB_V2_DISPATCHER_COMMENT_ANCHOR_DEFERRED: "COLLAB_V2_DISPATCHER_COMMENT_ANCHOR_DEFERRED",
  /** Inherited header/footer slot edit; rejected until materialization broadens. */
  COLLAB_V2_DISPATCHER_HEADER_FOOTER_INHERITED: "COLLAB_V2_DISPATCHER_HEADER_FOOTER_INHERITED",
  /** Caller invoked beginMutation in collaborative mode without a valid projection token. */
  COLLAB_V2_DISPATCHER_DIRECT_SESSION_WRITE_BLOCKED: "COLLAB_V2_DISPATCHER_DIRECT_SESSION_WRITE_BLOCKED",
  /** Dispatcher command has no resolvable target shard. */
  COLLAB_V2_DISPATCHER_TARGET_UNRESOLVABLE: "COLLAB_V2_DISPATCHER_TARGET_UNRESOLVABLE",
  /** Dispatcher command carries malformed semantic input. */
  COLLAB_V2_DISPATCHER_INPUT_INVALID: "COLLAB_V2_DISPATCHER_INPUT_INVALID",
  // ---- Cross-shard operation journal -----------------------------------
  COLLAB_V2_JOURNAL_RECORD_CORRUPT: "COLLAB_V2_JOURNAL_RECORD_CORRUPT",
  COLLAB_V2_JOURNAL_IMMUTABLE_FIELD: "COLLAB_V2_JOURNAL_IMMUTABLE_FIELD",
  COLLAB_V2_JOURNAL_SCHEMA_MAJOR_MISMATCH: "COLLAB_V2_JOURNAL_SCHEMA_MAJOR_MISMATCH",
  COLLAB_V2_JOURNAL_SCHEMA_MINOR_INCOMPATIBLE: "COLLAB_V2_JOURNAL_SCHEMA_MINOR_INCOMPATIBLE",
  COLLAB_V2_JOURNAL_REPAIR_POLICY_UNKNOWN: "COLLAB_V2_JOURNAL_REPAIR_POLICY_UNKNOWN",
  COLLAB_V2_JOURNAL_RESERVATION_INVALID: "COLLAB_V2_JOURNAL_RESERVATION_INVALID",
  COLLAB_V2_JOURNAL_SHARD_EVIDENCE_CORRUPT: "COLLAB_V2_JOURNAL_SHARD_EVIDENCE_CORRUPT",
  COLLAB_V2_JOURNAL_RESERVATION_DIGEST_MISMATCH: "COLLAB_V2_JOURNAL_RESERVATION_DIGEST_MISMATCH",
  COLLAB_V2_JOURNAL_SHARD_ALREADY_APPLIED: "COLLAB_V2_JOURNAL_SHARD_ALREADY_APPLIED",
  COLLAB_V2_JOURNAL_REPAIR_CONFLICTING_EVIDENCE: "COLLAB_V2_JOURNAL_REPAIR_CONFLICTING_EVIDENCE",
  COLLAB_V2_JOURNAL_REPAIR_CLAIM_LOST: "COLLAB_V2_JOURNAL_REPAIR_CLAIM_LOST",
  COLLAB_V2_JOURNAL_BLOB_INCOMPLETE: "COLLAB_V2_JOURNAL_BLOB_INCOMPLETE",
  COLLAB_V2_JOURNAL_OPERATION_UNSUPPORTED: "COLLAB_V2_JOURNAL_OPERATION_UNSUPPORTED",
  COLLAB_V2_JOURNAL_SHARD_UNAVAILABLE: "COLLAB_V2_JOURNAL_SHARD_UNAVAILABLE",
  COLLAB_V2_JOURNAL_FAILED_CLOSED: "COLLAB_V2_JOURNAL_FAILED_CLOSED",
  // ---- Kernel-sourced journal extensions -------------------------------
  /** Room has no negotiated kernel-prepared journal capability marker; new kernel-prepared writes must fail closed. */
  COLLAB_V2_JOURNAL_CAPABILITY_MISSING: "COLLAB_V2_JOURNAL_CAPABILITY_MISSING",
  /** Save / checkpoint / export barrier could not prove a settled journal state within the bounded wait window. */
  COLLAB_V2_JOURNAL_BARRIER_TIMEOUT: "COLLAB_V2_JOURNAL_BARRIER_TIMEOUT",
  /** Comment cannot be resolved by durable id for undo/redo (deleted or anchor lost). */
  COLLAB_V2_UNDO_COMMENT_UNRESOLVABLE: "COLLAB_V2_UNDO_COMMENT_UNRESOLVABLE",
  // ---- Projection runtime ---------------------------------------------
  COLLAB_V2_PROJECTION_INVALID: "COLLAB_V2_PROJECTION_INVALID",
  COLLAB_V2_PROJECTION_JOURNAL_INCOMPLETE: "COLLAB_V2_PROJECTION_JOURNAL_INCOMPLETE",
  COLLAB_V2_PROJECTION_MISSING_SHARD: "COLLAB_V2_PROJECTION_MISSING_SHARD",
  COLLAB_V2_PROJECTION_MISSING_BINARY: "COLLAB_V2_PROJECTION_MISSING_BINARY",
  COLLAB_V2_PROJECTION_VALIDATOR_FAILED: "COLLAB_V2_PROJECTION_VALIDATOR_FAILED",
  COLLAB_V2_PROJECTION_SAFETY_REJECTED: "COLLAB_V2_PROJECTION_SAFETY_REJECTED",
  COLLAB_V2_PROJECTION_READ_FRESHNESS_UNKNOWN: "COLLAB_V2_PROJECTION_READ_FRESHNESS_UNKNOWN",
  COLLAB_V2_PROJECTION_DISPOSED: "COLLAB_V2_PROJECTION_DISPOSED",
  COLLAB_V2_PROJECTION_CHECKPOINT_CORRUPT: "COLLAB_V2_PROJECTION_CHECKPOINT_CORRUPT",
  // ---- Presence ---------------------------------------------------------
  COLLAB_V2_PRESENCE_PAYLOAD_TOO_LARGE: "COLLAB_V2_PRESENCE_PAYLOAD_TOO_LARGE",
  COLLAB_V2_PRESENCE_SCHEMA_MAJOR_MISMATCH: "COLLAB_V2_PRESENCE_SCHEMA_MAJOR_MISMATCH",
  COLLAB_V2_PRESENCE_FRAME_INVALID: "COLLAB_V2_PRESENCE_FRAME_INVALID",
  COLLAB_V2_PRESENCE_SELECTION_CONTEXT_UNAVAILABLE: "COLLAB_V2_PRESENCE_SELECTION_CONTEXT_UNAVAILABLE",
  COLLAB_V2_PRESENCE_SHARD_UNLOADED: "COLLAB_V2_PRESENCE_SHARD_UNLOADED",
  // ---- Durable anchors --------------------------------------------------
  COLLAB_V2_ANCHOR_INVALID: "COLLAB_V2_ANCHOR_INVALID",
  COLLAB_V2_ANCHOR_ORPHANED: "COLLAB_V2_ANCHOR_ORPHANED",
  COLLAB_V2_ANCHOR_COLLAPSED: "COLLAB_V2_ANCHOR_COLLAPSED",
  COLLAB_V2_ANCHOR_CROSS_STORY_MOVE_REJECTED: "COLLAB_V2_ANCHOR_CROSS_STORY_MOVE_REJECTED",
  COLLAB_V2_ANCHOR_STORY_UNLOADED: "COLLAB_V2_ANCHOR_STORY_UNLOADED",
  // ---- Tracked changes collaborative support matrix ---------------------
  COLLAB_V2_TRACKED_CHANGE_UNSUPPORTED_CLASS: "COLLAB_V2_TRACKED_CHANGE_UNSUPPORTED_CLASS",
  COLLAB_V2_TRACKED_CHANGE_OVERLAPS_OPAQUE: "COLLAB_V2_TRACKED_CHANGE_OVERLAPS_OPAQUE",
  COLLAB_V2_TRACKED_CHANGE_ANCHOR_UNRESOLVABLE: "COLLAB_V2_TRACKED_CHANGE_ANCHOR_UNRESOLVABLE",
  // ---- Collaborative undo -----------------------------------------------
  COLLAB_V2_UNDO_TARGET_DELETED_REMOTELY: "COLLAB_V2_UNDO_TARGET_DELETED_REMOTELY",
  COLLAB_V2_UNDO_TARGET_OVERLAPPED_REMOTELY: "COLLAB_V2_UNDO_TARGET_OVERLAPPED_REMOTELY",
  COLLAB_V2_UNDO_BLOCK_IDENTITY_LOST: "COLLAB_V2_UNDO_BLOCK_IDENTITY_LOST",
  COLLAB_V2_UNDO_ANCHOR_ORPHANED: "COLLAB_V2_UNDO_ANCHOR_ORPHANED",
  COLLAB_V2_UNDO_SHARD_UNLOADED: "COLLAB_V2_UNDO_SHARD_UNLOADED",
  COLLAB_V2_UNDO_JOURNAL_INCOMPLETE: "COLLAB_V2_UNDO_JOURNAL_INCOMPLETE",
  COLLAB_V2_UNDO_RESERVATION_REUSED: "COLLAB_V2_UNDO_RESERVATION_REUSED",
  COLLAB_V2_UNDO_NOT_SUPPORTED_FOR_OP_CLASS: "COLLAB_V2_UNDO_NOT_SUPPORTED_FOR_OP_CLASS",
  COLLAB_V2_UNDO_NO_UNDO_GROUP: "COLLAB_V2_UNDO_NO_UNDO_GROUP",
  COLLAB_V2_UNDO_REDO_NO_REDO_GROUP: "COLLAB_V2_UNDO_REDO_NO_REDO_GROUP"
};
var CollabV2DiagnosticError = class extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "CollabV2DiagnosticError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
};

// ../../v2/collaboration-v2/dist/manifest/sha256-sync.js
var INITIAL_HASH = [1779033703, 3144134277, 1013904242, 2773480762, 1359893119, 2600822924, 528734635, 1541459225];
var ROUND_CONSTANTS = [
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
];
function rightRotate(value, amount) {
  return value >>> amount | value << 32 - amount;
}
function sha256HexSync(bytes) {
  const bitLength = BigInt(bytes.length) * 8n;
  const paddedLength = Math.ceil((bytes.length + 1 + 8) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 128;
  const paddedView = new DataView(padded.buffer);
  paddedView.setUint32(paddedLength - 8, Number(bitLength >> 32n & 0xffffffffn));
  paddedView.setUint32(paddedLength - 4, Number(bitLength & 0xffffffffn));
  const hash = [...INITIAL_HASH];
  const words = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = paddedView.getUint32(offset + index * 4);
    }
    for (let index = 16; index < 64; index += 1) {
      const s0 = rightRotate(words[index - 15], 7) ^ rightRotate(words[index - 15], 18) ^ words[index - 15] >>> 3;
      const s1 = rightRotate(words[index - 2], 17) ^ rightRotate(words[index - 2], 19) ^ words[index - 2] >>> 10;
      words[index] = words[index - 16] + s0 + words[index - 7] + s1 >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const s1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const ch = e & f ^ ~e & g;
      const temp1 = h + s1 + ch + ROUND_CONSTANTS[index] + words[index] >>> 0;
      const s0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const maj = a & b ^ a & c ^ b & c;
      const temp2 = s0 + maj >>> 0;
      h = g;
      g = f;
      f = e;
      e = d + temp1 >>> 0;
      d = c;
      c = b;
      b = a;
      a = temp1 + temp2 >>> 0;
    }
    hash[0] = hash[0] + a >>> 0;
    hash[1] = hash[1] + b >>> 0;
    hash[2] = hash[2] + c >>> 0;
    hash[3] = hash[3] + d >>> 0;
    hash[4] = hash[4] + e >>> 0;
    hash[5] = hash[5] + f >>> 0;
    hash[6] = hash[6] + g >>> 0;
    hash[7] = hash[7] + h >>> 0;
  }
  return hash.map((value) => value.toString(16).padStart(8, "0")).join("");
}

// ../../v2/collaboration-v2/dist/manifest/hash.js
function sha256Hex(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    throw new CollabV2DiagnosticError(COLLAB_V2_DIAGNOSTICS.COLLAB_V2_CONNECTION_INPUT_INVALID, "sha256 input must be a Uint8Array", {});
  }
  return sha256HexSync(bytes);
}

// ../../v2/collaboration-v2/dist/manifest/classification.js
import { decodeStateVector, encodeStateVector, Map as YjsMap } from "yjs";
var LEGACY_V1_TOP_LEVEL_TYPES = ["supereditor", "comments", "parts", "media"];
var LEGACY_V1_META_KEYS = /* @__PURE__ */ new Set([
  "docx",
  "partsSchemaVersion",
  "partsMigration",
  "partsLastHydratedAt",
  "partsFallbackMode",
  "partsCapability",
  "bodySectPr",
  "fonts",
  "locked",
  "lockedBy",
  "immediate-save",
  "immediate-save-finished"
]);
var LEGACY_V1_META_KEY_PREFIXES = ["noteTombstone:"];
var V2_TOP_LEVEL_TYPES = new Set(Object.values(ROOT_MAP));
function peekShared(rootDoc, name) {
  const share = rootDoc.share ?? void 0;
  return share?.get(name);
}
function sharedHasLiveItems(map) {
  if (!map || map.size === 0)
    return false;
  for (const item of map.values()) {
    if (!item)
      continue;
    const it = item;
    if (it.deleted === false)
      return true;
    if (it.deleted === void 0)
      return true;
  }
  return false;
}
function sharedIsNonEmpty(shared) {
  if (!shared)
    return false;
  if (shared._start)
    return true;
  if (sharedHasLiveItems(shared._map))
    return true;
  return false;
}
function readMapKey(shared, key) {
  if (!shared || !shared._map)
    return void 0;
  const item = shared._map.get(key);
  if (!item || item.deleted)
    return void 0;
  const content = item.content;
  if (!content || typeof content.getContent !== "function")
    return void 0;
  const values = content.getContent();
  return values?.[0];
}
function hasMapKeyHistory(shared, key) {
  return shared?._map?.has(key) === true;
}
function classifyRoom(rootDoc) {
  const reasons = [];
  const metaShared = peekShared(rootDoc, ROOT_MAP.meta);
  if (metaShared) {
    const product = readMapKey(metaShared, META_KEY.product);
    if (product === COLLAB_V2_ROOM_PRODUCT) {
      const v1Reasons = [];
      const conflictingTopLevelKeys = findConflictingTopLevelKeys(rootDoc);
      const detectedLegacyV1 = hasV1Signals(rootDoc, v1Reasons, metaShared, false) || conflictingTopLevelKeys.some((key) => LEGACY_V1_TOP_LEVEL_TYPES.includes(key));
      if (detectedLegacyV1 || conflictingTopLevelKeys.length > 0) {
        reasons.push("meta.product=superdoc-v2");
        reasons.push("state outside the v2 root schema coexists with the v2 product marker");
        reasons.push(...v1Reasons);
        for (const key of conflictingTopLevelKeys) {
          if (!v1Reasons.includes(`v1 top-level key present: ${key}`)) {
            reasons.push(`non-v2 top-level key present: ${key}`);
          }
        }
        return classificationResult(ROOM_CLASSIFICATION.formatConflict, reasons, {
          detectedLegacyV1,
          conflictingTopLevelKeys
        });
      }
      const state = readMapKey(metaShared, META_KEY.bootstrapState);
      if (state === BOOTSTRAP_STATE.committed) {
        reasons.push("meta.product=superdoc-v2");
        reasons.push("meta.bootstrapState=committed");
        return classificationResult(ROOM_CLASSIFICATION.v2Committed, reasons);
      }
      if (state === BOOTSTRAP_STATE.pending) {
        reasons.push("meta.product=superdoc-v2");
        reasons.push("meta.bootstrapState=pending");
        return classificationResult(ROOM_CLASSIFICATION.v2Pending, reasons);
      }
      if (state === BOOTSTRAP_STATE.aborted) {
        reasons.push("meta.product=superdoc-v2");
        reasons.push("meta.bootstrapState=aborted");
        return classificationResult(ROOM_CLASSIFICATION.corruptV2, reasons);
      }
      reasons.push("meta.product=superdoc-v2");
      reasons.push("meta.bootstrapState=missing-or-invalid");
      return classificationResult(ROOM_CLASSIFICATION.corruptV2, reasons);
    }
  }
  if (hasV1Signals(rootDoc, reasons, metaShared, true)) {
    return classificationResult(ROOM_CLASSIFICATION.unsupportedFormat, reasons, {
      detectedLegacyV1: true
    });
  }
  if (hasNonEmptyTopLevel(rootDoc) || hasYjsHistory(rootDoc)) {
    reasons.push("persisted state has no v2 product marker");
    return classificationResult(ROOM_CLASSIFICATION.unsupportedFormat, reasons);
  }
  reasons.push("no v2 marker, no v1 signals, no document state");
  return classificationResult(ROOM_CLASSIFICATION.empty, reasons);
}
function classificationResult(classification, reasons, evidence = {}) {
  return {
    classification,
    reasons: Object.freeze([...reasons]),
    detectedLegacyV1: evidence.detectedLegacyV1 === true,
    conflictingTopLevelKeys: Object.freeze([...evidence.conflictingTopLevelKeys ?? []])
  };
}
function hasV1Signals(rootDoc, reasons, metaShared, includeLegacyBootstrapMarker) {
  let signalled = false;
  for (const key of LEGACY_V1_TOP_LEVEL_TYPES) {
    if (sharedIsNonEmpty(peekShared(rootDoc, key))) {
      reasons.push(`v1 top-level key present: ${key}`);
      signalled = true;
    }
  }
  if (metaShared) {
    for (const key of LEGACY_V1_META_KEYS) {
      if (hasMapKeyHistory(metaShared, key)) {
        reasons.push(`v1 meta key present: ${key}`);
        signalled = true;
      }
    }
    for (const prefix of LEGACY_V1_META_KEY_PREFIXES) {
      if (hasMapKeyWithPrefix(metaShared, prefix)) {
        reasons.push(`v1 meta key prefix present: ${prefix}`);
        signalled = true;
      }
    }
    const bootstrap = readMapKey(metaShared, META_KEY.bootstrap);
    if (bootstrap !== void 0 && (includeLegacyBootstrapMarker || !(bootstrap instanceof YjsMap))) {
      reasons.push("v1 meta.bootstrap marker present");
      signalled = true;
    }
  }
  const capabilitiesShared = peekShared(rootDoc, ROOT_MAP.capabilities);
  if (capabilitiesShared && hasMapKeyHistory(capabilitiesShared, "v1-part-sync")) {
    reasons.push("capability:v1-part-sync present");
    signalled = true;
  }
  return signalled;
}
function hasMapKeyWithPrefix(shared, prefix) {
  if (!shared?._map)
    return false;
  for (const key of shared._map.keys()) {
    if (key.startsWith(prefix))
      return true;
  }
  return false;
}
function findConflictingTopLevelKeys(rootDoc) {
  const share = rootDoc.share ?? /* @__PURE__ */ new Map();
  const keys = [];
  for (const name of share.keys()) {
    if (V2_TOP_LEVEL_TYPES.has(name))
      continue;
    keys.push(name);
  }
  keys.sort();
  return keys;
}
function hasYjsHistory(rootDoc) {
  try {
    return decodeStateVector(encodeStateVector(rootDoc)).size > 0;
  } catch {
    return true;
  }
}
function hasNonEmptyTopLevel(rootDoc) {
  const share = rootDoc.share ?? /* @__PURE__ */ new Map();
  for (const [name, value] of share) {
    if (name === ROOT_MAP.operations || name === ROOT_MAP.checkpoints) {
      if (sharedIsNonEmpty(value))
        return true;
      continue;
    }
    if (sharedIsNonEmpty(value))
      return true;
  }
  return false;
}

// ../../v2/collaboration-upgrade/dist/bundle.js
import { strFromU8, strToU8, unzipSync } from "fflate";
import { applyUpdate, decodeStateVector as decodeStateVector2, Doc as YDoc, encodeStateAsUpdate, encodeStateVector as encodeStateVector2 } from "yjs";

// ../../v2/collaboration-upgrade/dist/diagnostics.js
var CollaborationUpgradeError2 = class extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "CollaborationUpgradeError";
    this.code = code;
    this.stage = options.stage ?? "preflight";
    this.detail = Object.freeze({ ...options.detail ?? {} });
  }
};

// ../../v2/collaboration-upgrade/dist/deterministic-zip.js
import { zipSync } from "fflate";
function encodeDeterministicZip(entries) {
  return zipSync(entries, {
    level: 6,
    mtime: new Date(2e3, 0, 1, 0, 0, 0, 0)
  });
}

// ../../v2/collaboration-upgrade/dist/types.js
var COLLABORATION_UPGRADE_BUNDLE_VERSION = 1;

// ../../v2/collaboration-upgrade/dist/validation.js
function assertNonEmptyString(value, field, stage = "preflight") {
  if (typeof value !== "string" || value.length === 0) {
    throw new CollaborationUpgradeError2("UPGRADE_INPUT_INVALID", `${field} must be a non-empty string`, {
      stage,
      detail: { field }
    });
  }
}
function assertSha256(value, field, stage = "preflight") {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/i.test(value)) {
    throw new CollaborationUpgradeError2("UPGRADE_INPUT_INVALID", `${field} must be a SHA-256 hex digest`, {
      stage,
      detail: { field }
    });
  }
}
function assertTimestamp(value, field, stage = "preflight") {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new CollaborationUpgradeError2("UPGRADE_INPUT_INVALID", `${field} must be a valid timestamp`, {
      stage,
      detail: { field }
    });
  }
}
function validateAuthoritativeCheckpoint(checkpoint) {
  if (!checkpoint || typeof checkpoint !== "object" || checkpoint.protocolVersion !== 1) {
    throw new CollaborationUpgradeError2("UPGRADE_INPUT_INVALID", "source checkpoint protocolVersion must be 1", {
      stage: "verify-source"
    });
  }
  assertNonEmptyString(checkpoint.migrationId, "migrationId", "verify-source");
  assertNonEmptyString(checkpoint.logicalDocumentId, "logicalDocumentId", "verify-source");
  assertNonEmptyString(checkpoint.fencingGeneration, "fencingGeneration", "verify-source");
  assertTimestamp(checkpoint.capturedAt, "capturedAt", "verify-source");
  if (checkpoint.topology !== "single-room" && checkpoint.topology !== "split-comments") {
    throw new CollaborationUpgradeError2("UPGRADE_SOURCE_TOPOLOGY_INVALID", "source topology is invalid", {
      stage: "verify-source"
    });
  }
  if (!Array.isArray(checkpoint.snapshots)) {
    throw new CollaborationUpgradeError2("UPGRADE_SOURCE_TOPOLOGY_INVALID", "source snapshots must be an array", {
      stage: "verify-source"
    });
  }
  const roles = /* @__PURE__ */ new Set();
  for (const snapshot of checkpoint.snapshots)
    validateSnapshot(snapshot, roles);
  if (new Set(checkpoint.snapshots.map((snapshot) => snapshot.roomId)).size !== checkpoint.snapshots.length) {
    throw new CollaborationUpgradeError2("UPGRADE_SOURCE_TOPOLOGY_INVALID", "each source role must name a distinct physical v1 room", { stage: "verify-source" });
  }
  if (!roles.has("document")) {
    throw new CollaborationUpgradeError2("UPGRADE_SOURCE_TOPOLOGY_INVALID", "document source snapshot is required", {
      stage: "verify-source"
    });
  }
  if (checkpoint.topology === "split-comments" ? !roles.has("comments") : roles.has("comments")) {
    throw new CollaborationUpgradeError2("UPGRADE_SOURCE_TOPOLOGY_INVALID", "source roles do not match the declared topology", { stage: "verify-source" });
  }
  return checkpoint.snapshots;
}
function validateSnapshot(snapshot, roles) {
  if (!snapshot || snapshot.role !== "document" && snapshot.role !== "comments") {
    throw new CollaborationUpgradeError2("UPGRADE_SOURCE_TOPOLOGY_INVALID", "source snapshot role is invalid", {
      stage: "verify-source"
    });
  }
  if (roles.has(snapshot.role)) {
    throw new CollaborationUpgradeError2("UPGRADE_SOURCE_TOPOLOGY_INVALID", `duplicate source role: ${snapshot.role}`, {
      stage: "verify-source"
    });
  }
  roles.add(snapshot.role);
  assertNonEmptyString(snapshot.roomId, "snapshot.roomId", "verify-source");
  assertNonEmptyString(snapshot.storageVersion, "snapshot.storageVersion", "verify-source");
  if (!(snapshot.update instanceof Uint8Array) || snapshot.update.byteLength === 0) {
    throw new CollaborationUpgradeError2("UPGRADE_INPUT_INVALID", "source update must be a non-empty Uint8Array", {
      stage: "verify-source"
    });
  }
  assertSha256(snapshot.sha256, "snapshot.sha256", "verify-source");
  const actual = sha256Hex(snapshot.update);
  if (actual !== snapshot.sha256.toLowerCase()) {
    throw new CollaborationUpgradeError2("UPGRADE_SOURCE_HASH_MISMATCH", "source update hash does not match", {
      stage: "verify-source",
      detail: { role: snapshot.role, declared: snapshot.sha256, actual }
    });
  }
  if (snapshot.stateVector != null) {
    if (!(snapshot.stateVector instanceof Uint8Array)) {
      throw new CollaborationUpgradeError2("UPGRADE_INPUT_INVALID", "stateVector must be a Uint8Array", {
        stage: "verify-source"
      });
    }
    assertSha256(snapshot.stateVectorSha256, "snapshot.stateVectorSha256", "verify-source");
    const actualStateVector = sha256Hex(snapshot.stateVector);
    if (actualStateVector !== snapshot.stateVectorSha256.toLowerCase()) {
      throw new CollaborationUpgradeError2("UPGRADE_SOURCE_HASH_MISMATCH", "source state-vector hash does not match", {
        stage: "verify-source",
        detail: { role: snapshot.role }
      });
    }
  } else if (snapshot.stateVectorSha256 != null) {
    throw new CollaborationUpgradeError2("UPGRADE_INPUT_INVALID", "stateVectorSha256 cannot be supplied without stateVector bytes", { stage: "verify-source" });
  }
}

// ../../v2/collaboration-upgrade/dist/bundle.js
var DEFAULT_UPGRADE_BUNDLE_LIMITS = Object.freeze({
  maxBundleBytes: 512 * 1024 * 1024,
  maxEntryCount: 1e3,
  maxEntryBytes: 300 * 1024 * 1024,
  maxTotalUncompressedBytes: 1024 * 1024 * 1024,
  maxCompressionRatio: 200,
  maxManifestBytes: 2 * 1024 * 1024
});
async function prepareV1UpgradeBundle(input) {
  const checkpoint = input.sourceCheckpoint;
  const sourceSnapshots = validateAuthoritativeCheckpoint(checkpoint);
  if (!input.reader || input.reader.authority !== "frozen-final-v1" || input.reader.contractVersion !== 1) {
    throw new CollaborationUpgradeError2("UPGRADE_SOURCE_READER_UNAVAILABLE", "automatic preparation requires the frozen final-v1 snapshot reader", { stage: "convert-source" });
  }
  assertNonEmptyString(input.reader.readerId, "reader.readerId", "convert-source");
  const fidelityPolicy = validateFidelityPolicy(input.fidelityPolicy);
  const limits = resolveBundleLimits(input.limits);
  const detached = [];
  const detachedDocs = [];
  try {
    for (const snapshot of sourceSnapshots) {
      if (snapshot.update.byteLength > limits.maxEntryBytes || (snapshot.stateVector?.byteLength ?? 0) > limits.maxEntryBytes) {
        throw new CollaborationUpgradeError2("UPGRADE_BUNDLE_LIMIT_EXCEEDED", "source snapshot exceeds the configured per-entry limit", {
          stage: "verify-source",
          detail: {
            role: snapshot.role,
            observed: snapshot.update.byteLength,
            limit: limits.maxEntryBytes
          }
        });
      }
      const clone = verifyAndCloneV1Snapshot(snapshot.role, snapshot.roomId, snapshot.update, snapshot.stateVector ?? void 0);
      detachedDocs.push(clone);
      detached.push({
        role: snapshot.role,
        roomId: snapshot.roomId,
        sha256: snapshot.sha256,
        sourceSchemaVersion: snapshot.sourceSchemaVersion ?? null,
        update: new Uint8Array(encodeStateAsUpdate(clone))
      });
    }
    let exported;
    try {
      exported = await input.reader.exportDetachedSnapshot({
        logicalDocumentId: checkpoint.logicalDocumentId,
        topology: checkpoint.topology,
        snapshots: detached
      });
    } catch (error) {
      throw new CollaborationUpgradeError2("UPGRADE_SOURCE_EXPORT_FAILED", "final-v1 detached export failed", {
        stage: "convert-source",
        detail: {
          message: error instanceof Error ? error.message : String(error)
        }
      });
    }
    validateExportResult(exported, fidelityPolicy);
    const entries = {};
    const sourceManifest = [];
    for (const [index, snapshot] of sourceSnapshots.entries()) {
      const updatePath = `source/rooms/${snapshot.role}-${index}.yjs`;
      entries[updatePath] = new Uint8Array(snapshot.update);
      let stateVectorPath = null;
      if (snapshot.stateVector) {
        stateVectorPath = `source/rooms/${snapshot.role}-${index}.state-vector`;
        entries[stateVectorPath] = new Uint8Array(snapshot.stateVector);
      }
      sourceManifest.push({
        role: snapshot.role,
        roomId: snapshot.roomId,
        updatePath,
        updateSha256: snapshot.sha256.toLowerCase(),
        updateByteLength: snapshot.update.byteLength,
        stateVectorPath,
        stateVectorSha256: snapshot.stateVectorSha256?.toLowerCase() ?? null,
        storageVersion: snapshot.storageVersion,
        sourceSchemaVersion: snapshot.sourceSchemaVersion ?? null
      });
    }
    const carrierDocx = normalizeCarrierDocx(new Uint8Array(exported.docx), limits);
    const carrierDocxSha256 = sha256Hex(carrierDocx);
    entries["carrier/document.docx"] = carrierDocx;
    const sidecars = (exported.sidecars ?? []).map((sidecar, index) => {
      validateSidecar(sidecar);
      const path2 = `carrier/sidecars/${index}-${safeEntrySegment(sidecar.name)}`;
      const bytes2 = new Uint8Array(sidecar.bytes);
      entries[path2] = bytes2;
      return {
        name: sidecar.name,
        path: path2,
        schemaVersion: sidecar.schemaVersion,
        mediaType: sidecar.mediaType,
        sha256: sha256Hex(bytes2),
        byteLength: bytes2.byteLength
      };
    });
    const reportBytes = strToU8(JSON.stringify({
      diagnostics: exported.diagnostics ?? [],
      featureInventory: exported.featureInventory ?? {}
    }));
    entries["reports/export.json"] = reportBytes;
    const manifest = {
      schemaVersion: COLLABORATION_UPGRADE_BUNDLE_VERSION,
      migrationId: checkpoint.migrationId,
      logicalDocumentId: checkpoint.logicalDocumentId,
      sourceProduct: "superdoc-v1",
      topology: checkpoint.topology,
      fencingGeneration: checkpoint.fencingGeneration,
      sourceCapturedAt: checkpoint.capturedAt,
      reader: {
        id: input.reader.readerId,
        contractVersion: 1,
        authority: "frozen-final-v1"
      },
      sources: sourceManifest,
      carrier: {
        path: "carrier/document.docx",
        sha256: carrierDocxSha256,
        byteLength: carrierDocx.byteLength,
        exportedAt: exported.exportedAt,
        exportToolVersion: exported.exportToolVersion
      },
      sidecars,
      fidelityPolicy,
      report: {
        path: "reports/export.json",
        sha256: sha256Hex(reportBytes),
        byteLength: reportBytes.byteLength
      }
    };
    entries["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2));
    const bytes = encodeDeterministicZip(entries);
    if (bytes.byteLength > limits.maxBundleBytes) {
      throw new CollaborationUpgradeError2("UPGRADE_BUNDLE_LIMIT_EXCEEDED", "upgrade bundle exceeds size limit", {
        stage: "checkpoint-recovery",
        detail: { observed: bytes.byteLength, limit: limits.maxBundleBytes }
      });
    }
    const decoded = decodeCollaborationUpgradeBundle(bytes, { limits });
    return preparedFromDecoded(bytes, decoded);
  } finally {
    for (const doc of detachedDocs)
      doc.destroy();
  }
}
function decodeCollaborationUpgradeBundle(bytes, options = {}) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
    throw new CollaborationUpgradeError2("UPGRADE_BUNDLE_INVALID", "upgrade bundle must be non-empty bytes", {
      stage: "read-bundle"
    });
  }
  const limits = resolveBundleLimits(options.limits);
  inspectUpgradeZip(bytes, limits);
  const bundleSha256 = sha256Hex(bytes);
  if (options.expectedSha256) {
    assertSha256(options.expectedSha256, "expectedSha256", "read-bundle");
    if (bundleSha256 !== options.expectedSha256.toLowerCase()) {
      throw new CollaborationUpgradeError2("UPGRADE_BUNDLE_HASH_MISMATCH", "upgrade bundle hash does not match", {
        stage: "read-bundle",
        detail: { expected: options.expectedSha256, actual: bundleSha256 }
      });
    }
  }
  let entries;
  try {
    entries = unzipSync(bytes);
  } catch (error) {
    throw new CollaborationUpgradeError2("UPGRADE_BUNDLE_INVALID", "upgrade bundle ZIP cannot be decoded", {
      stage: "read-bundle",
      detail: {
        message: error instanceof Error ? error.message : String(error)
      }
    });
  }
  const manifestBytes = requireEntry(entries, "manifest.json");
  if (manifestBytes.byteLength > limits.maxManifestBytes) {
    throw new CollaborationUpgradeError2("UPGRADE_BUNDLE_LIMIT_EXCEEDED", "bundle manifest exceeds size limit", {
      stage: "read-bundle"
    });
  }
  let rawManifest;
  try {
    rawManifest = JSON.parse(strFromU8(manifestBytes));
  } catch {
    throw new CollaborationUpgradeError2("UPGRADE_BUNDLE_INVALID", "bundle manifest is not valid JSON", {
      stage: "read-bundle"
    });
  }
  const manifest = validateBundleManifest(rawManifest);
  const expectedPaths = /* @__PURE__ */ new Set([
    "manifest.json",
    manifest.carrier.path,
    manifest.report.path
  ]);
  const sourceUpdates = manifest.sources.map((source) => {
    expectedPaths.add(source.updatePath);
    const update = verifyEntry(entries, source.updatePath, source.updateSha256, source.updateByteLength);
    let stateVector;
    if (source.stateVectorPath) {
      expectedPaths.add(source.stateVectorPath);
      stateVector = verifyEntry(entries, source.stateVectorPath, source.stateVectorSha256, void 0);
    }
    verifyAndCloneV1Snapshot(source.role, source.roomId, update, stateVector).destroy();
    return Object.freeze({
      role: source.role,
      roomId: source.roomId,
      update: new Uint8Array(update),
      sha256: source.updateSha256
    });
  });
  const carrierDocx = verifyEntry(entries, manifest.carrier.path, manifest.carrier.sha256, manifest.carrier.byteLength);
  const sidecars = manifest.sidecars.map((sidecar) => {
    expectedPaths.add(sidecar.path);
    const sidecarBytes = verifyEntry(entries, sidecar.path, sidecar.sha256, sidecar.byteLength);
    return Object.freeze({
      name: sidecar.name,
      schemaVersion: sidecar.schemaVersion,
      mediaType: sidecar.mediaType,
      bytes: new Uint8Array(sidecarBytes)
    });
  });
  const reportBytes = verifyEntry(entries, manifest.report.path, manifest.report.sha256, manifest.report.byteLength);
  for (const path2 of Object.keys(entries)) {
    if (!expectedPaths.has(path2)) {
      throw new CollaborationUpgradeError2("UPGRADE_BUNDLE_INVALID", `unexpected bundle entry: ${path2}`, {
        stage: "read-bundle"
      });
    }
  }
  let report;
  try {
    report = validateBundleReport(JSON.parse(strFromU8(reportBytes)));
  } catch {
    throw new CollaborationUpgradeError2("UPGRADE_BUNDLE_INVALID", "bundle export report is invalid", {
      stage: "read-bundle"
    });
  }
  return Object.freeze({
    manifest,
    bundleSha256,
    carrierDocx: new Uint8Array(carrierDocx),
    sourceUpdates: Object.freeze(sourceUpdates),
    sidecars: Object.freeze(sidecars),
    report
  });
}
function verifyAndCloneV1Snapshot(role, roomId, update, expectedStateVector) {
  const clone = new YDoc({ gc: false });
  try {
    applyUpdate(clone, new Uint8Array(update), "v1-upgrade-detached-clone");
  } catch (error) {
    clone.destroy();
    throw new CollaborationUpgradeError2("UPGRADE_SOURCE_FORMAT_UNSUPPORTED", "source Yjs update cannot be applied", {
      stage: "verify-source",
      detail: {
        role,
        roomId,
        message: error instanceof Error ? error.message : String(error)
      }
    });
  }
  const classification = classifyRoom(clone);
  const acceptableLegacy = classification.classification === ROOM_CLASSIFICATION.empty || classification.classification === ROOM_CLASSIFICATION.unsupportedFormat;
  if (!acceptableLegacy) {
    clone.destroy();
    throw new CollaborationUpgradeError2("UPGRADE_SOURCE_FORMAT_UNSUPPORTED", "source update is not an isolated supported v1 room state", {
      stage: "verify-source",
      detail: {
        role,
        roomId,
        classification: classification.classification,
        reasons: classification.reasons
      }
    });
  }
  if (expectedStateVector && sha256Hex(encodeStateVector2(clone)) !== sha256Hex(expectedStateVector)) {
    clone.destroy();
    throw new CollaborationUpgradeError2("UPGRADE_SOURCE_HASH_MISMATCH", "declared source state vector does not match the authoritative update", { stage: "verify-source", detail: { role, roomId } });
  }
  const canonicalUpdate = encodeStateAsUpdate(clone);
  const reopened = new YDoc({ gc: false });
  applyUpdate(reopened, canonicalUpdate, "v1-upgrade-verification-reopen");
  const left = encodeStateAsUpdate(clone);
  const right = encodeStateAsUpdate(reopened);
  reopened.destroy();
  if (sha256Hex(left) !== sha256Hex(right)) {
    clone.destroy();
    throw new CollaborationUpgradeError2("UPGRADE_SOURCE_FORMAT_UNSUPPORTED", "source update failed detached re-encode/reopen verification", { stage: "verify-source", detail: { role, roomId } });
  }
  return clone;
}
function validateExportResult(exported, policy) {
  if (!exported || !(exported.docx instanceof Uint8Array) || exported.docx.byteLength === 0) {
    throw new CollaborationUpgradeError2("UPGRADE_SOURCE_EXPORT_FAILED", "final-v1 reader returned no DOCX bytes", {
      stage: "convert-source"
    });
  }
  assertTimestamp(exported.exportedAt, "exportedAt", "convert-source");
  assertNonEmptyString(exported.exportToolVersion, "exportToolVersion", "convert-source");
  const allowedWarnings = new Set(policy.allowWarningCodes ?? []);
  const blocking = (exported.diagnostics ?? []).filter((diagnostic) => diagnostic.severity === "fatal" || diagnostic.severity === "warning" && !allowedWarnings.has(diagnostic.code));
  if (blocking.length > 0) {
    throw new CollaborationUpgradeError2("UPGRADE_SOURCE_EXPORT_FAILED", "v1 export fidelity policy rejected diagnostics", {
      stage: "convert-source",
      detail: {
        diagnosticCodes: blocking.map((diagnostic) => diagnostic.code)
      }
    });
  }
}
function validateFidelityPolicy(policy) {
  const resolved = policy ?? { mode: "strict" };
  if (resolved.mode !== "strict" || resolved.allowWarningCodes !== void 0 && !Array.isArray(resolved.allowWarningCodes)) {
    throw new CollaborationUpgradeError2("UPGRADE_INPUT_INVALID", "fidelity policy must use strict mode", {
      stage: "preflight"
    });
  }
  return Object.freeze({
    mode: "strict",
    ...resolved.allowWarningCodes ? {
      allowWarningCodes: Object.freeze([...new Set(resolved.allowWarningCodes)].sort())
    } : {}
  });
}
function validateSidecar(sidecar) {
  assertNonEmptyString(sidecar.name, "sidecar.name", "convert-source");
  assertNonEmptyString(sidecar.mediaType, "sidecar.mediaType", "convert-source");
  if (!Number.isSafeInteger(sidecar.schemaVersion) || sidecar.schemaVersion <= 0 || !(sidecar.bytes instanceof Uint8Array) || sidecar.bytes.byteLength === 0) {
    throw new CollaborationUpgradeError2("UPGRADE_SOURCE_EXPORT_FAILED", "v1 reader returned an invalid sidecar", {
      stage: "convert-source",
      detail: { name: sidecar.name }
    });
  }
}
function preparedFromDecoded(bytes, decoded) {
  const privateBytes = new Uint8Array(bytes);
  const privateCarrier = new Uint8Array(decoded.carrierDocx);
  return Object.freeze({
    schemaVersion: COLLABORATION_UPGRADE_BUNDLE_VERSION,
    migrationId: decoded.manifest.migrationId,
    logicalDocumentId: decoded.manifest.logicalDocumentId,
    topology: decoded.manifest.topology,
    fencingGeneration: decoded.manifest.fencingGeneration,
    bundleSha256: decoded.bundleSha256,
    bundleByteLength: privateBytes.byteLength,
    get bytes() {
      return new Uint8Array(privateBytes);
    },
    carrierDocxSha256: decoded.manifest.carrier.sha256,
    get carrierDocx() {
      return new Uint8Array(privateCarrier);
    },
    sourceSnapshots: Object.freeze(decoded.manifest.sources.map((source) => Object.freeze({
      role: source.role,
      roomId: source.roomId,
      sha256: source.updateSha256,
      storageVersion: source.storageVersion,
      sourceSchemaVersion: source.sourceSchemaVersion
    }))),
    diagnostics: decoded.report.diagnostics
  });
}
function validateBundleManifest(value) {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, [
    "schemaVersion",
    "migrationId",
    "logicalDocumentId",
    "sourceProduct",
    "topology",
    "fencingGeneration",
    "sourceCapturedAt",
    "reader",
    "sources",
    "carrier",
    "sidecars",
    "fidelityPolicy",
    "report"
  ]))
    invalidManifest();
  const manifest = value;
  if (manifest.schemaVersion !== COLLABORATION_UPGRADE_BUNDLE_VERSION || manifest.sourceProduct !== "superdoc-v1") {
    invalidManifest();
  }
  assertNonEmptyString(manifest.migrationId, "manifest.migrationId", "read-bundle");
  assertNonEmptyString(manifest.logicalDocumentId, "manifest.logicalDocumentId", "read-bundle");
  assertNonEmptyString(manifest.fencingGeneration, "manifest.fencingGeneration", "read-bundle");
  assertTimestamp(manifest.sourceCapturedAt, "manifest.sourceCapturedAt", "read-bundle");
  if (manifest.topology !== "single-room" && manifest.topology !== "split-comments")
    invalidManifest();
  if (!Array.isArray(manifest.sources) || !isPlainRecord(manifest.carrier) || !isPlainRecord(manifest.report) || !isPlainRecord(manifest.reader))
    invalidManifest();
  const typed = manifest;
  if (!hasOnlyKeys(manifest.reader, ["id", "contractVersion", "authority"]) || manifest.reader.contractVersion !== 1 || manifest.reader.authority !== "frozen-final-v1") {
    invalidManifest();
  }
  assertNonEmptyString(manifest.reader.id, "manifest.reader.id", "read-bundle");
  const roles = /* @__PURE__ */ new Set();
  const roomIds = /* @__PURE__ */ new Set();
  const paths = /* @__PURE__ */ new Set();
  for (const [index, source] of typed.sources.entries()) {
    if (!isPlainRecord(source) || !hasOnlyKeys(source, [
      "role",
      "roomId",
      "updatePath",
      "updateSha256",
      "updateByteLength",
      "stateVectorPath",
      "stateVectorSha256",
      "storageVersion",
      "sourceSchemaVersion"
    ]) || source.role !== "document" && source.role !== "comments" || roles.has(source.role))
      invalidManifest();
    roles.add(source.role);
    assertNonEmptyString(source.roomId, "source.roomId", "read-bundle");
    if (roomIds.has(source.roomId))
      invalidManifest();
    roomIds.add(source.roomId);
    assertNonEmptyString(source.storageVersion, "source.storageVersion", "read-bundle");
    if (source.sourceSchemaVersion !== null && typeof source.sourceSchemaVersion !== "string")
      invalidManifest();
    assertSafeEntryPath(source.updatePath);
    if (source.updatePath !== `source/rooms/${source.role}-${index}.yjs` || paths.has(source.updatePath))
      invalidManifest();
    paths.add(source.updatePath);
    assertSha256(source.updateSha256, "source.updateSha256", "read-bundle");
    if (!Number.isSafeInteger(source.updateByteLength) || source.updateByteLength <= 0)
      invalidManifest();
    if (source.stateVectorPath) {
      assertSafeEntryPath(source.stateVectorPath);
      if (source.stateVectorPath !== `source/rooms/${source.role}-${index}.state-vector` || paths.has(source.stateVectorPath))
        invalidManifest();
      paths.add(source.stateVectorPath);
      assertSha256(source.stateVectorSha256, "source.stateVectorSha256", "read-bundle");
    } else if (source.stateVectorSha256 !== null) {
      invalidManifest();
    }
  }
  if (!roles.has("document") || (typed.topology === "split-comments" ? !roles.has("comments") : roles.has("comments"))) {
    invalidManifest();
  }
  if (!hasOnlyKeys(manifest.carrier, [
    "path",
    "sha256",
    "byteLength",
    "exportedAt",
    "exportToolVersion"
  ]) || typed.carrier.path !== "carrier/document.docx" || paths.has(typed.carrier.path))
    invalidManifest();
  paths.add(typed.carrier.path);
  assertSha256(typed.carrier.sha256, "carrier.sha256", "read-bundle");
  if (!Number.isSafeInteger(typed.carrier.byteLength) || typed.carrier.byteLength <= 0)
    invalidManifest();
  assertTimestamp(typed.carrier.exportedAt, "carrier.exportedAt", "read-bundle");
  assertNonEmptyString(typed.carrier.exportToolVersion, "carrier.exportToolVersion", "read-bundle");
  if (!hasOnlyKeys(manifest.report, ["path", "sha256", "byteLength"]) || typed.report.path !== "reports/export.json" || paths.has(typed.report.path))
    invalidManifest();
  paths.add(typed.report.path);
  assertSha256(typed.report.sha256, "report.sha256", "read-bundle");
  if (!Number.isSafeInteger(typed.report.byteLength) || typed.report.byteLength <= 0)
    invalidManifest();
  if (!Array.isArray(typed.sidecars))
    invalidManifest();
  const sidecarNames = /* @__PURE__ */ new Set();
  for (const [index, sidecar] of typed.sidecars.entries()) {
    if (!isPlainRecord(sidecar) || !hasOnlyKeys(sidecar, [
      "name",
      "path",
      "schemaVersion",
      "mediaType",
      "sha256",
      "byteLength"
    ]))
      invalidManifest();
    assertNonEmptyString(sidecar.name, "sidecar.name", "read-bundle");
    assertNonEmptyString(sidecar.mediaType, "sidecar.mediaType", "read-bundle");
    assertNonEmptyString(sidecar.path, "sidecar.path", "read-bundle");
    assertSafeEntryPath(sidecar.path);
    if (sidecar.path !== `carrier/sidecars/${index}-${safeEntrySegment(sidecar.name)}` || paths.has(sidecar.path) || sidecarNames.has(sidecar.name))
      invalidManifest();
    paths.add(sidecar.path);
    sidecarNames.add(sidecar.name);
    assertSha256(sidecar.sha256, "sidecar.sha256", "read-bundle");
    if (typeof sidecar.schemaVersion !== "number" || !Number.isSafeInteger(sidecar.schemaVersion) || sidecar.schemaVersion <= 0 || typeof sidecar.byteLength !== "number" || !Number.isSafeInteger(sidecar.byteLength) || sidecar.byteLength <= 0)
      invalidManifest();
  }
  if (!isPlainRecord(manifest.fidelityPolicy) || !hasOnlyKeys(manifest.fidelityPolicy, ["mode", "allowWarningCodes"]) || typed.fidelityPolicy.mode !== "strict")
    invalidManifest();
  const warningCodes = typed.fidelityPolicy.allowWarningCodes;
  if (warningCodes !== void 0 && (!Array.isArray(warningCodes) || warningCodes.some((code) => typeof code !== "string" || code.length === 0))) {
    invalidManifest();
  }
  return deepFreeze(typed);
}
function validateBundleReport(value) {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, ["diagnostics", "featureInventory"]) || !Array.isArray(value.diagnostics) || !isPlainRecord(value.featureInventory)) {
    throw new CollaborationUpgradeError2("UPGRADE_BUNDLE_INVALID", "bundle export report is malformed", {
      stage: "read-bundle"
    });
  }
  const diagnostics = value.diagnostics.map((diagnostic) => {
    if (!isPlainRecord(diagnostic) || !hasOnlyKeys(diagnostic, ["code", "severity", "message", "feature"]) || typeof diagnostic.code !== "string" || diagnostic.code.length === 0 || diagnostic.severity !== "info" && diagnostic.severity !== "warning" && diagnostic.severity !== "fatal" || typeof diagnostic.message !== "string" || diagnostic.message.length === 0 || diagnostic.feature !== void 0 && diagnostic.feature !== null && typeof diagnostic.feature !== "string") {
      throw new CollaborationUpgradeError2("UPGRADE_BUNDLE_INVALID", "bundle export diagnostic is malformed", {
        stage: "read-bundle"
      });
    }
    return diagnostic;
  });
  for (const [key, inventoryValue] of Object.entries(value.featureInventory)) {
    if (!key || typeof inventoryValue !== "number" && typeof inventoryValue !== "boolean" && typeof inventoryValue !== "string" || typeof inventoryValue === "number" && !Number.isFinite(inventoryValue)) {
      throw new CollaborationUpgradeError2("UPGRADE_BUNDLE_INVALID", "bundle feature inventory is malformed", {
        stage: "read-bundle"
      });
    }
  }
  return deepFreeze({
    diagnostics: [...diagnostics],
    featureInventory: { ...value.featureInventory }
  });
}
function isPlainRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function hasOnlyKeys(value, allowed) {
  const allowedSet = new Set(allowed);
  return Object.keys(value).every((key) => allowedSet.has(key));
}
function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value))
      deepFreeze(nested);
  }
  return value;
}
function invalidManifest() {
  throw new CollaborationUpgradeError2("UPGRADE_BUNDLE_INVALID", "upgrade bundle manifest is malformed", {
    stage: "read-bundle"
  });
}
function verifyEntry(entries, path2, expectedSha256, expectedLength) {
  const bytes = requireEntry(entries, path2);
  if (expectedLength !== void 0 && bytes.byteLength !== expectedLength) {
    throw new CollaborationUpgradeError2("UPGRADE_BUNDLE_INVALID", `bundle entry length mismatch: ${path2}`, {
      stage: "read-bundle"
    });
  }
  const actual = sha256Hex(bytes);
  if (actual !== expectedSha256.toLowerCase()) {
    throw new CollaborationUpgradeError2("UPGRADE_BUNDLE_HASH_MISMATCH", `bundle entry hash mismatch: ${path2}`, {
      stage: "read-bundle",
      detail: { path: path2, expected: expectedSha256, actual }
    });
  }
  return bytes;
}
function requireEntry(entries, path2) {
  const entry = entries[path2];
  if (!entry) {
    throw new CollaborationUpgradeError2("UPGRADE_BUNDLE_INVALID", `bundle entry is missing: ${path2}`, {
      stage: "read-bundle"
    });
  }
  return entry;
}
function resolveBundleLimits(input) {
  const out = { ...DEFAULT_UPGRADE_BUNDLE_LIMITS, ...input ?? {} };
  for (const [field, value] of Object.entries(out)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new CollaborationUpgradeError2("UPGRADE_INPUT_INVALID", `${field} must be a positive safe integer`, {
        stage: "preflight"
      });
    }
  }
  return out;
}
function inspectUpgradeZip(bytes, input, options = {}) {
  const limits = resolveBundleLimits(input);
  if (bytes.byteLength > limits.maxBundleBytes)
    bundleLimit("bundle bytes", bytes.byteLength, limits.maxBundleBytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minEocd = Math.max(0, bytes.byteLength - 65557);
  let eocd = -1;
  for (let offset2 = bytes.byteLength - 22; offset2 >= minEocd; offset2 -= 1) {
    if (view.getUint32(offset2, true) === 101010256) {
      eocd = offset2;
      break;
    }
  }
  if (eocd < 0)
    invalidZip("ZIP end-of-central-directory record is missing");
  const diskNumber = view.getUint16(eocd + 4, true);
  const centralDisk = view.getUint16(eocd + 6, true);
  const diskEntryCount = view.getUint16(eocd + 8, true);
  const entryCount = view.getUint16(eocd + 10, true);
  const centralSize = view.getUint32(eocd + 12, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  const commentLength = view.getUint16(eocd + 20, true);
  if (diskNumber !== 0 || centralDisk !== 0 || diskEntryCount !== entryCount) {
    invalidZip("multi-disk ZIP bundles are not supported");
  }
  if (eocd + 22 + commentLength !== bytes.byteLength)
    invalidZip("ZIP end record is inconsistent");
  if (entryCount > limits.maxEntryCount)
    bundleLimit("entry count", entryCount, limits.maxEntryCount);
  if (centralOffset + centralSize !== eocd)
    invalidZip("ZIP central directory is out of bounds");
  let offset = centralOffset;
  let totalUncompressed = 0;
  const names = /* @__PURE__ */ new Set();
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > bytes.byteLength || view.getUint32(offset, true) !== 33639248) {
      invalidZip("ZIP central-directory entry is malformed");
    }
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const compressed = view.getUint32(offset + 20, true);
    const uncompressed = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength2 = view.getUint16(offset + 32, true);
    const diskStart = view.getUint16(offset + 34, true);
    const localOffset = view.getUint32(offset + 42, true);
    if ((flags & 1) !== 0)
      invalidZip("encrypted ZIP entries are not supported");
    if (method !== 0 && method !== 8)
      invalidZip("ZIP compression method is unsupported");
    if (diskStart !== 0)
      invalidZip("multi-disk ZIP entries are not supported");
    if (compressed === 4294967295 || uncompressed === 4294967295)
      invalidZip("ZIP64 bundles are not supported");
    if (localOffset === 4294967295)
      invalidZip("ZIP64 bundles are not supported");
    if (uncompressed > limits.maxEntryBytes)
      bundleLimit("entry bytes", uncompressed, limits.maxEntryBytes);
    totalUncompressed += uncompressed;
    if (totalUncompressed > limits.maxTotalUncompressedBytes) {
      bundleLimit("total uncompressed bytes", totalUncompressed, limits.maxTotalUncompressedBytes);
    }
    if (uncompressed > 1024 * 1024 && uncompressed / Math.max(1, compressed) > limits.maxCompressionRatio) {
      bundleLimit("compression ratio", Math.ceil(uncompressed / Math.max(1, compressed)), limits.maxCompressionRatio);
    }
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    const extraEnd = nameEnd + extraLength;
    if (extraEnd + commentLength2 > bytes.byteLength)
      invalidZip("ZIP entry metadata is out of bounds");
    rejectZip64Extra(view, nameEnd, extraLength);
    const name = strFromU8(bytes.subarray(nameStart, nameEnd));
    assertSafeEntryPath(name, options.allowDirectoryEntries === true);
    if (names.has(name))
      invalidZip(`duplicate ZIP entry: ${name}`);
    names.add(name);
    inspectLocalZipEntry(bytes, view, localOffset, name, method, compressed, centralOffset);
    offset = extraEnd + commentLength2;
  }
  if (offset !== centralOffset + centralSize)
    invalidZip("ZIP central-directory size is inconsistent");
}
function inspectLocalZipEntry(bytes, view, offset, expectedName, expectedMethod, expectedCompressedBytes, centralOffset) {
  if (offset + 30 > centralOffset || view.getUint32(offset, true) !== 67324752) {
    invalidZip("ZIP local entry is malformed");
  }
  const flags = view.getUint16(offset + 6, true);
  const method = view.getUint16(offset + 8, true);
  const compressed = view.getUint32(offset + 18, true);
  const nameLength = view.getUint16(offset + 26, true);
  const extraLength = view.getUint16(offset + 28, true);
  if ((flags & 1) !== 0 || method !== expectedMethod || compressed === 4294967295) {
    invalidZip("ZIP local entry does not match its central-directory record");
  }
  const nameStart = offset + 30;
  const nameEnd = nameStart + nameLength;
  const dataStart = nameEnd + extraLength;
  if (dataStart + expectedCompressedBytes > centralOffset)
    invalidZip("ZIP local entry is out of bounds");
  if ((flags & 8) === 0 && compressed !== expectedCompressedBytes) {
    invalidZip("ZIP local and central entry sizes differ");
  }
  rejectZip64Extra(view, nameEnd, extraLength);
  if (strFromU8(bytes.subarray(nameStart, nameEnd)) !== expectedName) {
    invalidZip("ZIP local and central entry names differ");
  }
}
function rejectZip64Extra(view, offset, byteLength) {
  const end = offset + byteLength;
  while (offset < end) {
    if (offset + 4 > end)
      invalidZip("ZIP extra field is malformed");
    const id = view.getUint16(offset, true);
    const size = view.getUint16(offset + 2, true);
    offset += 4;
    if (offset + size > end)
      invalidZip("ZIP extra field is malformed");
    if (id === 1)
      invalidZip("ZIP64 bundles are not supported");
    offset += size;
  }
}
function assertSafeEntryPath(path2, allowDirectoryEntry = false) {
  const pathForSegments = allowDirectoryEntry && path2.endsWith("/") ? path2.slice(0, -1) : path2;
  if (typeof path2 !== "string" || path2.length === 0 || path2.length > 512 || path2.includes("\\") || path2.includes("\0") || path2.startsWith("/") || /^[A-Za-z]:/.test(path2) || pathForSegments.length === 0 || pathForSegments.split("/").some((segment) => segment === ".." || segment === "")) {
    invalidZip(`unsafe bundle entry path: ${String(path2)}`);
  }
}
function normalizeCarrierDocx(bytes, limits) {
  if (bytes.byteLength > limits.maxEntryBytes) {
    throw new CollaborationUpgradeError2("UPGRADE_BUNDLE_LIMIT_EXCEEDED", "v1 carrier DOCX exceeds the configured per-entry limit", {
      stage: "convert-source",
      detail: { observed: bytes.byteLength, limit: limits.maxEntryBytes }
    });
  }
  inspectUpgradeZip(bytes, { ...limits, maxBundleBytes: limits.maxEntryBytes }, { allowDirectoryEntries: true });
  let decoded;
  try {
    decoded = unzipSync(bytes);
  } catch (error) {
    throw new CollaborationUpgradeError2("UPGRADE_SOURCE_EXPORT_FAILED", "final-v1 reader returned an invalid DOCX carrier", {
      stage: "convert-source",
      detail: {
        message: error instanceof Error ? error.message : String(error)
      }
    });
  }
  const normalized = {};
  for (const name of Object.keys(decoded).sort()) {
    if (name.endsWith("/"))
      continue;
    assertSafeEntryPath(name);
    normalized[name] = decoded[name];
  }
  const encoded = encodeDeterministicZip(normalized);
  if (encoded.byteLength > limits.maxEntryBytes) {
    throw new CollaborationUpgradeError2("UPGRADE_BUNDLE_LIMIT_EXCEEDED", "normalized v1 carrier DOCX exceeds the configured per-entry limit", {
      stage: "convert-source",
      detail: { observed: encoded.byteLength, limit: limits.maxEntryBytes }
    });
  }
  return encoded;
}
function safeEntrySegment(name) {
  const safe = name.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "");
  if (!safe)
    throw new CollaborationUpgradeError2("UPGRADE_SOURCE_EXPORT_FAILED", "sidecar name is unsafe", {
      stage: "convert-source"
    });
  return safe.slice(0, 120);
}
function bundleLimit(kind, observed, limit) {
  throw new CollaborationUpgradeError2("UPGRADE_BUNDLE_LIMIT_EXCEEDED", `upgrade bundle ${kind} exceeds limit`, {
    stage: "read-bundle",
    detail: { observed, limit }
  });
}
function invalidZip(message) {
  throw new CollaborationUpgradeError2("UPGRADE_BUNDLE_INVALID", message, {
    stage: "read-bundle"
  });
}

// src/frozen-v1-reader.ts
import { createHash } from "crypto";
import { spawn } from "child_process";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

// src/frozen-v1-reader-types.ts
var FINAL_V1_READER_CONTRACT_VERSION = 1;
var FINAL_V1_SUPERDOC_VERSION = "1.44.1";
var FINAL_V1_SOURCE_COMMIT = "28df41a6751a73c7654536323ee77dbcd75fb30f";
var FrozenV1ReaderError = class extends Error {
  code;
  detail;
  constructor(code, message, detail = {}) {
    super(message);
    this.name = "FrozenV1ReaderError";
    this.code = code;
    this.detail = Object.freeze({ ...detail });
  }
};

// src/frozen-v1-reader.ts
var DEFAULT_MAX_BYTES = 256 * 1024 * 1024;
var DEFAULT_TIMEOUT_MS = 6e5;
var DEFAULT_MAX_OLD_SPACE_MB = 16384;
var SHA256_PATTERN = /^[a-f0-9]{64}$/;
function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
function assertInput(input, maxInputBytes) {
  if (!input || typeof input.logicalDocumentId !== "string" || input.logicalDocumentId.trim().length === 0) {
    throw new FrozenV1ReaderError(
      "V1_READER_INPUT_INVALID",
      "logicalDocumentId must be a non-empty string"
    );
  }
  if (input.topology !== "single-room" && input.topology !== "split-comments") {
    throw new FrozenV1ReaderError(
      "V1_READER_INPUT_INVALID",
      "topology must be single-room or split-comments"
    );
  }
  if (!Array.isArray(input.snapshots) || input.snapshots.length === 0 || input.snapshots.length > 2) {
    throw new FrozenV1ReaderError(
      "V1_READER_INPUT_INVALID",
      "reader requires one document snapshot and at most one comments snapshot"
    );
  }
  const roles = input.snapshots.map((snapshot) => snapshot.role);
  const expectedRoles = input.topology === "split-comments" ? ["comments", "document"] : ["document"];
  if (roles.slice().sort().join(",") !== expectedRoles.join(",")) {
    throw new FrozenV1ReaderError(
      "V1_READER_INPUT_INVALID",
      `snapshot roles do not match ${input.topology} topology`
    );
  }
  let totalBytes = 0;
  const roomIds = /* @__PURE__ */ new Set();
  for (const snapshot of input.snapshots) {
    if (!(snapshot.update instanceof Uint8Array) || snapshot.update.byteLength === 0) {
      throw new FrozenV1ReaderError(
        "V1_READER_INPUT_INVALID",
        `${snapshot.role} update must be a non-empty Uint8Array`
      );
    }
    if (typeof snapshot.roomId !== "string" || snapshot.roomId.trim().length === 0 || roomIds.has(snapshot.roomId)) {
      throw new FrozenV1ReaderError(
        "V1_READER_INPUT_INVALID",
        "snapshot room IDs must be non-empty and distinct"
      );
    }
    roomIds.add(snapshot.roomId);
    if (!SHA256_PATTERN.test(snapshot.sha256) || sha256(snapshot.update) !== snapshot.sha256) {
      throw new FrozenV1ReaderError(
        "V1_READER_INPUT_INVALID",
        `${snapshot.role} update hash does not match its bytes`
      );
    }
    totalBytes += snapshot.update.byteLength;
  }
  if (totalBytes > maxInputBytes) {
    throw new FrozenV1ReaderError(
      "V1_READER_LIMIT_EXCEEDED",
      "combined v1 update size exceeds the configured reader limit",
      {
        totalBytes,
        maxInputBytes
      }
    );
  }
}
async function runWorker(configPath, timeoutMs, maxOldSpaceMb) {
  const workerPath = fileURLToPath(
    new URL("./frozen-v1-reader-worker.js", __superdocUpgradeModuleUrl)
  );
  await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [`--max-old-space-size=${maxOldSpaceMb}`, workerPath, configPath],
      {
        stdio: ["ignore", "ignore", "pipe"],
        env: { ...process.env, NODE_ENV: "production" }
      }
    );
    const stderr = [];
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(
        new FrozenV1ReaderError(
          "V1_READER_PROCESS_FAILED",
          "unable to start the final-v1 reader process",
          {
            cause: error instanceof Error ? error.message : String(error)
          }
        )
      );
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      if (timedOut) {
        reject(
          new FrozenV1ReaderError(
            "V1_READER_TIMEOUT",
            `final-v1 reader exceeded its ${timeoutMs}ms deadline`
          )
        );
        return;
      }
      if (code !== 0) {
        reject(
          new FrozenV1ReaderError(
            "V1_READER_PROCESS_FAILED",
            "final-v1 reader process failed",
            {
              code,
              signal,
              stderr: Buffer.concat(stderr).toString("utf8").slice(0, 8192)
            }
          )
        );
        return;
      }
      resolve();
    });
  });
}
function createFrozenV1SnapshotReader(options = {}) {
  const maxInputBytes = options.maxInputBytes ?? DEFAULT_MAX_BYTES;
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOldSpaceMb = options.maxOldSpaceMb ?? DEFAULT_MAX_OLD_SPACE_MB;
  if (!Number.isSafeInteger(maxInputBytes) || maxInputBytes <= 0 || !Number.isSafeInteger(maxOutputBytes) || maxOutputBytes <= 0) {
    throw new FrozenV1ReaderError(
      "V1_READER_INPUT_INVALID",
      "reader byte limits must be positive safe integers"
    );
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new FrozenV1ReaderError(
      "V1_READER_INPUT_INVALID",
      "reader timeout must be a positive safe integer"
    );
  }
  if (!Number.isSafeInteger(maxOldSpaceMb) || maxOldSpaceMb < 128 || maxOldSpaceMb > 32768) {
    throw new FrozenV1ReaderError(
      "V1_READER_INPUT_INVALID",
      "reader maxOldSpaceMb must be a safe integer between 128 and 32768"
    );
  }
  return Object.freeze({
    readerId: `superdoc-final-v1-${FINAL_V1_SUPERDOC_VERSION}`,
    contractVersion: FINAL_V1_READER_CONTRACT_VERSION,
    authority: "frozen-final-v1",
    async exportDetachedSnapshot(input) {
      assertInput(input, maxInputBytes);
      const tempRoot = await mkdtemp(
        path.join(os.tmpdir(), "superdoc-final-v1-reader-")
      );
      const carrierPath = path.join(tempRoot, "carrier.docx");
      const reportPath = path.join(tempRoot, "report.json");
      const configPath = path.join(tempRoot, "input.json");
      try {
        const snapshots = [];
        for (const snapshot of input.snapshots) {
          const snapshotPath = path.join(tempRoot, `${snapshot.role}.yjs`);
          await writeFile(snapshotPath, snapshot.update, { mode: 384 });
          snapshots.push({
            role: snapshot.role,
            roomId: snapshot.roomId,
            sha256: snapshot.sha256,
            sourceSchemaVersion: snapshot.sourceSchemaVersion,
            path: snapshotPath
          });
        }
        const workerInput = {
          schemaVersion: 1,
          logicalDocumentId: input.logicalDocumentId,
          topology: input.topology,
          snapshots,
          carrierPath,
          reportPath,
          exportedAt: options.exportedAt ?? (/* @__PURE__ */ new Date()).toISOString()
        };
        await writeFile(configPath, `${JSON.stringify(workerInput)}
`, {
          mode: 384
        });
        await runWorker(configPath, timeoutMs, maxOldSpaceMb);
        const [carrier, reportSource] = await Promise.all([
          readFile(carrierPath),
          readFile(reportPath, "utf8")
        ]);
        if (carrier.byteLength > maxOutputBytes) {
          throw new FrozenV1ReaderError(
            "V1_READER_LIMIT_EXCEEDED",
            "final-v1 carrier exceeds the configured output limit",
            {
              carrierByteLength: carrier.byteLength,
              maxOutputBytes
            }
          );
        }
        const report = JSON.parse(reportSource);
        if (!report.ok || report.schemaVersion !== "superdoc-final-v1-reader.v1") {
          throw new FrozenV1ReaderError(
            "V1_READER_OUTPUT_INVALID",
            report.error?.message ?? "final-v1 reader returned an invalid report",
            {
              workerCode: report.error?.code
            }
          );
        }
        if (report.carrierByteLength !== carrier.byteLength || report.carrierSha256 !== sha256(carrier)) {
          throw new FrozenV1ReaderError(
            "V1_READER_OUTPUT_INVALID",
            "final-v1 carrier identity does not match the worker report"
          );
        }
        for (const snapshot of input.snapshots) {
          const persisted = await readFile(
            path.join(tempRoot, `${snapshot.role}.yjs`)
          );
          if (sha256(persisted) !== snapshot.sha256 || report.sourceHashes?.[snapshot.role] !== snapshot.sha256) {
            throw new FrozenV1ReaderError(
              "V1_READER_SOURCE_CHANGED",
              `${snapshot.role} source bytes changed during detached export`
            );
          }
        }
        return {
          docx: new Uint8Array(carrier),
          diagnostics: [],
          featureInventory: {
            packagePartCount: report.packagePartCount ?? 0,
            packageParts: report.packageParts ?? "",
            topLevelRoots: report.topLevelRoots ?? "",
            commentCount: report.commentCount ?? 0,
            trackedChangeCount: report.trackedChangeCount ?? 0,
            textCharacters: report.textCharacters ?? 0,
            detachedCloneChanged: report.detachedCloneChanged === true,
            finalV1Version: FINAL_V1_SUPERDOC_VERSION,
            finalV1Commit: FINAL_V1_SOURCE_COMMIT
          },
          exportedAt: workerInput.exportedAt,
          exportToolVersion: `superdoc-final-v1@${FINAL_V1_SUPERDOC_VERSION}+${FINAL_V1_SOURCE_COMMIT.slice(0, 12)}`
        };
      } catch (error) {
        if (error instanceof FrozenV1ReaderError) throw error;
        throw new FrozenV1ReaderError(
          "V1_READER_OUTPUT_INVALID",
          error instanceof Error ? error.message : String(error)
        );
      } finally {
        await rm(tempRoot, { recursive: true, force: true });
      }
    }
  });
}

// src/runtime-loaders.ts
var ENGINE_SPECIFIER = "superdoc/collaboration-upgrade-engine";
async function loadAndValidateEngine(runtime) {
  let engine;
  try {
    engine = runtime?.loadEngine ? await runtime.loadEngine() : asEngine(await importOptional(ENGINE_SPECIFIER));
  } catch (error) {
    if (error instanceof CollaborationUpgradeError) throw error;
    throw new CollaborationUpgradeError(
      "UPGRADE_ENGINE_UNAVAILABLE",
      "the installed superdoc package does not provide the collaboration upgrade engine",
      { stage: "preflight", cause: error }
    );
  }
  if (typeof engine?.getCollaborationUpgradeEngineInfo !== "function" || typeof engine?.buildV2CollaborationUpgradeArtifactFromBundle !== "function" || typeof engine?.validateV2CollaborationUpgradeTarget !== "function") {
    incompatibleEngine("the installed SuperDoc upgrade engine is incomplete");
  }
  let info;
  try {
    info = engine.getCollaborationUpgradeEngineInfo();
  } catch (error) {
    throw new CollaborationUpgradeError(
      "UPGRADE_ENGINE_INCOMPATIBLE",
      "SuperDoc upgrade engine metadata failed",
      {
        stage: "preflight",
        cause: error
      }
    );
  }
  const nodeMajor = Number.parseInt(
    process.versions.node.split(".")[0] ?? "",
    10
  );
  if (!info || info.engine !== "superdoc-v2-collaboration-upgrade" || info.protocolVersion !== 1 || typeof info.superdocVersion !== "string" || info.superdocVersion.length === 0 || info.roomSchemaVersion?.major !== 2 || info.roomSchemaVersion?.minor !== 0 || info.artifactVersion !== 1 || !Array.isArray(info.supportedBundleVersions) || !info.supportedBundleVersions.includes(1) || !Array.isArray(info.supportedV1ReaderContractVersions) || !info.supportedV1ReaderContractVersions.includes(1) || info.minimumNodeMajor !== 20 || !Number.isSafeInteger(nodeMajor) || nodeMajor < info.minimumNodeMajor) {
    incompatibleEngine(
      "the installed SuperDoc upgrade engine uses an incompatible protocol or room schema",
      {
        observed: info,
        nodeVersion: process.versions.node
      }
    );
  }
  return Object.freeze({ engine, info: deepFreezeInfo(info) });
}
async function loadAndValidateReader(reader, runtime) {
  let resolved = reader;
  try {
    if (!resolved && runtime?.loadReader) resolved = await runtime.loadReader();
    if (!resolved) resolved = createFrozenV1SnapshotReader();
  } catch (error) {
    throw new CollaborationUpgradeError(
      "UPGRADE_READER_UNAVAILABLE",
      "the bundled frozen final-v1 collaboration reader is not available",
      { stage: "preflight", cause: error }
    );
  }
  if (!resolved || resolved.authority !== "frozen-final-v1" || resolved.contractVersion !== 1 || typeof resolved.readerId !== "string" || resolved.readerId.length === 0 || typeof resolved.exportDetachedSnapshot !== "function") {
    throw new CollaborationUpgradeError(
      "UPGRADE_READER_UNAVAILABLE",
      "the frozen final-v1 reader contract is incompatible",
      { stage: "preflight" }
    );
  }
  return resolved;
}
function asEngine(value) {
  return value;
}
async function importOptional(specifier) {
  return import(specifier);
}
function incompatibleEngine(message, detail) {
  throw new CollaborationUpgradeError("UPGRADE_ENGINE_INCOMPATIBLE", message, {
    stage: "preflight",
    detail
  });
}
function deepFreezeInfo(info) {
  Object.freeze(info.roomSchemaVersion);
  Object.freeze(info.supportedBundleVersions);
  Object.freeze(info.supportedV1ReaderContractVersions);
  return Object.freeze(info);
}

// src/upgrade.ts
var DEFAULT_CAPTURED_AT = "2000-01-01T00:00:00.000Z";
async function prepareCollaborationUpgrade(input) {
  const identity = validatePreparationIdentity(input);
  const [{ engine, info }, reader] = await Promise.all([
    loadAndValidateEngine(input.runtime),
    loadAndValidateReader(input.reader, input.runtime)
  ]);
  return prepareWithRuntime(input, identity, engine, info, reader);
}
async function upgradeCollaboration(input) {
  validateUpgradeInput(input);
  let active;
  try {
    active = await input.readActive(input.documentId);
  } catch (error) {
    throw new CollaborationUpgradeError("UPGRADE_ROUTING_READ_FAILED", "failed to read authoritative collaboration routing", {
      stage: "read-routing",
      cause: error
    });
  }
  if (active !== null) return validateActiveRoute(active, input);
  const [{ engine, info }, reader] = await Promise.all([
    loadAndValidateEngine(input.runtime),
    loadAndValidateReader(input.reader, input.runtime)
  ]);
  let sourceRead;
  try {
    sourceRead = await input.provider.readSource({
      documentId: input.documentId,
      sourceRoomId: input.sourceRoomId,
      ...input.commentsRoomId ? { commentsRoomId: input.commentsRoomId } : {}
    });
  } catch (error) {
    throw wrapProviderError("UPGRADE_PROVIDER_READ_FAILED", "read-source", "failed to read the v1 source room", error);
  }
  const validatedSourceRead = validateProviderSourceRead(
    sourceRead,
    input.sourceRoomId,
    input.commentsRoomId,
    "read-source"
  );
  const sourceIdentity = hashSourceIdentity(input.documentId, validatedSourceRead.snapshots);
  const sourceFencingGeneration = validatedSourceRead.fencingGeneration;
  const preparationInput = {
    documentId: input.documentId,
    sourceSnapshots: validatedSourceRead.snapshots,
    ...input.targetRoomId ? { targetRoomId: input.targetRoomId } : {},
    ...input.migrationId ? { migrationId: input.migrationId } : {},
    ...validatedSourceRead.capturedAt ? { capturedAt: validatedSourceRead.capturedAt } : {},
    ...validatedSourceRead.fencingGeneration ? { fencingGeneration: validatedSourceRead.fencingGeneration } : {},
    reader,
    filename: input.filename,
    migrationToolVersion: input.migrationToolVersion,
    fidelityPolicy: input.fidelityPolicy,
    bundleLimits: input.bundleLimits,
    artifactLimits: input.artifactLimits,
    runtime: input.runtime
  };
  const preparationIdentity = validatePreparationIdentity({
    documentId: input.documentId,
    sourceSnapshots: validatedSourceRead.snapshots,
    targetRoomId: input.targetRoomId,
    migrationId: input.migrationId
  });
  const optionsSha256 = hashPreparationOptions(input, info, reader);
  const attempt = derivePreparationAttempt(
    input.documentId,
    preparationIdentity,
    sourceIdentity,
    sourceFencingGeneration ?? void 0,
    optionsSha256
  );
  const checkpointKey = { documentId: input.documentId, attemptId: attempt.id };
  let checkpoint;
  try {
    checkpoint = await input.checkpoint.read(checkpointKey);
  } catch (error) {
    throw new CollaborationUpgradeError("UPGRADE_CHECKPOINT_FAILED", "failed to read durable upgrade preparation", {
      stage: "read-checkpoint",
      cause: error
    });
  }
  if (checkpoint === null) {
    const candidate = await prepareWithRuntime(preparationInput, preparationIdentity, engine, info, reader, attempt);
    try {
      checkpoint = await input.checkpoint.createIfAbsent({
        key: checkpointKey,
        checkpoint: {
          attemptId: attempt.id,
          sourceIdentity,
          ...sourceFencingGeneration ? { fencingGeneration: sourceFencingGeneration } : {},
          optionsSha256,
          prepared: candidate
        }
      });
    } catch (error) {
      throw new CollaborationUpgradeError("UPGRADE_CHECKPOINT_FAILED", "failed to persist upgrade preparation before target creation", {
        stage: "checkpoint",
        cause: error
      });
    }
  }
  const prepared = validatePreparationCheckpoint(
    checkpoint,
    input,
    validatedSourceRead.snapshots,
    sourceIdentity,
    sourceFencingGeneration ?? void 0,
    optionsSha256,
    attempt
  );
  if (prepared.targetRoomId === input.sourceRoomId || prepared.providerRoomName === input.sourceRoomId || input.commentsRoomId !== void 0 && (prepared.targetRoomId === input.commentsRoomId || prepared.providerRoomName === input.commentsRoomId)) {
    throw new CollaborationUpgradeError(
      "UPGRADE_TARGET_CONFLICT",
      "the v2 target must be a separate room from every v1 source room",
      { stage: "preflight-target" }
    );
  }
  let targetReceipt;
  try {
    targetReceipt = await input.provider.createTargetIfAbsent({
      migrationId: prepared.migrationId,
      documentId: input.documentId,
      targetRoomId: prepared.targetRoomId,
      providerRoomName: prepared.providerRoomName,
      update: new Uint8Array(prepared.targetUpdate),
      updateSha256: prepared.targetUpdateSha256
    });
  } catch (error) {
    throw wrapProviderError(
      "UPGRADE_TARGET_CREATE_FAILED",
      "create-target",
      "failed to create the separate v2 target room",
      error
    );
  }
  validateTargetReceipt(targetReceipt);
  let readback;
  try {
    readback = await input.provider.readTargetFresh({
      migrationId: prepared.migrationId,
      documentId: input.documentId,
      targetRoomId: prepared.targetRoomId,
      providerRoomName: prepared.providerRoomName,
      expectedStorageVersion: targetReceipt.storageVersion,
      expectedUpdateSha256: prepared.targetUpdateSha256
    });
  } catch (error) {
    throw wrapProviderError(
      "UPGRADE_TARGET_READBACK_FAILED",
      "read-target",
      "failed to read the v2 target through a fresh provider connection",
      error
    );
  }
  if (!readback || !(readback.update instanceof Uint8Array) || readback.update.byteLength === 0 || typeof readback.storageVersion !== "string" || readback.storageVersion.length === 0 || typeof readback.providerEvidence !== "string" || readback.providerEvidence.length === 0) {
    throw new CollaborationUpgradeError(
      "UPGRADE_TARGET_READBACK_FAILED",
      "the provider returned an invalid fresh target readback",
      { stage: "read-target" }
    );
  }
  if (targetReceipt.disposition === "already-existed" && sha2562(readback.update) !== prepared.targetUpdateSha256) {
    throw new CollaborationUpgradeError(
      "UPGRADE_TARGET_CONFLICT",
      "the target room is already occupied by different prepared bytes",
      { stage: "read-target" }
    );
  }
  let validation;
  try {
    validation = await engine.validateV2CollaborationUpgradeTarget({
      bundle: new Uint8Array(prepared.recoveryBundle),
      expectedBundleSha256: prepared.recoveryBundleSha256,
      update: new Uint8Array(readback.update),
      targetRootId: prepared.targetRoomId,
      expectedUpdateSha256: prepared.targetUpdateSha256,
      expectedContentDigest: prepared.contentDigest,
      migrationToolVersion: input.migrationToolVersion ?? info.superdocVersion,
      bundleLimits: input.bundleLimits
    });
  } catch (error) {
    throw new CollaborationUpgradeError(
      "UPGRADE_TARGET_VALIDATION_FAILED",
      "the fresh v2 target readback failed SuperDoc validation",
      { stage: "validate-target", cause: error }
    );
  }
  validateEngineValidation(validation, prepared);
  let sourceReadback;
  try {
    sourceReadback = await input.provider.readSource({
      documentId: input.documentId,
      sourceRoomId: input.sourceRoomId,
      ...input.commentsRoomId ? { commentsRoomId: input.commentsRoomId } : {}
    });
  } catch (error) {
    throw new CollaborationUpgradeError(
      "UPGRADE_PROVIDER_READ_FAILED",
      "failed to re-read the v1 source immediately before activation",
      { stage: "verify-source-before-activation", cause: error }
    );
  }
  const validatedSourceReadback = validateProviderSourceRead(
    sourceReadback,
    input.sourceRoomId,
    input.commentsRoomId,
    "verify-source-before-activation"
  );
  const sourceIdentityReadback = hashSourceIdentity(input.documentId, validatedSourceReadback.snapshots);
  const sourceFencingGenerationReadback = validatedSourceReadback.fencingGeneration;
  if (sourceIdentityReadback !== sourceIdentity || sourceFencingGenerationReadback !== sourceFencingGeneration) {
    throw new CollaborationUpgradeError(
      "UPGRADE_SOURCE_CHANGED",
      "the v1 source changed while the v2 target was being prepared; activation was not attempted",
      {
        stage: "verify-source-before-activation",
        detail: {
          expectedSourceIdentity: sourceIdentity,
          actualSourceIdentity: sourceIdentityReadback,
          expectedFencingGeneration: sourceFencingGeneration,
          actualFencingGeneration: sourceFencingGenerationReadback
        }
      }
    );
  }
  const resume = Object.freeze({
    protocolVersion: 1,
    migrationId: prepared.migrationId,
    documentId: input.documentId,
    targetRoomId: prepared.targetRoomId,
    providerRoomName: prepared.providerRoomName,
    recoveryBundleSha256: prepared.recoveryBundleSha256,
    targetUpdateSha256: prepared.targetUpdateSha256
  });
  const activationIdempotencyKey = `sd2-activate-${sha2562(
    `${prepared.migrationId}\0${input.documentId}\0${prepared.targetRoomId}\0${prepared.targetUpdateSha256}`
  )}`;
  let activationDecision;
  try {
    activationDecision = await input.activate({
      protocolVersion: 1,
      idempotencyKey: activationIdempotencyKey,
      migrationId: prepared.migrationId,
      documentId: input.documentId,
      sourceRoomId: input.sourceRoomId,
      ...input.commentsRoomId ? { commentsRoomId: input.commentsRoomId } : {},
      sourceIdentity,
      ...sourceFencingGeneration ? { fencingGeneration: sourceFencingGeneration } : {},
      targetRoomId: prepared.targetRoomId,
      providerRoomName: prepared.providerRoomName,
      recoveryBundleSha256: prepared.recoveryBundleSha256,
      targetUpdateSha256: prepared.targetUpdateSha256,
      validation,
      providerEvidence: readback.providerEvidence,
      evidenceTier: input.provider.evidenceTier,
      targetDisposition: targetReceipt.disposition
    });
  } catch (error) {
    throw new CollaborationUpgradeError(
      "UPGRADE_ACTIVATION_FAILED",
      "the v2 target is valid, but the customer activation callback failed; retrying an unchanged attempt reuses its preparation",
      { stage: "activate", cause: error, resume }
    );
  }
  const activation = validateActivationDecision(
    activationDecision,
    activationIdempotencyKey,
    prepared,
    input.documentId,
    resume
  );
  const result = Object.freeze({
    state: "activated",
    migrationId: prepared.migrationId,
    documentId: input.documentId,
    sourceRoomId: input.sourceRoomId,
    ...input.commentsRoomId ? { commentsRoomId: input.commentsRoomId } : {},
    targetRoomId: prepared.targetRoomId,
    providerRoomName: prepared.providerRoomName,
    evidenceTier: input.provider.evidenceTier,
    providerEvidence: readback.providerEvidence,
    targetDisposition: targetReceipt.disposition,
    recoveryBundleSha256: prepared.recoveryBundleSha256,
    targetUpdateSha256: prepared.targetUpdateSha256,
    validation,
    activation
  });
  let persisted;
  try {
    persisted = await input.readActive(input.documentId);
  } catch (error) {
    throw new CollaborationUpgradeError("UPGRADE_ROUTING_READ_FAILED", "activation succeeded, but the authoritative routing readback failed", {
      stage: "verify-routing",
      cause: error,
      resume
    });
  }
  if (persisted === null) {
    throw new CollaborationUpgradeError("UPGRADE_ACTIVATION_RECEIPT_INVALID", "activation did not persist an authoritative routing result", {
      stage: "verify-routing",
      resume
    });
  }
  validateActiveRoute(persisted, input);
  if (persisted.migrationId !== result.migrationId || persisted.targetRoomId !== result.targetRoomId || persisted.providerRoomName !== result.providerRoomName || persisted.recoveryBundleSha256 !== result.recoveryBundleSha256 || persisted.targetUpdateSha256 !== result.targetUpdateSha256 || persisted.activation.idempotencyKey !== result.activation.idempotencyKey || persisted.activation.routingVersion !== result.activation.routingVersion || persisted.validation.contentDigest !== result.validation.contentDigest) {
    throw new CollaborationUpgradeError("UPGRADE_ACTIVATION_RECEIPT_INVALID", "routing readback does not match the validated target", {
      stage: "verify-routing",
      resume
    });
  }
  return persisted;
}
async function prepareWithRuntime(input, identity, engine, info, reader, knownAttempt) {
  const source = normalizeSourceSnapshots(input.sourceSnapshots);
  const sourceIdentity = hashSourceIdentity(input.documentId, source);
  const attempt = knownAttempt ?? derivePreparationAttempt(
    input.documentId,
    identity,
    sourceIdentity,
    input.fencingGeneration,
    hashPreparationOptions(input, info, reader)
  );
  const { migrationId, targetRoomId } = attempt;
  const capturedAt = normalizeTimestamp(input.capturedAt, sourceIdentity);
  const fencingGeneration = input.fencingGeneration ?? `maintenance-${sourceIdentity}`;
  const deterministicReader = withExportTimestamp(reader, capturedAt);
  let bundle;
  try {
    bundle = await prepareV1UpgradeBundle({
      sourceCheckpoint: {
        protocolVersion: 1,
        migrationId,
        logicalDocumentId: input.documentId,
        topology: source.some((snapshot) => snapshot.role === "comments") ? "split-comments" : "single-room",
        fencingGeneration,
        capturedAt,
        snapshots: source.map((snapshot) => ({
          ...snapshot,
          sha256: sha2562(snapshot.update),
          stateVectorSha256: snapshot.stateVector ? sha2562(snapshot.stateVector) : null
        }))
      },
      reader: deterministicReader,
      fidelityPolicy: input.fidelityPolicy,
      limits: input.bundleLimits
    });
  } catch (error) {
    throw new CollaborationUpgradeError(
      "UPGRADE_SOURCE_CONVERSION_FAILED",
      "the final-v1 reader could not create a lossless recovery bundle",
      { stage: "convert-source", cause: error }
    );
  }
  let artifact;
  try {
    artifact = await engine.buildV2CollaborationUpgradeArtifactFromBundle({
      bundle: new Uint8Array(bundle.bytes),
      expectedBundleSha256: bundle.bundleSha256,
      targetRootId: targetRoomId,
      migrationToolVersion: input.migrationToolVersion ?? info.superdocVersion,
      filename: input.filename,
      bundleLimits: input.bundleLimits,
      artifactLimits: input.artifactLimits
    });
  } catch (error) {
    throw new CollaborationUpgradeError(
      "UPGRADE_TARGET_BUILD_FAILED",
      "the installed SuperDoc engine could not build a v2 target",
      { stage: "build-target", cause: error }
    );
  }
  validateEngineArtifact(artifact, migrationId, targetRoomId);
  const recoveryBytes = new Uint8Array(bundle.bytes);
  const targetBytes = new Uint8Array(artifact.update);
  return Object.freeze({
    protocolVersion: 1,
    migrationId,
    documentId: input.documentId,
    targetRoomId,
    providerRoomName: artifact.providerRoomName,
    sourceSnapshots: Object.freeze(
      source.map(
        (snapshot) => Object.freeze({
          role: snapshot.role,
          roomId: snapshot.roomId,
          sha256: sha2562(snapshot.update),
          storageVersion: snapshot.storageVersion
        })
      )
    ),
    recoveryBundleSha256: bundle.bundleSha256,
    recoveryBundleByteLength: recoveryBytes.byteLength,
    get recoveryBundle() {
      return new Uint8Array(recoveryBytes);
    },
    targetUpdateSha256: artifact.updateSha256,
    targetUpdateByteLength: targetBytes.byteLength,
    get targetUpdate() {
      return new Uint8Array(targetBytes);
    },
    contentDigest: artifact.contentDigest,
    engine: info
  });
}
function validatePreparationIdentity(input) {
  assertNonEmpty(input?.documentId, "documentId");
  if (!Array.isArray(input.sourceSnapshots) || input.sourceSnapshots.length === 0) {
    invalidInput("sourceSnapshots must contain the document room");
  }
  if (input.migrationId !== void 0) assertNonEmpty(input.migrationId, "migrationId");
  if (input.targetRoomId !== void 0) assertNonEmpty(input.targetRoomId, "targetRoomId");
  return {
    ...input.migrationId ? { migrationId: input.migrationId } : {},
    ...input.targetRoomId ? { targetRoomId: input.targetRoomId } : {}
  };
}
function validateUpgradeInput(input) {
  assertNonEmpty(input?.documentId, "documentId");
  assertNonEmpty(input?.sourceRoomId, "sourceRoomId");
  if (input.commentsRoomId !== void 0) assertNonEmpty(input.commentsRoomId, "commentsRoomId");
  if (input.commentsRoomId === input.sourceRoomId) invalidInput("commentsRoomId must be distinct from sourceRoomId");
  if (input.targetRoomId !== void 0) {
    assertNonEmpty(input.targetRoomId, "targetRoomId");
    if (input.targetRoomId === input.sourceRoomId || input.targetRoomId === input.commentsRoomId) {
      invalidInput("targetRoomId must be distinct from every v1 source room");
    }
  }
  if (typeof input?.activate !== "function") invalidInput("activate callback is required");
  if (typeof input?.readActive !== "function") invalidInput("readActive callback is required");
  if (typeof input?.checkpoint?.read !== "function" || typeof input.checkpoint.createIfAbsent !== "function") {
    invalidInput("a durable checkpoint store with read and createIfAbsent is required");
  }
  const provider = input?.provider;
  if (!provider || typeof provider.providerId !== "string" || provider.providerId.length === 0 || !["authoritative-persistence", "hosted-persistence", "synchronized-provider"].includes(provider.evidenceTier) || typeof provider.readSource !== "function" || typeof provider.createTargetIfAbsent !== "function" || typeof provider.readTargetFresh !== "function") {
    throw new CollaborationUpgradeError(
      "UPGRADE_PROVIDER_CONTRACT_INVALID",
      "provider must implement the collaboration upgrade adapter contract",
      { stage: "preflight" }
    );
  }
}
function validateActivationDecision(decision, idempotencyKey, prepared, documentId, resume) {
  let disposition;
  let routingVersion;
  try {
    disposition = decision?.disposition;
    routingVersion = decision?.routingVersion;
  } catch {
  }
  if (disposition !== "activated" && disposition !== "already-active" || typeof routingVersion !== "string" || routingVersion.trim().length === 0) {
    throw new CollaborationUpgradeError(
      "UPGRADE_ACTIVATION_RECEIPT_INVALID",
      "activation must return an idempotent routing decision with a durable routingVersion",
      { stage: "activate", resume }
    );
  }
  return Object.freeze({
    protocolVersion: 1,
    idempotencyKey,
    migrationId: prepared.migrationId,
    documentId,
    targetRoomId: prepared.targetRoomId,
    providerRoomName: prepared.providerRoomName,
    disposition,
    routingVersion
  });
}
function validateProviderSourceRead(read, sourceRoomId, commentsRoomId, stage) {
  try {
    const snapshots = read?.snapshots;
    const providerEvidence = read?.providerEvidence;
    const capturedAt = read?.capturedAt;
    const fencingGeneration = read?.fencingGeneration;
    if (!read || !Array.isArray(snapshots) || typeof providerEvidence !== "string" || providerEvidence.trim().length === 0 || capturedAt !== void 0 && !isCanonicalTimestamp(capturedAt) || fencingGeneration !== void 0 && (typeof fencingGeneration !== "string" || fencingGeneration.trim().length === 0)) {
      throw new Error("invalid source read envelope");
    }
    const normalized = normalizeSourceSnapshots(snapshots);
    const expected = commentsRoomId ? [`document:${sourceRoomId}`, `comments:${commentsRoomId}`] : [`document:${sourceRoomId}`];
    const actual = normalized.map((snapshot) => `${snapshot.role}:${snapshot.roomId}`).sort();
    if (expected.sort().join("\0") !== actual.join("\0")) {
      throw new CollaborationUpgradeError(
        "UPGRADE_PROVIDER_READ_FAILED",
        "provider source read does not match the requested v1 room topology",
        { stage, detail: { expected, actual } }
      );
    }
    return Object.freeze({
      snapshots: normalized,
      capturedAt: capturedAt ?? null,
      fencingGeneration: fencingGeneration ?? null
    });
  } catch (error) {
    if (error instanceof CollaborationUpgradeError && error.code === "UPGRADE_PROVIDER_READ_FAILED") throw error;
    throw new CollaborationUpgradeError("UPGRADE_PROVIDER_READ_FAILED", "provider returned an invalid source read", {
      stage,
      cause: error
    });
  }
}
function normalizeSourceSnapshots(snapshots) {
  const roles = /* @__PURE__ */ new Set();
  const rooms = /* @__PURE__ */ new Set();
  const normalized = snapshots.map((snapshot) => {
    if (!snapshot || snapshot.role !== "document" && snapshot.role !== "comments" || roles.has(snapshot.role) || typeof snapshot.roomId !== "string" || snapshot.roomId.length === 0 || rooms.has(snapshot.roomId) || !(snapshot.update instanceof Uint8Array) || snapshot.update.byteLength === 0 || snapshot.stateVector !== void 0 && snapshot.stateVector !== null && !(snapshot.stateVector instanceof Uint8Array) || typeof snapshot.storageVersion !== "string" || snapshot.storageVersion.length === 0 || snapshot.sourceSchemaVersion !== void 0 && snapshot.sourceSchemaVersion !== null && typeof snapshot.sourceSchemaVersion !== "string") {
      invalidInput("source snapshot topology or bytes are invalid");
    }
    roles.add(snapshot.role);
    rooms.add(snapshot.roomId);
    return Object.freeze({
      role: snapshot.role,
      roomId: snapshot.roomId,
      update: new Uint8Array(snapshot.update),
      stateVector: snapshot.stateVector ? new Uint8Array(snapshot.stateVector) : null,
      storageVersion: snapshot.storageVersion,
      sourceSchemaVersion: snapshot.sourceSchemaVersion ?? null
    });
  });
  if (!roles.has("document") || roles.has("comments") && normalized.length !== 2 || normalized.length > 2) {
    invalidInput("source snapshots must contain one document and at most one comments room");
  }
  return Object.freeze(normalized);
}
function withExportTimestamp(reader, exportedAt) {
  return Object.freeze({
    readerId: reader.readerId,
    contractVersion: 1,
    authority: "frozen-final-v1",
    async exportDetachedSnapshot(input) {
      const result = await reader.exportDetachedSnapshot({
        ...input,
        snapshots: input.snapshots.map((snapshot) => ({
          ...snapshot,
          update: new Uint8Array(snapshot.update),
          sha256: sha2562(snapshot.update)
        }))
      });
      return { ...result, exportedAt };
    }
  });
}
function hashSourceIdentity(documentId, snapshots) {
  const identity = snapshots.map(
    (snapshot) => `${snapshot.role}\0${snapshot.roomId}\0${snapshot.storageVersion}\0${snapshot.sourceSchemaVersion ?? ""}\0${sha2562(snapshot.update)}`
  ).sort().join("\0");
  return sha2562(`${documentId}\0${identity}`);
}
function hashPreparationOptions(input, info, reader) {
  return sha2562(JSON.stringify({
    readerId: reader.readerId,
    engine: info,
    filename: input.filename ?? null,
    migrationToolVersion: input.migrationToolVersion ?? info.superdocVersion,
    fidelityPolicy: input.fidelityPolicy ?? null,
    bundleLimits: sortedEntries(input.bundleLimits),
    artifactLimits: sortedEntries(input.artifactLimits)
  }));
}
function derivePreparationAttempt(documentId, identity, sourceIdentity, fencingGeneration, optionsSha256) {
  const id = sha2562(JSON.stringify({
    protocolVersion: 1,
    documentId,
    sourceIdentity,
    fencingGeneration: fencingGeneration ?? `maintenance-${sourceIdentity}`,
    optionsSha256,
    migrationId: identity.migrationId ?? null,
    targetRoomId: identity.targetRoomId ?? null
  }));
  return {
    id,
    migrationId: identity.migrationId ?? `sd-upgrade-${id.slice(0, 32)}`,
    targetRoomId: identity.targetRoomId ?? `sd2-upgrade-${sha2562(`${documentId}\0${id}`).slice(0, 32)}`
  };
}
function sortedEntries(record) {
  return Object.entries(record ?? {}).sort(([left], [right]) => left.localeCompare(right));
}
function validatePreparationCheckpoint(checkpoint, input, snapshots, sourceIdentity, fencingGeneration, optionsSha256, attempt) {
  const prepared = checkpoint?.prepared;
  if (checkpoint?.attemptId !== attempt.id || checkpoint?.sourceIdentity !== sourceIdentity || checkpoint?.fencingGeneration !== fencingGeneration || checkpoint?.optionsSha256 !== optionsSha256 || prepared?.protocolVersion !== 1 || prepared.documentId !== input.documentId || prepared.migrationId !== attempt.migrationId || prepared.targetRoomId !== attempt.targetRoomId || typeof prepared.providerRoomName !== "string" || !prepared.providerRoomName || !Array.isArray(prepared.sourceSnapshots) || prepared.sourceSnapshots.length !== snapshots.length || snapshots.some((snapshot) => !prepared.sourceSnapshots.some((saved) => saved.role === snapshot.role && saved.roomId === snapshot.roomId && saved.storageVersion === snapshot.storageVersion && saved.sha256 === sha2562(snapshot.update))) || !(prepared.recoveryBundle instanceof Uint8Array) || prepared.recoveryBundle.byteLength !== prepared.recoveryBundleByteLength || sha2562(prepared.recoveryBundle) !== prepared.recoveryBundleSha256 || !(prepared.targetUpdate instanceof Uint8Array) || prepared.targetUpdate.byteLength !== prepared.targetUpdateByteLength || sha2562(prepared.targetUpdate) !== prepared.targetUpdateSha256 || !isSha256(prepared.contentDigest)) {
    throw new CollaborationUpgradeError("UPGRADE_CHECKPOINT_CONFLICT", "stored preparation does not match the fenced source or its verified binary payloads", {
      stage: "read-checkpoint"
    });
  }
  return prepared;
}
function validateActiveRoute(active, input) {
  const expectedKey = `sd2-activate-${sha2562(
    `${active.migrationId}\0${input.documentId}\0${active.targetRoomId}\0${active.targetUpdateSha256}`
  )}`;
  if (active?.state !== "activated" || active.documentId !== input.documentId || active.sourceRoomId !== input.sourceRoomId || active.commentsRoomId !== input.commentsRoomId || input.migrationId !== void 0 && active.migrationId !== input.migrationId || input.targetRoomId !== void 0 && active.targetRoomId !== input.targetRoomId || !isSha256(active.recoveryBundleSha256) || !isSha256(active.targetUpdateSha256) || typeof active.providerRoomName !== "string" || !active.providerRoomName || active.activation?.protocolVersion !== 1 || active.activation.migrationId !== active.migrationId || active.activation.documentId !== input.documentId || active.activation.targetRoomId !== active.targetRoomId || active.activation.providerRoomName !== active.providerRoomName || active.activation.idempotencyKey !== expectedKey || active.activation.disposition !== "activated" && active.activation.disposition !== "already-active" || typeof active.activation.routingVersion !== "string" || !active.activation.routingVersion.trim() || active.validation?.ok !== true || active.validation.updateSha256 !== active.targetUpdateSha256 || !isSha256(active.validation.contentDigest) || typeof active.providerEvidence !== "string" || !active.providerEvidence || active.evidenceTier !== input.provider.evidenceTier || active.targetDisposition !== "created" && active.targetDisposition !== "already-existed") {
    throw new CollaborationUpgradeError("UPGRADE_ACTIVATION_RECEIPT_INVALID", "authoritative routing record does not match the requested migration", {
      stage: "read-routing"
    });
  }
  return active;
}
function normalizeTimestamp(value, sourceIdentity) {
  if (value !== void 0) {
    if (!isCanonicalTimestamp(value)) {
      invalidInput("capturedAt must be a canonical ISO timestamp");
    }
    return value;
  }
  const offset = Number.parseInt(sourceIdentity.slice(0, 8), 16) % (365 * 24 * 60 * 60 * 1e3);
  return new Date(Date.parse(DEFAULT_CAPTURED_AT) + offset).toISOString();
}
function isCanonicalTimestamp(value) {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}
function validateEngineArtifact(artifact, migrationId, targetRoomId) {
  if (!artifact || artifact.schemaVersion !== 1 || artifact.migrationId !== migrationId || artifact.targetRootId !== targetRoomId || typeof artifact.providerRoomName !== "string" || artifact.providerRoomName.length === 0 || !(artifact.update instanceof Uint8Array) || artifact.update.byteLength === 0 || artifact.updateByteLength !== artifact.update.byteLength || artifact.updateSha256 !== sha2562(artifact.update) || !isSha256(artifact.sourceCarrierSha256) || !isSha256(artifact.normalizedCarrierSha256) || !isSha256(artifact.contentDigest) || !Array.isArray(artifact.contentUnitIds) || artifact.contentUnitIds.length === 0 || new Set(artifact.contentUnitIds).size !== artifact.contentUnitIds.length || artifact.contentUnitIds.some((id) => typeof id !== "string" || id.length === 0) || !artifact.validation || typeof artifact.validation !== "object") {
    throw new CollaborationUpgradeError(
      "UPGRADE_ENGINE_INCOMPATIBLE",
      "the installed SuperDoc engine returned an invalid target artifact",
      { stage: "build-target" }
    );
  }
}
function validateEngineValidation(validation, prepared) {
  if (!validation || validation.ok !== true || validation.updateSha256 !== prepared.targetUpdateSha256 || validation.contentDigest !== prepared.contentDigest || !isSha256(validation.freshExportSha256) || !validation.carrierToFreshPackage || typeof validation.carrierToFreshPackage !== "object" || validation.carrierToFreshPackage.equal !== true) {
    throw new CollaborationUpgradeError(
      "UPGRADE_TARGET_VALIDATION_FAILED",
      "the installed SuperDoc engine returned an inconsistent validation result",
      { stage: "validate-target" }
    );
  }
}
function validateTargetReceipt(receipt) {
  if (!receipt || receipt.disposition !== "created" && receipt.disposition !== "already-existed" || typeof receipt.storageVersion !== "string" || receipt.storageVersion.length === 0 || typeof receipt.durabilityEvidence !== "string" || receipt.durabilityEvidence.length === 0) {
    throw new CollaborationUpgradeError(
      "UPGRADE_PROVIDER_CONTRACT_INVALID",
      "provider returned an invalid target creation receipt",
      { stage: "create-target" }
    );
  }
}
function wrapProviderError(code, stage, message, cause) {
  if (cause instanceof CollaborationUpgradeError) return cause;
  return new CollaborationUpgradeError(code, message, { stage, cause });
}
function assertNonEmpty(value, field) {
  if (typeof value !== "string" || value.length === 0) invalidInput(`${field} must be a non-empty string`);
}
function invalidInput(message) {
  throw new CollaborationUpgradeError("UPGRADE_INPUT_INVALID", message, { stage: "preflight" });
}
function sha2562(value) {
  return createHash2("sha256").update(value).digest("hex");
}
function isSha256(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

// src/types.ts
var COLLABORATION_UPGRADE_PROTOCOL_VERSION = 1;
export {
  COLLABORATION_UPGRADE_PROTOCOL_VERSION,
  CollaborationUpgradeError,
  prepareCollaborationUpgrade,
  upgradeCollaboration
};
