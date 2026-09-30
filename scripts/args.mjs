import path from "node:path";

export function parseArgs(argv, positionalCount, options = {}) {
  const positional = [];
  const flags = new Map();
  const booleanFlags = new Set(options.booleanFlags ?? []);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--") continue;
    if (!token.startsWith("--")) {
      positional.push(path.resolve(token));
      continue;
    }
    const name = token.slice(2);
    if (booleanFlags.has(name)) {
      flags.set(name, true);
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${token} requires a value`);
    flags.set(name, value);
    index += 1;
  }
  if (positional.length !== positionalCount) {
    throw new Error(`Expected ${positionalCount} positional path${positionalCount === 1 ? "" : "s"}.`);
  }
  return { positional, flags };
}

export function positiveInteger(value, name) {
  const result = Number.parseInt(value, 10);
  if (!Number.isInteger(result) || result <= 0) throw new Error(`${name} must be a positive integer`);
  return result;
}
