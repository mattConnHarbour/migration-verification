declare const COLLABORATION_UPGRADE_PROTOCOL_VERSION: 1;
type CollaborationUpgradeEvidenceTier = "authoritative-persistence" | "hosted-persistence" | "synchronized-provider";
type CollaborationUpgradeSourceRole = "document" | "comments";
interface CollaborationUpgradeSourceSnapshot {
    readonly role: CollaborationUpgradeSourceRole;
    readonly roomId: string;
    readonly update: Uint8Array;
    readonly stateVector?: Uint8Array | null;
    readonly storageVersion: string;
    readonly sourceSchemaVersion?: string | null;
}
interface CollaborationUpgradeSourceRead {
    readonly snapshots: ReadonlyArray<CollaborationUpgradeSourceSnapshot>;
    /** A stable timestamp from authoritative storage, when available. */
    readonly capturedAt?: string;
    /** The maintenance fence or storage generation represented by this read. */
    readonly fencingGeneration?: string;
    readonly providerEvidence: string;
}
interface CollaborationUpgradeTargetCreateReceipt {
    readonly disposition: "created" | "already-existed";
    readonly storageVersion: string;
    readonly durabilityEvidence: string;
}
interface CollaborationUpgradeTargetReadback {
    readonly update: Uint8Array;
    readonly storageVersion: string;
    readonly providerEvidence: string;
}
interface CollaborationUpgradeProviderAdapter {
    readonly providerId: string;
    readonly evidenceTier: CollaborationUpgradeEvidenceTier;
    /** Must return the current complete source state; the upgrade reads it again before activation. */
    readSource(input: {
        readonly documentId: string;
        readonly sourceRoomId: string;
        readonly commentsRoomId?: string;
    }): Promise<CollaborationUpgradeSourceRead>;
    /** Must never overwrite or merge into an unrelated existing target. */
    createTargetIfAbsent(input: {
        readonly migrationId: string;
        readonly documentId: string;
        readonly targetRoomId: string;
        readonly providerRoomName: string;
        readonly update: Uint8Array;
        readonly updateSha256: string;
    }): Promise<CollaborationUpgradeTargetCreateReceipt>;
    /** Must bypass process-local document caches and establish a fresh read. */
    readTargetFresh(input: {
        readonly migrationId: string;
        readonly documentId: string;
        readonly targetRoomId: string;
        readonly providerRoomName: string;
        readonly expectedStorageVersion: string;
        readonly expectedUpdateSha256: string;
    }): Promise<CollaborationUpgradeTargetReadback>;
}
interface FrozenV1SnapshotReader {
    readonly readerId: string;
    readonly contractVersion: 1;
    readonly authority: "frozen-final-v1";
    exportDetachedSnapshot(input: {
        readonly logicalDocumentId: string;
        readonly topology: "single-room" | "split-comments";
        readonly snapshots: ReadonlyArray<{
            readonly role: CollaborationUpgradeSourceRole;
            readonly roomId: string;
            readonly sha256: string;
            readonly sourceSchemaVersion: string | null;
            readonly update: Uint8Array;
        }>;
    }): Promise<{
        readonly docx: Uint8Array;
        readonly sidecars?: ReadonlyArray<{
            readonly name: string;
            readonly schemaVersion: number;
            readonly mediaType: string;
            readonly bytes: Uint8Array;
        }>;
        readonly diagnostics?: ReadonlyArray<{
            readonly code: string;
            readonly severity: "info" | "warning" | "fatal";
            readonly message: string;
            readonly feature?: string | null;
        }>;
        readonly featureInventory?: Readonly<Record<string, number | boolean | string>>;
        readonly exportedAt: string;
        readonly exportToolVersion: string;
    }>;
}
interface CollaborationUpgradeEngineInfo {
    readonly engine: "superdoc-v2-collaboration-upgrade";
    readonly protocolVersion: 1;
    readonly superdocVersion: string;
    readonly roomSchemaVersion: {
        readonly major: 2;
        readonly minor: 0;
    };
    readonly artifactVersion: 1;
    readonly supportedBundleVersions: readonly [1];
    readonly supportedV1ReaderContractVersions: readonly [1];
    readonly minimumNodeMajor: 20;
}
interface CollaborationUpgradeEngineArtifact {
    readonly schemaVersion: 1;
    readonly migrationId: string;
    readonly targetRootId: string;
    readonly providerRoomName: string;
    readonly sourceCarrierSha256: string;
    readonly normalizedCarrierSha256: string;
    readonly updateSha256: string;
    readonly updateByteLength: number;
    readonly update: Uint8Array;
    readonly contentDigest: string;
    readonly contentUnitIds: ReadonlyArray<string>;
    readonly validation: Readonly<Record<string, unknown>>;
}
interface CollaborationUpgradeValidation {
    readonly ok: true;
    readonly updateSha256: string;
    readonly contentDigest: string;
    readonly freshExportSha256: string;
    readonly carrierToFreshPackage: Readonly<Record<string, unknown>>;
}
interface CollaborationUpgradeEngine {
    readonly getCollaborationUpgradeEngineInfo: () => CollaborationUpgradeEngineInfo;
    readonly buildV2CollaborationUpgradeArtifactFromBundle: (input: {
        readonly bundle: Uint8Array;
        readonly expectedBundleSha256?: string;
        readonly targetRootId: string;
        readonly migrationToolVersion: string;
        readonly filename?: string | null;
        readonly bundleLimits?: Readonly<Record<string, number | undefined>>;
        readonly artifactLimits?: Readonly<Record<string, number | undefined>>;
    }) => Promise<CollaborationUpgradeEngineArtifact>;
    readonly validateV2CollaborationUpgradeTarget: (input: {
        readonly bundle: Uint8Array;
        readonly expectedBundleSha256?: string;
        readonly update: Uint8Array;
        readonly targetRootId: string;
        readonly expectedUpdateSha256: string;
        readonly expectedContentDigest: string;
        readonly migrationToolVersion: string;
        readonly reopenBuffer?: Uint8Array;
        readonly bundleLimits?: Readonly<Record<string, number | undefined>>;
    }) => Promise<CollaborationUpgradeValidation>;
}
interface CollaborationUpgradeRuntime {
    /** Test/host injection seam; normal customers use the installed SuperDoc export. */
    readonly loadEngine?: () => Promise<CollaborationUpgradeEngine>;
    /** Test/host injection seam; normal customers use the process-isolated reader bundled here. */
    readonly loadReader?: () => Promise<FrozenV1SnapshotReader>;
}
interface PrepareCollaborationUpgradeInput {
    readonly documentId: string;
    readonly sourceSnapshots: ReadonlyArray<CollaborationUpgradeSourceSnapshot>;
    readonly targetRoomId?: string;
    readonly migrationId?: string;
    readonly capturedAt?: string;
    readonly fencingGeneration?: string;
    readonly reader?: FrozenV1SnapshotReader;
    readonly filename?: string | null;
    readonly migrationToolVersion?: string;
    readonly fidelityPolicy?: {
        readonly mode: "strict";
        readonly allowWarningCodes?: ReadonlyArray<string>;
    };
    readonly bundleLimits?: Readonly<Record<string, number | undefined>>;
    readonly artifactLimits?: Readonly<Record<string, number | undefined>>;
    readonly runtime?: CollaborationUpgradeRuntime;
}
interface PreparedCollaborationUpgrade {
    readonly protocolVersion: 1;
    readonly migrationId: string;
    readonly documentId: string;
    readonly targetRoomId: string;
    readonly providerRoomName: string;
    readonly sourceSnapshots: ReadonlyArray<{
        readonly role: CollaborationUpgradeSourceRole;
        readonly roomId: string;
        readonly sha256: string;
        readonly storageVersion: string;
    }>;
    readonly recoveryBundleSha256: string;
    readonly recoveryBundleByteLength: number;
    /** Exact v1 recovery data. Store this if you need an external recovery checkpoint. */
    readonly recoveryBundle: Uint8Array;
    readonly targetUpdateSha256: string;
    readonly targetUpdateByteLength: number;
    readonly targetUpdate: Uint8Array;
    readonly contentDigest: string;
    readonly engine: CollaborationUpgradeEngineInfo;
}
interface CollaborationUpgradePreparationCheckpoint {
    readonly attemptId: string;
    readonly sourceIdentity: string;
    readonly fencingGeneration?: string;
    readonly optionsSha256: string;
    readonly prepared: PreparedCollaborationUpgrade;
}
interface CollaborationUpgradeCheckpointKey {
    readonly documentId: string;
    readonly attemptId: string;
}
interface CollaborationUpgradeCheckpointStore {
    read(key: CollaborationUpgradeCheckpointKey): Promise<CollaborationUpgradePreparationCheckpoint | null>;
    createIfAbsent(input: {
        readonly key: CollaborationUpgradeCheckpointKey;
        readonly checkpoint: CollaborationUpgradePreparationCheckpoint;
    }): Promise<CollaborationUpgradePreparationCheckpoint>;
}
interface UpgradeCollaborationActivationInput {
    readonly protocolVersion: 1;
    /** Stable across retries; use this as the key for the routing compare-and-set. */
    readonly idempotencyKey: string;
    readonly migrationId: string;
    readonly documentId: string;
    readonly sourceRoomId: string;
    readonly commentsRoomId?: string;
    /** Identity of the exact fenced v1 snapshots prepared for this attempt. */
    readonly sourceIdentity: string;
    /** Compare this generation in the routing transaction when the provider supplies one. */
    readonly fencingGeneration?: string;
    readonly targetRoomId: string;
    readonly providerRoomName: string;
    readonly recoveryBundleSha256: string;
    readonly targetUpdateSha256: string;
    readonly validation: CollaborationUpgradeValidation;
    readonly providerEvidence: string;
    readonly evidenceTier: CollaborationUpgradeEvidenceTier;
    readonly targetDisposition: "created" | "already-existed";
}
interface CollaborationUpgradeActivationDecision {
    /** `already-active` is the successful response to a repeated compare-and-set. */
    readonly disposition: "activated" | "already-active";
    /** Durable version/etag returned by the customer-owned routing store. */
    readonly routingVersion: string;
}
interface CollaborationUpgradeActivationReceipt extends CollaborationUpgradeActivationDecision {
    readonly protocolVersion: 1;
    readonly idempotencyKey: string;
    readonly migrationId: string;
    readonly documentId: string;
    readonly targetRoomId: string;
    readonly providerRoomName: string;
}
interface UpgradeCollaborationInput {
    readonly documentId: string;
    readonly sourceRoomId: string;
    readonly commentsRoomId?: string;
    readonly targetRoomId?: string;
    readonly migrationId?: string;
    readonly provider: CollaborationUpgradeProviderAdapter;
    readonly checkpoint: CollaborationUpgradeCheckpointStore;
    readonly readActive: (documentId: string) => Promise<UpgradeCollaborationResult | null>;
    readonly activate: (input: UpgradeCollaborationActivationInput) => Promise<CollaborationUpgradeActivationDecision>;
    readonly reader?: FrozenV1SnapshotReader;
    readonly filename?: string | null;
    readonly migrationToolVersion?: string;
    readonly fidelityPolicy?: PrepareCollaborationUpgradeInput["fidelityPolicy"];
    readonly bundleLimits?: PrepareCollaborationUpgradeInput["bundleLimits"];
    readonly artifactLimits?: PrepareCollaborationUpgradeInput["artifactLimits"];
    readonly runtime?: CollaborationUpgradeRuntime;
}
interface UpgradeCollaborationResult {
    readonly state: "activated";
    readonly migrationId: string;
    readonly documentId: string;
    readonly sourceRoomId: string;
    readonly commentsRoomId?: string;
    readonly targetRoomId: string;
    readonly providerRoomName: string;
    readonly evidenceTier: CollaborationUpgradeEvidenceTier;
    readonly providerEvidence: string;
    readonly targetDisposition: "created" | "already-existed";
    readonly recoveryBundleSha256: string;
    readonly targetUpdateSha256: string;
    readonly validation: CollaborationUpgradeValidation;
    readonly activation: CollaborationUpgradeActivationReceipt;
}
interface CollaborationUpgradeResumeToken {
    readonly protocolVersion: 1;
    readonly migrationId: string;
    readonly documentId: string;
    readonly targetRoomId: string;
    readonly providerRoomName: string;
    readonly recoveryBundleSha256: string;
    readonly targetUpdateSha256: string;
}

export { type CollaborationUpgradeTargetCreateReceipt as C, type FrozenV1SnapshotReader as F, type PrepareCollaborationUpgradeInput as P, type UpgradeCollaborationInput as U, type CollaborationUpgradeSourceRole as a, type CollaborationUpgradeProviderAdapter as b, type CollaborationUpgradeResumeToken as c, type PreparedCollaborationUpgrade as d, type UpgradeCollaborationResult as e, COLLABORATION_UPGRADE_PROTOCOL_VERSION as f, type CollaborationUpgradeActivationDecision as g, type CollaborationUpgradeActivationReceipt as h, type CollaborationUpgradeCheckpointKey as i, type CollaborationUpgradeCheckpointStore as j, type CollaborationUpgradeEngine as k, type CollaborationUpgradeEngineArtifact as l, type CollaborationUpgradeEngineInfo as m, type CollaborationUpgradeEvidenceTier as n, type CollaborationUpgradePreparationCheckpoint as o, type CollaborationUpgradeRuntime as p, type CollaborationUpgradeSourceRead as q, type CollaborationUpgradeSourceSnapshot as r, type CollaborationUpgradeTargetReadback as s, type CollaborationUpgradeValidation as t, type UpgradeCollaborationActivationInput as u };
