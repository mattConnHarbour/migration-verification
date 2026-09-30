import { b as CollaborationUpgradeProviderAdapter } from './types-Cq_iw5JD.js';

interface LiveblocksUpgradeClient {
    createRoom(roomId: string, options: Record<string, unknown>): Promise<unknown>;
    getRoom(roomId: string): Promise<{
        readonly metadata?: Record<string, unknown>;
    }>;
    sendYjsBinaryUpdate(roomId: string, update: Uint8Array): Promise<unknown>;
    getYjsDocumentAsBinaryUpdate(roomId: string): Promise<Uint8Array | ArrayBuffer>;
}
interface LiveblocksUpgradeAdapterOptions {
    /** Server-side `Liveblocks` client from `@liveblocks/node`. */
    readonly client: LiveblocksUpgradeClient;
    /** Additional options for the staged private target room. */
    readonly privateRoomOptions?: Readonly<Record<string, unknown>>;
}
declare function createLiveblocksUpgradeAdapter(options: LiveblocksUpgradeAdapterOptions): CollaborationUpgradeProviderAdapter;

export { type LiveblocksUpgradeAdapterOptions, type LiveblocksUpgradeClient, createLiveblocksUpgradeAdapter };
