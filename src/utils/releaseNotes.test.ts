import { describe, expect, it } from 'vitest';

import { findReleaseNotesByVersion, parseReleaseNotes } from './releaseNotes';

const SAMPLE_CHANGELOG = `# Changelog

## [Unreleased]

### Added

- 新增顶栏帮助入口

### Fixed

- 修复关于弹窗重复刷新

## [0.1.0]

### Added

- 首次发布

### Changed

- 调整默认菜单布局
`;

describe('releaseNotes', () => {
  it('应按版本与分组解析 changelog', () => {
    const versions = parseReleaseNotes(SAMPLE_CHANGELOG);

    expect(versions).toHaveLength(2);
    expect(versions[0]).toMatchObject({
      version: 'Unreleased',
      sections: [
        { title: 'Added', items: ['新增顶栏帮助入口'] },
        { title: 'Fixed', items: ['修复关于弹窗重复刷新'] },
      ],
    });
    expect(versions[1]).toMatchObject({
      version: '0.1.0',
      sections: [
        { title: 'Added', items: ['首次发布'] },
        { title: 'Changed', items: ['调整默认菜单布局'] },
      ],
    });
  });

  it('应支持按当前版本匹配更新说明', () => {
    const versions = parseReleaseNotes(SAMPLE_CHANGELOG);

    expect(findReleaseNotesByVersion(versions, '0.1.0')?.version).toBe('0.1.0');
    expect(findReleaseNotesByVersion(versions, ' v0.1.0 ')?.version).toBe('0.1.0');
    expect(findReleaseNotesByVersion(versions, '0.2.0')).toBeNull();
  });
});
