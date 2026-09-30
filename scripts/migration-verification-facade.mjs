import { runMigrationVerification } from "./run-migration-verification.mjs";

export class MigrationVerificationFacade {
  async run(argv) {
    return await runMigrationVerification(argv);
  }
}
