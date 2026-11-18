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
 * 带几何的成员的包围盒：认得出参考号的按参考号（`byRefno`），认不出的（没起名的隐式直管段之类）列在 `anonymous`，
 * 带着它的上级路径，调用方按上级归组。同一个参考号出现两次就抛错，不悄悄覆盖。
 *
 * @param {object[]} members `loadRvmSnapshot().members` 或 `membersUnder()` 的结果
 */
export function truthBoxes(members) {
  const byRefno = {};
  const anonymous = [];
  for (const member of members) {
    if (!member.box) continue;
    if (!member.refno) {
      anonymous.push({ path: member.path, parentPath: member.parentPath, name: member.name, noun: member.noun, box: member.box });
    } else if (byRefno[member.refno]) {
      throw new Error(`RVM 快照里 ${member.refno} 出现了两次（${member.path}）`);
    } else {
      byRefno[member.refno] = member.box;
    }
  }
  return { byRefno, anonymous };
}
