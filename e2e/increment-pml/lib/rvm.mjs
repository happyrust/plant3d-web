/**
 * 读套件入口产出的 RVM 快照（`*.snapshot.json`）：E3D 只读导出的 RVM 解析成的成员表，每个带几何的成员有一个世界包围盒（mm）。
 * W4 拿它当真值。这里只管读和挑；怎么分组（逐件比，还是件数加合起来的包围盒）写在用例表里，不在这里猜。
 *
 * 成员的上下级按 `path` 算（`/AMS/SITE/ZONE/...`）：快照里的 `stable_id` 是 64 位整数，JSON 读进来会丢精度，不拿它认人。
 */
import fs from 'node:fs';

import { refnoKey } from './judge.mjs';

function validBox(value) {
  if (!Array.isArray(value) || value.length !== 6) return null;
  if (!value.every((item) => typeof item === 'number' && Number.isFinite(item))) return null;
  return value[0] <= value[3] && value[1] <= value[4] && value[2] <= value[5] ? value : null;
}

function parentPath(memberPath) {
  const cut = memberPath.lastIndexOf('/');
  return cut > 0 ? memberPath.slice(0, cut) : null;
}

/**
 * @param {string} file 快照文件
 * @returns {{ file: string, meta: object, members: object[], invalidBoxes: string[] }}
 */
export function loadRvmSnapshot(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!raw || !Array.isArray(raw.members)) throw new Error(`${file} 不是 RVM 快照（没有 members）`);
  const invalidBoxes = [];
  const members = raw.members.map((member, index) => {
    const box = validBox(member.aabb_world_mm);
    if (member.aabb_world_mm !== null && member.aabb_world_mm !== undefined && !box) invalidBoxes.push(member.path ?? `#${index}`);
    return {
      index,
      path: member.path ?? '',
      parentPath: parentPath(member.path ?? ''),
      name: member.name ?? '',
      noun: member.noun ?? null,
      refno: member.resolved !== false && member.refno ? refnoKey(member.refno) : null,
      // 快照上的逐件键。有参考号时是 `24384/22404`；隐式管段是 `tube:<属主>#<FTUBE n>`；属主也没有参考号时是 `path:<路径>#<序号>`。
      // `tube:` / `path:` 带冒号，这里原样留下，不过 `refnoKey`。旧快照没有这一格时是 null，后面的分拣和以前一样。
      compareKey: typeof member.compare_key === 'string' && member.compare_key.trim() ? member.compare_key.trim() : null,
      identitySource: member.identity_source ?? null,
      ownerDesc: member.owner_desc ?? null,
      ordinal: member.ordinal ?? null,
      geometries: (member.geometries ?? []).length,
      box,
    };
  });
  return { file, meta: raw.meta ?? {}, members, invalidBoxes };
}

/** 某个成员（按参考号或名字找）和它下面的全部成员；找不到回空表 */
export function membersUnder(snapshot, refnoOrName) {
  const wanted = String(refnoOrName);
  const key = /^=?\d+[/_]\d+$/.test(wanted) ? refnoKey(wanted) : null;
  const top = snapshot.members.find((member) => (key ? member.refno === key : member.name === wanted));
  if (!top) return [];
  return snapshot.members.filter((member) => member.path === top.path || member.path.startsWith(`${top.path}/`));
}

/**
 * 带几何的成员的包围盒。有参考号的照旧用 `refnoKey(refno)` 作键。没有参考号、但快照写了非空 `compare_key` 的
 * （隐式管段 `tube:<属主>#<FTUBE n>`，或 `path:<路径>#<序号>`）直接用这把键，不过 `refnoKey`，也不再丢进 `anonymous`。
 * 两样都没有的才进 `anonymous`（旧快照没有 `compare_key` 时就是这条路）。同一个键出现两次就抛错，不悄悄覆盖。
 *
 * @param {object[]} members `loadRvmSnapshot().members` 或 `membersUnder()` 的结果
 */
export function truthBoxes(members) {
  const byRefno = {};
  const anonymous = [];
  for (const member of members) {
    if (!member.box) continue;
    const compareKey = typeof member.compareKey === 'string' && member.compareKey.trim() ? member.compareKey.trim() : null;
    const key = member.refno || compareKey;
    if (!key) {
      anonymous.push({
        path: member.path,
        parentPath: member.parentPath,
        name: member.name,
        noun: member.noun,
        box: member.box,
        compareKey: null,
      });
    } else if (byRefno[key]) {
      throw new Error(`RVM 快照里 ${key} 出现了两次（${member.path}）`);
    } else {
      byRefno[key] = member.box;
    }
  }
  return { byRefno, anonymous };
}
