import { c as CollaborationUpgradeResumeToken, P as PrepareCollaborationUpgradeInput, d as PreparedCollaborationUpgrade, U as UpgradeCollaborationInput, e as UpgradeCollaborationResult } from './types-Cq_iw5JD.js';
export { f as COLLABORATION_UPGRADE_PROTOCOL_VERSION, g as CollaborationUpgradeActivationDecision, h as CollaborationUpgradeActivationReceipt, i as CollaborationUpgradeCheckpointKey, j as CollaborationUpgradeCheckpointStore, k as CollaborationUpgradeEngine, l as CollaborationUpgradeEngineArtifact, m as CollaborationUpgradeEngineInfo, n as CollaborationUpgradeEvidenceTier, o as CollaborationUpgradePreparationCheckpoint, b as CollaborationUpgradeProviderAdapter, p as CollaborationUpgradeRuntime, q as CollaborationUpgradeSourceRead, a as CollaborationUpgradeSourceRole, r as CollaborationUpgradeSourceSnapshot, C as CollaborationUpgradeTargetCreateReceipt, s as CollaborationUpgradeTargetReadback, t as CollaborationUpgradeValidation, F as FrozenV1SnapshotReader, u as UpgradeCollaborationActivationInput } from './types-Cq_iw5JD.js';

type CollaborationUpgradeErrorCode = 'UPGRADE_INPUT_INVALID' | 'UPGRADE_ENGINE_UNAVAILABLE' | 'UPGRADE_ENGINE_INCOMPATIBLE' | 'UPGRADE_READER_UNAVAILABLE' | 'UPGRADE_PROVIDER_CONTRACT_INVALID' | 'UPGRADE_PROVIDER_READ_FAILED' | 'UPGRADE_CHECKPOINT_FAILED' | 'UPGRADE_CHECKPOINT_CONFLICT' | 'UPGRADE_ROUTING_READ_FAILED' | 'UPGRADE_SOURCE_CHANGED' | 'UPGRADE_SOURCE_CONVERSION_FAILED' | 'UPGRADE_TARGET_BUILD_FAILED' | 'UPGRADE_TARGET_CONFLICT' | 'UPGRADE_TARGET_CREATE_FAILED' | 'UPGRADE_TARGET_READBACK_FAILED' | 'UPGRADE_TARGET_VALIDATION_FAILED' | 'UPGRADE_ACTIVATION_RECEIPT_INVALID' | 'UPGRADE_ACTIVATION_FAILED';
declare class CollaborationUpgradeError extends Error {
    readonly code: CollaborationUpgradeErrorCode;
    readonly stage: string;
    readonly detail: Readonly<Record<string, unknown>>;
    readonly resume: CollaborationUpgradeResumeToken | null;
    constructor(code: CollaborationUpgradeErrorCode, message: string, options?: {
        readonly stage?: string;
        readonly detail?: Readonly<Record<string, unknown>>;
        readonly resume?: CollaborationUpgradeResumeToken | null;
        readonly cause?: unknown;
    });
}

declare function prepareCollaborationUpgrade(input: PrepareCollaborationUpgradeInput): Promise<PreparedCollaborationUpgrade>;
declare function upgradeCollaboration(input: UpgradeCollaborationInput): Promise<UpgradeCollaborationResult>;

export { CollaborationUpgradeError, type CollaborationUpgradeErrorCode, CollaborationUpgradeResumeToken, PrepareCollaborationUpgradeInput, PreparedCollaborationUpgrade, UpgradeCollaborationInput, UpgradeCollaborationResult, prepareCollaborationUpgrade, upgradeCollaboration };
