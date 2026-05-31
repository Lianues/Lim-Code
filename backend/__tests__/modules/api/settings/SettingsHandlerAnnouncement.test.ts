import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SettingsHandler } from '../../../../modules/api/settings/SettingsHandler';

const vscode = require('vscode') as {
  extensions?: {
    getExtension: jest.Mock;
  };
};

const VERSION_CORE = ['9', '9', '9'].join('.');
const NIGHTLY_VERSION = [VERSION_CORE, 'nightly'].join('-');
const PRE_VERSION = [VERSION_CORE, 'pre'].join('-');

function createHandler(): SettingsHandler {
  return new SettingsHandler({
    getProxySettings: () => undefined,
    getLastReadAnnouncementVersion: () => undefined,
    setLastReadAnnouncementVersion: jest.fn()
  } as any);
}

function withPackagedChangelog(content: string, fileName = 'CHANGELOG.md'): string {
  const extensionPath = fs.mkdtempSync(path.join(os.tmpdir(), 'limcode-changelog-'));
  fs.writeFileSync(path.join(extensionPath, fileName), content, 'utf8');
  vscode.extensions = {
    getExtension: jest.fn().mockReturnValue({
      extensionPath,
      packageJSON: {
        name: 'limcode',
        displayName: 'Lim Code',
        version: NIGHTLY_VERSION
      }
    })
  };
  return extensionPath;
}

describe('SettingsHandler announcement changelog', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    delete vscode.extensions;
  });

  it('reads changelog blocks for nightly prerelease versions', async () => {
    tempDirs.push(withPackagedChangelog(`# Change Log

## [${NIGHTLY_VERSION}] - 2026-06-01

### 修复
  - nightly changelog body

## [1.2.7] - 2026-05-30

### 修复
  - older changelog body
`));

    const changelog = await (createHandler() as any).getChangelogSinceVersion(undefined, NIGHTLY_VERSION);

    expect(changelog).toContain('nightly changelog body');
    expect(changelog).not.toContain('older changelog body');
  });

  it('keeps an exact current prerelease entry even when previous prerelease label has the same core version', async () => {
    tempDirs.push(withPackagedChangelog(`# Change Log

## [${NIGHTLY_VERSION}] - 2026-06-01

### 修复
  - current nightly body

## [${PRE_VERSION}] - 2026-05-31

### 修复
  - previous pre body
`));

    const changelog = await (createHandler() as any).getChangelogSinceVersion(PRE_VERSION, NIGHTLY_VERSION);

    expect(changelog).toContain('current nightly body');
    expect(changelog).not.toContain('previous pre body');
  });

  it('reads lowercase changelog filenames produced by VSIX packaging', async () => {
    tempDirs.push(withPackagedChangelog(`# Change Log

## [${NIGHTLY_VERSION}] - 2026-06-01

### 修复
  - lowercase packaged changelog body
`, 'changelog.md'));

    const changelog = await (createHandler() as any).getChangelogSinceVersion(undefined, NIGHTLY_VERSION);

    expect(changelog).toContain('lowercase packaged changelog body');
  });
});
