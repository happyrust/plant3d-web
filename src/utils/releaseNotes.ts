export type ReleaseNotesSection = {
  title: string;
  items: string[];
};

export type ReleaseNotesVersion = {
  version: string;
  sections: ReleaseNotesSection[];
};

const VERSION_HEADING_RE = /^##\s+\[(.+?)\](?:\s+-\s+.+)?$/gm;
const SECTION_HEADING_RE = /^###\s+(.+)$/gm;

function normalizeVersion(value: string): string {
  return value.trim().replace(/^v/i, '');
}

function stripInlineMarkdown(value: string): string {
  return value
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .trim();
}

function collectBulletItems(block: string): string[] {
  return block
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^-\s+/.test(line))
    .map((line) => stripInlineMarkdown(line.replace(/^-\s+/, '')))
    .filter(Boolean);
}

function parseSections(block: string): ReleaseNotesSection[] {
  const matches = Array.from(block.matchAll(SECTION_HEADING_RE));
  if (matches.length === 0) {
    const items = collectBulletItems(block);
    return items.length > 0 ? [{ title: 'Changed', items }] : [];
  }

  return matches
    .map((match, index) => {
      const start = (match.index ?? 0) + match[0].length;
      const end = matches[index + 1]?.index ?? block.length;
      const items = collectBulletItems(block.slice(start, end));
      return {
        title: stripInlineMarkdown(match[1] ?? ''),
        items,
      };
    })
    .filter((section) => section.title && section.items.length > 0);
}

export function parseReleaseNotes(changelog: string): ReleaseNotesVersion[] {
  const matches = Array.from(changelog.matchAll(VERSION_HEADING_RE));
  return matches
    .map((match, index) => {
      const start = (match.index ?? 0) + match[0].length;
      const end = matches[index + 1]?.index ?? changelog.length;
      return {
        version: stripInlineMarkdown(match[1] ?? ''),
        sections: parseSections(changelog.slice(start, end)),
      };
    })
    .filter((entry) => entry.version && entry.sections.length > 0);
}

export function findReleaseNotesByVersion(
  entries: ReleaseNotesVersion[],
  version: string,
): ReleaseNotesVersion | null {
  const normalizedTarget = normalizeVersion(version);
  return entries.find((entry) => normalizeVersion(entry.version) === normalizedTarget) ?? null;
}

export function getReleaseNotesSectionLabel(title: string): string {
  switch (title.toLowerCase()) {
    case 'added':
      return '新增';
    case 'changed':
      return '变更';
    case 'fixed':
      return '修复';
    case 'removed':
      return '移除';
    case 'deprecated':
      return '弃用';
    case 'security':
      return '安全';
    default:
      return title;
  }
}
