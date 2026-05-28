#!/usr/bin/env node
/**
 * Validate LimCode release metadata consistency.
 *
 * 修改原因：版本号曾散落在运行时代码、设置页文案、package 与 lockfile 中，人工 grep 容易漏也容易误判第三方依赖版本。
 * 修改方式：以根 package.json 为唯一版本源，校验 root/frontend package 与 lockfile、CHANGELOG 顶部条目，并扫描运行时源码是否重新硬编码当前版本。
 * 修改目的：让 release 前检查自动阻止版本元数据回退，同时不要求 README 或 CHANGELOG 内容自动生成。
 */

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const errors = [];

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(rootDir, relativePath), 'utf8'));
}

function assertEqual(label, actual, expected) {
  if (actual !== expected) {
    errors.push(`${label}: expected ${expected}, got ${actual}`);
  }
}

function walk(dir, predicate, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
      walk(fullPath, predicate, out);
      continue;
    }
    if (predicate(fullPath)) out.push(fullPath);
  }
  return out;
}

const rootPackage = readJson('package.json');
const version = rootPackage.version;
if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
  errors.push(`package.json version is not a valid semver-like value: ${version}`);
}

const rootLock = readJson('package-lock.json');
assertEqual('package-lock.json version', rootLock.version, version);
assertEqual('package-lock.json packages[""].version', rootLock.packages?.['']?.version, version);

const frontendPackage = readJson('frontend/package.json');
assertEqual('frontend/package.json version', frontendPackage.version, version);

const frontendLock = readJson('frontend/package-lock.json');
assertEqual('frontend/package-lock.json version', frontendLock.version, version);
assertEqual('frontend/package-lock.json packages[""].version', frontendLock.packages?.['']?.version, version);

const changelog = fs.readFileSync(path.join(rootDir, 'CHANGELOG.md'), 'utf8');
if (!new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\] - \\d{4}-\\d{2}-\\d{2}`, 'm').test(changelog)) {
  errors.push(`CHANGELOG.md is missing a top-level entry for ${version}`);
}

const runtimeFiles = [
  ...walk(path.join(rootDir, 'backend'), file => /\.(ts|tsx)$/.test(file)),
  ...walk(path.join(rootDir, 'frontend', 'src'), file => /\.(ts|tsx|vue)$/.test(file)),
  ...walk(path.join(rootDir, 'webview'), file => /\.(ts|tsx)$/.test(file))
];

const allowedRuntimeVersionFiles = new Set();
for (const file of runtimeFiles) {
  const text = fs.readFileSync(file, 'utf8');
  if (text.includes(version) && !allowedRuntimeVersionFiles.has(file)) {
    errors.push(`Runtime source hardcodes current release version ${version}: ${path.relative(rootDir, file)}`);
  }
}

if (errors.length > 0) {
  console.error('Release metadata check failed:');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(`Release metadata check passed for ${version}.`);
