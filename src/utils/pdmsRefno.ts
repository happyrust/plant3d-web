/**
 * PDMS/E3D refno 字符串工具
 *
 * 内部统一用 "dbnum_ref" 形式（下划线），和 API/URL encoding 友好；
 * 对齐 E3D 控制台输出时需要展示为 "dbnum/ref"（斜杠）。
 */

/**
 * 将内部 refno（下划线分隔）转换为 E3D 控制台显示形式（斜杠分隔）。
 *
 * 示例：
 *   formatPdmsRef('24381_145019') === '24381/145019'
 *   formatPdmsRef('24381/145019') === '24381/145019'
 */
export function formatPdmsRef(refno: string | null | undefined): string {
  if (!refno) return '';
  return String(refno).replace(/_/g, '/');
}
