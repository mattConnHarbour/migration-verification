import { U as UpgradeYjsConnection } from './provider-utils-BWIvEuBM.js';
import { b as CollaborationUpgradeProviderAdapter } from './types-Cq_iw5JD.js';
import 'yjs';

interface HocuspocusUpgradeAdapterOptions {
    readonly url: string;
    readonly token?: string | (() => string | Promise<string>);
    readonly parameters?: Record<string, string>;
    readonly connectTimeoutMs?: number;
    readonly writePropagationMs?: number;
    /** Dependency-injection seam for tests and custom Hocuspocus clients. */
    readonly connect?: (roomId: string) => Promise<UpgradeYjsConnection>;
}
declare function createHocuspocusUpgradeAdapter(options: HocuspocusUpgradeAdapterOptions): CollaborationUpgradeProviderAdapter;

export { type HocuspocusUpgradeAdapterOptions, createHocuspocusUpgradeAdapter };
