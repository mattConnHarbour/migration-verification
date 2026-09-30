#!/usr/bin/env node

import { MigrationVerificationFacade } from "./migration-verification-facade.mjs";

const facade = new MigrationVerificationFacade();

facade.run(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
