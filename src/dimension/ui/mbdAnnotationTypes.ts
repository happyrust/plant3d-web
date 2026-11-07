/**
 * #103 M7：尺寸面板按 MBD 标注类型（契约 `annotation_type`，ADR 0071）区别对待各包——诊断里标
 * 类型名，「标注不完整」横幅按类型挑期望的产出类别。
 */
import type { MbdPrimitiveKind, MbdV2AnnotationType } from '../adapters/mbdV2Contract';

/** 九种标注类型的中文名。`Record` 钉住契约的封闭词表，契约增删取值时这里会编译失败。 */
export const MBD_ANNOTATION_TYPE_LABELS: Readonly<Record<MbdV2AnnotationType, string>> = {
  em4_pipe: 'EM4 管道',
  em9_pipe: 'EM9 仪表管',
  em4_supp: 'EM4 支架',
  em9_inst_supp: 'EM9 仪表支架',
  em9_pipe_supp: 'EM9 仪表管支架',
  civil: '土建结构',
  arch: '建筑',
  em4_equi: 'EM4 设备',
  em9_equi: 'EM9 设备',
};

/**
 * 管道 MBD 应有的产出类别：求解器 `meta.coverage` 缺其中任何一种，面板就提示
 * 「本分支标注不完整」——未产出的类别不会产生 issue，光看诊断列表看不出缺了什么。
 * `aid_arc` / `aid_circle` / `aid_point` 不在里面：它们只属于支架 / 土建图，
 * 管道路径按设计不产出，列进来警示条会永远亮着。
 */
export const PIPE_EXPECTED_KINDS: readonly MbdPrimitiveKind[] = [
  'linear_dim',
  'angle_dim',
  'label',
  'leader_line',
  'aid_line',
  'aid_text',
  'weld_mark',
  'slope_mark',
];

const PIPE_ANNOTATION_TYPES: ReadonlySet<string> = new Set<MbdV2AnnotationType>(['em4_pipe', 'em9_pipe']);

function isMbdAnnotationType(value: string): value is MbdV2AnnotationType {
  return Object.prototype.hasOwnProperty.call(MBD_ANNOTATION_TYPE_LABELS, value);
}

/**
 * 标注类型的中文名。缺省 / `null`（老后端没声明）返回 `null`，面板就不标；词表外的值进不了
 * 契约（整包拒绝），万一出现原样返回，不吞掉线索。
 */
export function mbdAnnotationTypeLabel(annotationType: string | null | undefined): string | null {
  if (annotationType === null || annotationType === undefined) return null;
  return isMbdAnnotationType(annotationType) ? MBD_ANNOTATION_TYPE_LABELS[annotationType] : annotationType;
}

/**
 * 一个包应有的产出类别，`null` = 不判「标注不完整」：
 * - 两种管道与缺省（老后端只出管道包）→ {@link PIPE_EXPECTED_KINDS}；
 * - 其它类型 → `null`。它们的期望集随各自的求解器模块一起来；在那之前服务端回的是只有信封、
 *   带一条 `layout.not_implemented` issue 的包，诊断列表里已经看得见，再亮横幅只是重复。
 */
export function expectedKindsFor(
  annotationType: string | null | undefined,
): readonly MbdPrimitiveKind[] | null {
  if (annotationType === null || annotationType === undefined) return PIPE_EXPECTED_KINDS;
  return PIPE_ANNOTATION_TYPES.has(annotationType) ? PIPE_EXPECTED_KINDS : null;
}
