import { C as CollaborationUpgradeTargetCreateReceipt, a as CollaborationUpgradeSourceRole, b as CollaborationUpgradeProviderAdapter } from './types-Cq_iw5JD.js';

type BinaryStoreRoomRead = Uint8Array | {
    readonly update: Uint8Array;
    readonly stateVector?: Uint8Array | null;
    readonly storageVersion?: string;
    readonly capturedAt?: string;
    readonly sourceSchemaVersion?: string | null;
    readonly providerEvidence?: string;
};
type BinaryStoreCreateResult = CollaborationUpgradeTargetCreateReceipt['disposition'] | {
    readonly disposition: CollaborationUpgradeTargetCreateReceipt['disposition'];
    readonly storageVersion?: string;
    readonly durabilityEvidence?: string;
};
interface BinaryStoreUpgradeAdapterOptions {
    readonly providerId?: string;
    readonly read: (roomId: string, context: {
        readonly fresh: boolean;
        readonly role: CollaborationUpgradeSourceRole | 'target';
    }) => Promise<BinaryStoreRoomRead | ArrayBuffer | null>;
    /** Atomically create when absent. It must not overwrite an existing room. */
    readonly create: (roomId: string, update: Uint8Array, context: {
        readonly migrationId: string;
        readonly updateSha256: string;
    }) => Promise<BinaryStoreCreateResult>;
}
declare function createBinaryStoreUpgradeAdapter(options: BinaryStoreUpgradeAdapterOptions): CollaborationUpgradeProviderAdapter;

export { type BinaryStoreCreateResult, type BinaryStoreRoomRead, type BinaryStoreUpgradeAdapterOptions, createBinaryStoreUpgradeAdapter };
