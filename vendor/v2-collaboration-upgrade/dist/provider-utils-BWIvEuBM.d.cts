import { Doc } from 'yjs';

interface UpgradeYjsConnection {
    readonly doc: Doc;
    destroy(): void | Promise<void>;
}

export type { UpgradeYjsConnection as U };
