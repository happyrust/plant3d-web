/**
 * 合成一个「像 E3D 场景」的小装置区（单位 mm，Z 向上）：楼板、钢架、管线+弯头+法兰+阀门、卧式容器、泵、一间半透明的房间。
 * 只为看渲染效果，几何全部用 three 基本体。
 */

import {
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  Object3D,
  SphereGeometry,
  TorusGeometry
} from 'three';

import { SglLookMaterial, translucencyToAlpha } from '../sglLookMaterial';

/** 近似 PDMS 颜色表里的几个常用名（RGB 取 X11 同名色） */
export const DEMO_PDMS_COLOURS = Object.freeze({
  Grey: 0x808080,
  Lightgrey: 0xd3d3d3,
  Darkgrey: 0x505050,
  Orange: 0xffa500,
  Salmon: 0xfa8072,
  Tomato: 0xff6347,
  Cyan: 0x00ffff,
  Aquamarine: 0x7fffd4,
  Turquoise: 0x40e0d0,
  Magenta: 0xff00ff,
  Yellow: 0xffff00,
  Green: 0x00ff00,
  Steelblue: 0x4682b4,
  Peachpuff: 0xffdab9,
  Brown: 0xa52a2a,
  White: 0xffffff,
} as const);

export type DemoPdmsColourName = keyof typeof DEMO_PDMS_COLOURS;

export interface DemoPlant {
  root: Group;
  /** 按颜色名共享的材质，方便统一改光照参数 */
  materials: SglLookMaterial[];
  /** 半透明房间的材质（单独调半透明） */
  roomMaterial: SglLookMaterial;
  /** 分组：steel / piping / equipment / room（切策略用） */
  groups: Record<'steel' | 'piping' | 'equipment' | 'room' | 'floor', Group>;
}

const HALF_PI = Math.PI / 2;

