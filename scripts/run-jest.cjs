#!/usr/bin/env node

/**
 * Run the backend Jest suite with a stable argument boundary.
 *
 * Why this wrapper exists:
 * - `pnpm test --runInBand` passes `--runInBand` as expected.
 * - `pnpm test -- --runInBand` can pass a literal `--` through to Jest.
 *   Jest treats the argument after that boundary as a test path pattern,
 *   so it looks for tests matching `--runInBand` and reports "No tests found".
 *
 * Strip bare `--` separators before invoking Jest so both command forms work.
 *
 * Why the VM modules flag is passed:
 * - Phase A validates `unified-llm-provider`, which is ESM-only, through a CommonJS-safe
 *   dynamic import boundary.
 * - Jest's VM runtime rejects native dynamic import without `--experimental-vm-modules`,
 *   even though the same code works in plain Node and VS Code Extension Host.
 *
 * How this is changed:
 * - Start Jest with the Node VM modules flag at the process boundary instead of special-casing
 *   the individual test or mocking the package.
 *
 * Purpose:
 * - Keep the smoke test honest: it exercises the real ESM package while the production adapter
 *   still exposes only LimCode-approved conversion APIs.
 */
const { spawnSync } = require('node:child_process');

const jestBin = require.resolve('jest/bin/jest');
const userArgs = process.argv.slice(2).filter(arg => arg !== '--');

const result = spawnSync(
  process.execPath,
  ['--experimental-vm-modules', jestBin, '--config', 'jest.backend.config.js', ...userArgs],
  {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit'
  }
);

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
