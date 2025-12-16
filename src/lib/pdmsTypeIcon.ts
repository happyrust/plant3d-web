/**
 * PDMS 类型图标映射工具
 * 使用 Vite 的 import.meta.glob 构建可用图标集合，避免 404
 */

// 使用 eager 模式预加载所有图标 URL
const iconModules = import.meta.glob<string>(
  '@/assets/pdms-icons/16x16/*.png',
  { eager: true, query: '?url', import: 'default' }
);

// 构建 typeName -> URL 映射
const iconMap = new Map<string, string>();

for (const [path, url] of Object.entries(iconModules)) {
  // path 格式: /src/assets/pdms-icons/16x16/PIPE.png
  const match = path.match(/\/([^/]+)\.png$/);
  if (match && match[1]) {
    const typeName = match[1].toUpperCase();
    iconMap.set(typeName, url);
  }
}

// 别名映射（处理特殊情况）
const ALIASES: Record<string, string> = {
  WORL: 'WORD',
  WORLD: 'WORD',
};

/**
 * 获取指定类型的图标 URL
 * @param typeName PDMS 类型名（如 PIPE、SITE、ZONE）
 * @returns 图标 URL，若不存在则返回 undefined
 */
export function getPdmsTypeIconUrl(typeName: string | undefined | null): string | undefined {
  if (!typeName) return undefined;
  
  const upper = typeName.toUpperCase();
  
  // 先尝试直接匹配
  if (iconMap.has(upper)) {
    return iconMap.get(upper);
  }
  
  // 尝试别名
  const alias = ALIASES[upper];
  if (alias && iconMap.has(alias)) {
    return iconMap.get(alias);
  }
  
  return undefined;
}

/**
 * 检查指定类型是否有图标
 */
export function hasPdmsTypeIcon(typeName: string | undefined | null): boolean {
  return getPdmsTypeIconUrl(typeName) !== undefined;
}

/**
 * 获取所有可用的图标类型列表（用于调试）
 */
export function getAvailableIconTypes(): string[] {
  return Array.from(iconMap.keys()).sort();
}