export function buildDemoPlant(): DemoPlant {
  const root = new Group();
  root.name = 'E3D look demo plant';
  const materials: SglLookMaterial[] = [];
  const materialByColour = new Map<number, SglLookMaterial>();

  const mat = (colour: number): SglLookMaterial => {
    let m = materialByColour.get(colour);
    if (!m) {
      m = new SglLookMaterial({ color: colour });
      m.name = `SglLook#${colour.toString(16).padStart(6, '0')}`;
      materialByColour.set(colour, m);
      materials.push(m);
    }
    return m;
  };

  const groups = {
    floor: new Group(),
    steel: new Group(),
    piping: new Group(),
    equipment: new Group(),
    room: new Group(),
  };
  groups.floor.name = 'floor';
  groups.steel.name = 'steel';
  groups.piping.name = 'piping';
  groups.equipment.name = 'equipment';
  groups.room.name = 'room';

  const add = (group: Group, geom: BufferGeometry, colour: number, x: number, y: number, z: number, rot?: [number, number, number]): Mesh => {
    const mesh = new Mesh(geom, mat(colour));
    mesh.position.set(x, y, z);
    if (rot) mesh.rotation.set(rot[0], rot[1], rot[2]);
    group.add(mesh);
    return mesh;
  };

  // —— 楼板 ——
  add(groups.floor, new BoxGeometry(22000, 15000, 300), DEMO_PDMS_COLOURS.Darkgrey, 0, 0, -150);

  // —— 钢架：两层，4 柱 + 纵横梁 ——
  const colGeom = new BoxGeometry(300, 300, 7000);
  const beamXGeom = new BoxGeometry(12000, 200, 400);
  const beamYGeom = new BoxGeometry(200, 8000, 400);
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      add(groups.steel, colGeom, DEMO_PDMS_COLOURS.Grey, sx * 6000, sy * 4000, 3500);
    }
  }
  for (const z of [3500, 6800]) {
    for (const sy of [-1, 1]) add(groups.steel, beamXGeom, DEMO_PDMS_COLOURS.Grey, 0, sy * 4000, z);
    for (const sx of [-1, 1]) add(groups.steel, beamYGeom, DEMO_PDMS_COLOURS.Grey, sx * 6000, 0, z);
  }
  // 栅格平台梁
  const gratingGeom = new BoxGeometry(12000, 8000, 60);
  add(groups.steel, gratingGeom, DEMO_PDMS_COLOURS.Lightgrey, 0, 0, 3730);

  // —— 管线：三根平行管沿 X，末端各自向下弯 ——
  const pipeSpecs: { r: number; y: number; z: number; colour: number }[] = [
    { r: 150, y: -2600, z: 5200, colour: DEMO_PDMS_COLOURS.Orange },
    { r: 200, y: -2000, z: 5200, colour: DEMO_PDMS_COLOURS.Salmon },
    { r: 100, y: -1500, z: 5200, colour: DEMO_PDMS_COLOURS.Tomato },
  ];
  for (const spec of pipeSpecs) {
    const len = 10000;
    const pipe = new CylinderGeometry(spec.r, spec.r, len, 32, 1, false);
    add(groups.piping, pipe, spec.colour, 0, spec.y, spec.z, [0, 0, HALF_PI]);
    // 弯头：环面 1/4 圈，弯曲半径 1.5D
    const bendR = spec.r * 3;
    const elbow = new TorusGeometry(bendR, spec.r, 24, 32, HALF_PI);
    // 放在 x = +len/2 处：绕 X 转 90° 后环面落在 XZ 平面，从 (len/2, z) 弯到 (len/2+bendR, z-bendR)
    add(groups.piping, elbow, spec.colour, len / 2, spec.y, spec.z - bendR, [HALF_PI, 0, 0]);
    // 下行段（沿 Z）
    const drop = 2400;
    add(groups.piping, new CylinderGeometry(spec.r, spec.r, drop, 32), spec.colour, len / 2 + bendR, spec.y, spec.z - bendR - drop / 2, [HALF_PI, 0, 0]);
    // 法兰对
    for (const fx of [-3200, -1200, 2600]) {
      const flange = new CylinderGeometry(spec.r * 1.9, spec.r * 1.9, 60, 32);
      add(groups.piping, flange, spec.colour, fx, spec.y, spec.z, [0, 0, HALF_PI]);
      add(groups.piping, flange, spec.colour, fx + 110, spec.y, spec.z, [0, 0, HALF_PI]);
    }
    // 阀门：阀体 + 阀杆 + 手轮（品红）
    const vx = -2200;
    add(groups.piping, new BoxGeometry(spec.r * 4, spec.r * 3.2, spec.r * 3.2), DEMO_PDMS_COLOURS.Magenta, vx, spec.y, spec.z);
    add(groups.piping, new CylinderGeometry(spec.r * 0.35, spec.r * 0.35, spec.r * 4, 16), DEMO_PDMS_COLOURS.Magenta, vx, spec.y, spec.z + spec.r * 3.2, [HALF_PI, 0, 0]);
    add(groups.piping, new TorusGeometry(spec.r * 1.6, spec.r * 0.18, 12, 32), DEMO_PDMS_COLOURS.Magenta, vx, spec.y, spec.z + spec.r * 5.2);
    // 管托
    for (const sx of [-4200, 0, 4200]) {
      add(groups.steel, new BoxGeometry(200, 200, spec.z - spec.r - 3760), DEMO_PDMS_COLOURS.Grey, sx, spec.y, (spec.z - spec.r + 3760) / 2);
    }
  }

  // —— 卧式容器：筒体 + 两个半球封头 + 两个鞍座 + 接管 ——
  const vesselR = 1200;
  const vesselL = 5000;
  const vy = -6300;
  const vz = 1900;
  add(groups.equipment, new CylinderGeometry(vesselR, vesselR, vesselL, 48), DEMO_PDMS_COLOURS.Turquoise, 0, vy, vz, [0, 0, HALF_PI]);
  for (const sx of [-1, 1]) {
    add(groups.equipment, new SphereGeometry(vesselR, 48, 32, 0, Math.PI * 2, 0, HALF_PI), DEMO_PDMS_COLOURS.Turquoise, sx * vesselL / 2, vy, vz, [0, 0, sx > 0 ? -HALF_PI : HALF_PI]);
    add(groups.equipment, new BoxGeometry(600, 2600, vz - vesselR * 0.6), DEMO_PDMS_COLOURS.Grey, sx * 1600, vy, (vz - vesselR * 0.6) / 2);
  }
  for (const nx of [-1500, 0, 1500]) {
    add(groups.equipment, new CylinderGeometry(180, 180, 900, 24), DEMO_PDMS_COLOURS.Turquoise, nx, vy, vz + vesselR + 300, [HALF_PI, 0, 0]);
    add(groups.equipment, new CylinderGeometry(330, 330, 60, 24), DEMO_PDMS_COLOURS.Turquoise, nx, vy, vz + vesselR + 760, [HALF_PI, 0, 0]);
  }

  // —— 泵：底座 + 泵体 + 电机 ——
  const px = -8000;
  const py = -5500;
  add(groups.equipment, new BoxGeometry(2600, 1200, 300), DEMO_PDMS_COLOURS.Grey, px, py, 150);
  add(groups.equipment, new CylinderGeometry(500, 500, 800, 32), DEMO_PDMS_COLOURS.Aquamarine, px - 800, py, 900, [0, 0, HALF_PI]);
  add(groups.equipment, new CylinderGeometry(380, 380, 1300, 32), DEMO_PDMS_COLOURS.Steelblue, px + 500, py, 900, [0, 0, HALF_PI]);
  add(groups.equipment, new CylinderGeometry(180, 180, 1600, 24), DEMO_PDMS_COLOURS.Aquamarine, px - 800, py, 1700 + 300, [HALF_PI, 0, 0]);

  // —— 半透明房间（测半透明 + 半透明边线） ——
  const roomMaterial = new SglLookMaterial({ color: DEMO_PDMS_COLOURS.Peachpuff, opacity: translucencyToAlpha(60) });
  roomMaterial.name = 'SglLook#room';
  const room = new Mesh(new BoxGeometry(4000, 3200, 3000), roomMaterial);
  room.position.set(7500, 3000, 1500);
  groups.room.add(room);

  for (const g of Object.values(groups) as Object3D[]) root.add(g);
  return { root, materials, roomMaterial, groups };
}

export function colourName(value: number): string {
  for (const [name, v] of Object.entries(DEMO_PDMS_COLOURS)) if (v === value) return name;
  return `#${new Color(value).getHexString()}`;
}
