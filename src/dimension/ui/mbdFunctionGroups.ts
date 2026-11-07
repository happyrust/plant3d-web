/**
 * #103 M1-3：面板按 PML FUNCTION 类别（记录的 `mbdFunction`）给 MBD 记录成组，组头上可整组临时
 * 显隐。显隐复用外部记录逐条的临时隐藏（`ExternalDimensionRegistry` 的同一套 hiddenIds，ADR 0028：
 * 只在当前视口会话里隐藏，来源不变），所以整组隐藏后单条仍能各自「临时显示」。没有类别的记录交回
 * 面板原有的分组（按直段 / 按类别两分），列表一行不变；管道包的记录一律如此——图元带了 function，
 * 适配层也不给管道记录写类别（ADR 0071）。
 */
import { externalDimensionCategory } from '../adapters/normalizeExternalDimensions';

import { isExternalDimensionRecord } from './dimensionBoundActions';

import type { ExternalDimensionRecord } from '../adapters/normalizeExternalDimensions';
import type { UserDimensionRecord } from '../domain/types';

type DimensionListItem = UserDimensionRecord | ExternalDimensionRecord;

/** 一个类别组：类别文本 + 组内记录（尺寸在前、标注在后，ADR 0041 两分；同类内保持来源顺序）。 */
export type MbdFunctionGroup = Readonly<{
  mbdFunction: string;
  records: readonly ExternalDimensionRecord[];
}>;

export type MbdFunctionGrouping = Readonly<{
  /** 类别组，按类别在来源里首次出现的顺序排。 */
  groups: readonly MbdFunctionGroup[];
  /** 其余记录（非 MBD，或 MBD 但没声明类别），保持输入顺序，交给面板原有的分组。 */
  rest: readonly ExternalDimensionRecord[];
}>;

/** 记录的类别：只认 MBD 记录上的 `mbdFunction`，其它来源一律没有。 */
export function mbdFunctionOf(record: ExternalDimensionRecord): string | undefined {
  return record.source === 'mbd' ? record.mbdFunction : undefined;
}

/**
 * 把声明了类别的 MBD 记录按类别拆出来。类别跨 BRAN 合组（多 BRAN 同屏时同一类别只有一组），与
 * 「只看一类信息」的显隐口径一致；没有类别的记录原样留在 `rest`。
 */
export function groupMbdRecordsByFunction(
  records: readonly ExternalDimensionRecord[],
): MbdFunctionGrouping {
  const buckets = new Map<string, ExternalDimensionRecord[]>();
  const rest: ExternalDimensionRecord[] = [];
  for (const record of records) {
    const mbdFunction = mbdFunctionOf(record);
    if (mbdFunction === undefined) {
      rest.push(record);
      continue;
    }
    const bucket = buckets.get(mbdFunction);
    if (bucket) bucket.push(record);
    else buckets.set(mbdFunction, [record]);
  }
  return {
    groups: [...buckets].map(([mbdFunction, members]) => ({
      mbdFunction,
      records: [
        ...members.filter(record => externalDimensionCategory(record) === 'dimension'),
        ...members.filter(record => externalDimensionCategory(record) === 'annotation'),
      ],
    })),
    rest,
  };
}

/** 一组记录的临时显隐状态：全部可见 / 全部临时隐藏 / 部分临时隐藏。 */
export type GroupVisibility = 'visible' | 'hidden' | 'mixed';

export function groupVisibility(
  records: readonly ExternalDimensionRecord[],
  hiddenIds: ReadonlySet<string>,
): GroupVisibility {
  const hidden = records.filter(record => hiddenIds.has(record.id)).length;
  if (hidden === 0) return 'visible';
  return hidden === records.length ? 'hidden' : 'mixed';
}

/** 外部记录临时隐藏的写入口，即 `ExternalDimensionRegistry.setHiddenMany`。 */
export type ExternalHidingPort = Readonly<{
  setHiddenMany(dimensionIds: readonly string[], hidden: boolean): void;
}>;

/**
 * 整组切换：全部临时隐藏的组整组显示；全部可见或部分隐藏的组整组隐藏（部分隐藏先补齐，和组头按钮
 * 「临时隐藏本组」的字面一致）。一次写完，注册表只发布一次快照。
 */
export function toggleGroupHidden(
  port: ExternalHidingPort,
  records: readonly ExternalDimensionRecord[],
  hiddenIds: ReadonlySet<string>,
): void {
  if (records.length === 0) return;
  port.setHiddenMany(
    records.map(record => record.id),
    groupVisibility(records, hiddenIds) !== 'hidden',
  );
}

/** 列表里的一组是不是 MBD 类别组：组内每条都是声明了类别的 MBD 记录才是，返回这些记录。 */
export function mbdFunctionGroupRecords(
  items: readonly DimensionListItem[],
): readonly ExternalDimensionRecord[] | null {
  if (items.length === 0) return null;
  const records: ExternalDimensionRecord[] = [];
  for (const item of items) {
    if (!isExternalDimensionRecord(item) || mbdFunctionOf(item) === undefined) return null;
    records.push(item);
  }
  return records;
}

/**
 * `DimensionSemanticList` 组头整组显隐的两个回调（`groupVisibility` / `onToggleGroupVisibility`）：
 * 只有 MBD 类别组出按钮，其余组返回 null。隐藏集合与写入口都在调用时现取——面板传进来的是它的
 * shallowRef 与当前尺寸系统的注册表，列表渲染时读到的隐藏集合随注册表快照响应式更新。
 */
export function mbdFunctionGroupVisibility(
  hiddenIds: () => readonly string[],
  port: () => ExternalHidingPort | null | undefined,
): Readonly<{
  visibility: (items: readonly DimensionListItem[]) => GroupVisibility | null;
  toggle: (items: readonly DimensionListItem[]) => void;
}> {
  return {
    visibility: (items) => {
      const records = mbdFunctionGroupRecords(items);
      return records ? groupVisibility(records, new Set(hiddenIds())) : null;
    },
    toggle: (items) => {
      const records = mbdFunctionGroupRecords(items);
      const target = port();
      if (records && target) toggleGroupHidden(target, records, new Set(hiddenIds()));
    },
  };
}
