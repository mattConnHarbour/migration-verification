import { U as UpgradeYjsConnection } from './provider-utils-BWIvEuBM.cjs';
import { b as CollaborationUpgradeProviderAdapter } from './types-Cq_iw5JD.cjs';
import 'yjs';

interface YWebsocketUpgradeAdapterOptions {
    /** Normal y-websocket server base URL; the provider appends the room name. */
    readonly url: string;
    readonly params?: Record<string, string>;
    readonly WebSocketPolyfill?: unknown;
    readonly connectTimeoutMs?: number;
    readonly writePropagationMs?: number;
    /** Dependency-injection seam for tests and custom y-websocket clients. */
    readonly connect?: (roomId: string) => Promise<UpgradeYjsConnection>;
}
declare function createYWebsocketUpgradeAdapter(options: YWebsocketUpgradeAdapterOptions): CollaborationUpgradeProviderAdapter;

export { type YWebsocketUpgradeAdapterOptions, createYWebsocketUpgradeAdapter };
