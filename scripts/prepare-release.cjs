#!/usr/bin/env node
/**
 * Prepare a LimCode release version without doing a git tag or publish.
 *
 * 修改原因：过去每次发布都手工同步 root/frontend package 与 lockfile，容易漏掉 package-lock 或前端包版本。
 * 修改方式：只调用 npm version --no-git-tag-version 更新 package.json/package-lock.json；不做全仓库字符串替换。
 * 修改目的：让版本 bump 由包管理器维护锁文件，避免误伤第三方依赖版本或运行时代码字符串。
 */

const { execFileSync } = require('child_process');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const nextVersion = process.argv[2];

if (!nextVersion || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(nextVersion)) {
  console.error('Usage: npm run release:prepare -- <semver>, for example: npm run release:prepare -- 1.2.5');
  process.exit(1);
}

function runNpmVersion(cwd) {
  // 修改原因：lockfile 的结构由 npm 维护，手写 JSON 替换容易遗漏 packages[""] 或误改依赖版本。
  // 修改方式：在指定目录执行 npm version，并关闭 git tag，让调用者决定何时提交和打包。
  // 修改目的：把 release prepare 限定为本地、可审查、可回滚的版本文件更新。
  execFileSync('npm', ['version', nextVersion, '--no-git-tag-version', '--allow-same-version'], {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });
}

runNpmVersion(rootDir);
runNpmVersion(path.join(rootDir, 'frontend'));

console.log(`Prepared LimCode release version ${nextVersion}.`);
console.log('Next: update CHANGELOG.md manually, then run npm run release:verify.');
