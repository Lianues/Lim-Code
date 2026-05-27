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
 */
const { spawnSync } = require('node:child_process');

const jestBin = require.resolve('jest/bin/jest');
const userArgs = process.argv.slice(2).filter(arg => arg !== '--');

const result = spawnSync(
  process.execPath,
  [jestBin, '--config', 'jest.backend.config.js', ...userArgs],
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
