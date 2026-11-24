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

/**
 * 九种标注类型各自对应的求解器产出类别期望集（镜像 `vendor/plant-mbd` 各模块的 `PRODUCED_KINDS`）。
 * `Record` 钉住契约的封闭词表，新增标注类型时必须同步补齐。
 */
export const EXPECTED_KINDS_BY_ANNOTATION_TYPE: Readonly<
  Record<MbdV2AnnotationType, readonly MbdPrimitiveKind[]>
> = {
  em4_pipe: PIPE_EXPECTED_KINDS,
  em9_pipe: PIPE_EXPECTED_KINDS,
  em4_supp: [
    'linear_dim',
    'label',
    'leader_line',
    'aid_text',
    'aid_line',
    'aid_circle',
    'angle_dim',
  ],
  em9_pipe_supp: ['linear_dim', 'label', 'leader_line'],
  em9_inst_supp: ['linear_dim', 'label', 'leader_line', 'aid_text'],
  civil: [
    'linear_dim',
    'label',
    'leader_line',
    'aid_line',
    'aid_text',
    'aid_arc',
    'aid_circle',
  ],
  arch: ['linear_dim', 'label', 'leader_line', 'aid_text', 'aid_circle'],
  em4_equi: ['linear_dim', 'angle_dim', 'label', 'leader_line', 'aid_line', 'aid_text'],
  em9_equi: ['linear_dim', 'angle_dim', 'label', 'leader_line', 'aid_line', 'aid_text'],
};

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
 * 一个包应有的产出类别，`null` = 未知类型不判「标注不完整」：
 * - 缺省（老后端只出管道包）→ {@link PIPE_EXPECTED_KINDS}；
 * - 九种已知标注类型 → {@link EXPECTED_KINDS_BY_ANNOTATION_TYPE}；
 * - 词表外取值 → `null`。
 */
export function expectedKindsFor(
  annotationType: string | null | undefined,
): readonly MbdPrimitiveKind[] | null {
  if (annotationType === null || annotationType === undefined) return PIPE_EXPECTED_KINDS;
  return isMbdAnnotationType(annotationType) ? EXPECTED_KINDS_BY_ANNOTATION_TYPE[annotationType] : null;
}
