/**
 * E3D 渲染效果复刻原型的演示页入口（`/e3d-look-demo.html`，dev 下直接开）。
 * 右侧面板可切预设（出厂 E3D 3.1 / 本机真机）、HLR / AO / 背景渐变 / 抗锯齿 / legacy、环境立方体贴图，
 * 调 Ka Kd Ks Kr Kse 与 AO/HLR 参数，看合成结果或各中间图。
 */

import { Color, type CubeTexture, FloatType, Mesh, PerspectiveCamera, Scene, SphereGeometry, WebGLRenderer } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import { E3D_DEFAULT_ELEMENT_COLOUR, E3D_GRAPHICS_COLOUR_DEFAULTS, pdmsColourHex } from '../pdmsColourTable';
import { loadSgl31EnvCube } from '../sglEnvCube';
import { SGL_LIGHT_STRATEGIES, SglLookMaterial, translucencyToAlpha } from '../sglLookMaterial';
import { SglLookPipeline, type SglMsaaSamples } from '../sglLookPipeline';
import {
  DEFAULT_SGL_LOOK_PRESET,
  SGL_LOOK_PRESETS,
  applySglLookPresetToPipelineParams,
  parseSglLookPresetId,
  type SglLookPresetId
} from '../sglLookPresets';

import { buildDemoPlant, type DemoPlant } from './buildDemoPlant';

interface DemoHandle {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  pipeline: SglLookPipeline;
  plant: DemoPlant;
  renderOnce: () => void;
  setView: (name: 'iso' | 'front' | 'top') => void;
  /** 切预设（光照常量 + HLR/AO/渐变开关 + 背景色） */
  setPreset: (id: SglLookPresetId) => void;
  /** 环境立方体贴图（加载完才非空） */
  envCube: CubeTexture | null;
  /** 反射是否采立方体贴图（false = 解析天/地兜底） */
  setEnvCubeEnabled: (on: boolean) => void;
  /** 元素颜色：true = 出厂 E3D（全部 lightgrey #bdbdbd），false = 演示配色（PDMS 颜色表） */
  setFactoryColours: (on: boolean) => void;
  /** 演示用「辅助对象」（userData.sglHandle = true 的蓝球） */
  aid: Mesh;
  frames: number;
}

declare global {
  interface Window {
    __e3dLookDemo?: DemoHandle;
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function main(): void {
  const canvasHost = document.getElementById('viewport');
  const panel = document.getElementById('panel');
  if (!canvasHost || !panel) throw new Error('e3d-look-demo: 缺 #viewport / #panel');

  const params = new URLSearchParams(window.location.search);
  const renderer = new WebGLRenderer({ antialias: false, alpha: false, preserveDrawingBuffer: params.get('keep') === '1' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 1);
  canvasHost.appendChild(renderer.domElement);

  const scene = new Scene();
  const camera = new PerspectiveCamera(45, 1, 100, 200000);
  camera.up.set(0, 0, 1);

  const plant = buildDemoPlant();
  scene.add(plant.root);

  // 一个「辅助对象」（E3D aids，颜色 blue）：userData.sglHandle = true → 默认不参与边线（EnhancedEdgesHandles 关）
  // 也不参与伪阴影（PseudoShadowsHandles 关），仍写深度
  const aidMaterial = new SglLookMaterial({ color: pdmsColourHex(E3D_GRAPHICS_COLOUR_DEFAULTS.aids)! });
  const aid = new Mesh(new SphereGeometry(450, 32, 16), aidMaterial);
  aid.position.set(-7000, -6500, 450);
  aid.userData.sglHandle = true;
  aid.name = 'demo-aid';
  scene.add(aid);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 2600);
  controls.enableDamping = false;

  const setView = (name: 'iso' | 'front' | 'top'): void => {
    if (name === 'iso') camera.position.set(19000, -17000, 10000);
    else if (name === 'front') camera.position.set(0, -26000, 4000);
    else camera.position.set(0, -1, 32000);
    controls.target.set(0, 0, 2600);
    controls.update();
  };
  setView((params.get('view') as 'iso' | 'front' | 'top' | null) ?? 'iso');

  const pipeline = new SglLookPipeline(renderer);
  const allMaterials: SglLookMaterial[] = [...plant.materials, plant.roomMaterial, aidMaterial];

  // 预设：?preset=factory|machine（缺省出厂 E3D 3.1），再由 ?legacy/ao/hlr/gradient 单项覆盖
  let activePreset: SglLookPresetId = parseSglLookPresetId(params.get('preset')) ?? DEFAULT_SGL_LOOK_PRESET;
  const applyPreset = (id: SglLookPresetId): void => {
    activePreset = id;
    const preset = SGL_LOOK_PRESETS[id];
    applySglLookPresetToPipelineParams(pipeline.params, preset);
    for (const m of allMaterials) m.setLight(preset.light);
  };
  applyPreset(activePreset);
  if (params.get('legacy') === '1') pipeline.params.legacyMode = true;
  if (params.get('ao') === '0') pipeline.params.ao.enabled = false;
  if (params.get('hlr') === '0') pipeline.params.hlr.enabled = false;
  if (params.get('gradient') === '0') pipeline.params.background.gradient = false;
  // ?translucentEdges=0 半透明不画边（EnhancedEdgesTranslucent）；?handleEdges=1 辅助对象也画边（EnhancedEdgesHandles）；
  // ?handleShadows=1 辅助对象也受 / 投伪阴影（PseudoShadowsHandles）
  if (params.get('translucentEdges') === '0') pipeline.params.hlr.translucentEdges = false;
  if (params.get('handleEdges') === '1') pipeline.params.hlr.handleEdges = true;
  if (params.get('handleShadows') === '1') pipeline.params.ao.handleShadows = true;
  // ?aa=0|none 关；?aa=fxaa；?aa=2|4|8 = MSAA 采样数（缺省随预设：出厂 4× MSAA）
  const aaRaw = params.get('aa');
  if (aaRaw === '0' || aaRaw === 'none') pipeline.params.aa.mode = 'none';
  else if (aaRaw === 'fxaa') pipeline.params.aa.mode = 'fxaa';
  else if (aaRaw === '2' || aaRaw === '4' || aaRaw === '8') {
    pipeline.params.aa.mode = 'msaa';
    pipeline.params.aa.samples = Number(aaRaw) as SglMsaaSamples;
  }

  // sglDx11 内嵌的环境立方体贴图；?envcube=0 用解析天/地兜底对比
  let envCube: CubeTexture | null = null;
  let envCubeEnabled = params.get('envcube') !== '0';
  const applyEnvCube = (): void => {
    for (const m of allMaterials) m.setEnvMap(envCubeEnabled ? envCube : null);
  };
  loadSgl31EnvCube()
    .then((tex) => {
      envCube = tex;
      handle.envCube = tex;
      applyEnvCube();
    })
    .catch((e: unknown) => console.warn('[e3d-look-demo] 环境立方体贴图加载失败', e));

  // 元素颜色：?colours=factory 用出厂 E3D 的一色 lightgrey（autocolour 关时所有元素都是 Add element colour），缺省演示配色
  const demoColours = new Map(allMaterials.map((m) => [m, m.color] as const));
  let factoryColours = params.get('colours') === 'factory';
  const applyColours = (): void => {
    // 辅助对象的 aids 蓝不随 autocolour / Add element colour 变，保持
    for (const m of allMaterials) {
      if (m === aidMaterial) continue;
      m.color = factoryColours ? E3D_DEFAULT_ELEMENT_COLOUR : demoColours.get(m)!;
    }
  };
  applyColours();

  const resize = (): void => {
    const w = canvasHost.clientWidth || 1;
    const h = canvasHost.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    pipeline.setSize(w, h);
  };
  window.addEventListener('resize', resize);
  resize();

  // ---------------- 面板 ----------------
  const statsLine = el('div', 'stats', '');
  panel.appendChild(el('h1', undefined, 'E3D 渲染效果复刻（SGL DX11 口径）'));
  panel.appendChild(statsLine);

  const section = (title: string): HTMLElement => {
    const s = el('section');
    s.appendChild(el('h2', undefined, title));
    panel.appendChild(s);
    return s;
  };

  const addCheckbox = (parent: HTMLElement, label: string, get: () => boolean, set: (v: boolean) => void): void => {
    const row = el('label', 'row');
    const cb = el('input');
    cb.type = 'checkbox';
    cb.checked = get();
    cb.addEventListener('change', () => set(cb.checked));
    row.appendChild(cb);
    row.appendChild(el('span', undefined, label));
    parent.appendChild(row);
  };

  const addSlider = (parent: HTMLElement, label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void): void => {
    const row = el('label', 'row');
    const name = el('span', 'name', label);
    const val = el('span', 'val', String(get()));
    const input = el('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(get());
    input.addEventListener('input', () => {
      const v = Number(input.value);
      set(v);
      val.textContent = String(Math.round(v * 1000) / 1000);
    });
    row.appendChild(name);
    row.appendChild(input);
    row.appendChild(val);
    parent.appendChild(row);
  };

  const addColor = (parent: HTMLElement, label: string, get: () => Color, set: (c: Color) => void): void => {
    const row = el('label', 'row');
    const input = el('input');
    input.type = 'color';
    input.value = `#${get().getHexString()}`;
    input.addEventListener('input', () => set(new Color(input.value)));
    row.appendChild(el('span', 'name', label));
    row.appendChild(input);
    parent.appendChild(row);
  };

  const setLight = (key: 'ambient' | 'diffuse' | 'specular' | 'reflection' | 'specularExponent', v: number): void => {
    for (const m of allMaterials) m.setLight({ [key]: v });
  };
  const currentLight = (): ReturnType<SglLookMaterial['getLight']> => allMaterials[0]!.getLight();

  // 视图
  const sView = section('视图');
  const viewRow = el('div', 'row');
  for (const v of ['iso', 'front', 'top'] as const) {
    const b = el('button', undefined, v);
    b.addEventListener('click', () => setView(v));
    viewRow.appendChild(b);
  }
  sView.appendChild(viewRow);
  addCheckbox(sView, 'legacy 模式（全部效果关，= _legacy_mode）', () => pipeline.params.legacyMode, (v) => { pipeline.params.legacyMode = v; });

  // 预设
  const sPreset = section('预设（切换后光照 / 开关 / 背景一起换，滑块显示值需刷新页面）');
  const presetRow = el('div', 'row');
  const presetButtons = new Map<SglLookPresetId, HTMLButtonElement>();
  const refreshPresetButtons = (): void => {
    for (const [id, b] of presetButtons) b.style.fontWeight = id === activePreset ? 'bold' : 'normal';
  };
  for (const preset of Object.values(SGL_LOOK_PRESETS)) {
    const b = el('button', undefined, preset.label);
    b.title = preset.description;
    b.addEventListener('click', () => { applyPreset(preset.id); refreshPresetButtons(); });
    presetButtons.set(preset.id, b);
    presetRow.appendChild(b);
  }
  refreshPresetButtons();
  sPreset.appendChild(presetRow);
  addCheckbox(sPreset, '环境立方体贴图（sglDx11 gEnvTexture；关 = 解析天/地兜底）', () => envCubeEnabled, (v) => { envCubeEnabled = v; applyEnvCube(); });
  addCheckbox(sPreset, '出厂颜色：全部 lightgrey #bdbdbd（autocolour 关；关 = PDMS 颜色表演示配色）', () => factoryColours, (v) => { factoryColours = v; applyColours(); });

  // 光照（材质）
  const sLight = section('光照 / 材质（Ka Kd Ks Kr Kse，当前预设值）');
  addSlider(sLight, 'Ka 环境', 0, 1.5, 0.01, () => currentLight().ambient, (v) => setLight('ambient', v));
  addSlider(sLight, 'Kd 漫反射', 0, 1.5, 0.01, () => currentLight().diffuse, (v) => setLight('diffuse', v));
  addSlider(sLight, 'Ks 高光', 0, 1.5, 0.01, () => currentLight().specular, (v) => setLight('specular', v));
  addSlider(sLight, 'Kr 反射', 0, 1.5, 0.01, () => currentLight().reflection, (v) => setLight('reflection', v));
  addSlider(sLight, 'Kse 指数', 0, 256, 1, () => currentLight().specularExponent, (v) => setLight('specularExponent', v));
  const env = { sky: 0.75, ground: 0.25 };
  const applyEnv = (): void => { for (const m of allMaterials) m.setAnalyticEnv(env.sky, env.ground); };
  addSlider(sLight, '兜底天顶亮度', 0, 1, 0.01, () => env.sky, (v) => { env.sky = v; applyEnv(); });
  addSlider(sLight, '兜底地面亮度', 0, 1, 0.01, () => env.ground, (v) => { env.ground = v; applyEnv(); });
  const strategyRow = el('div', 'row');
  strategyRow.appendChild(el('span', 'name', '策略'));
  for (const name of ['default', 'flat70', 'unlit'] as const) {
    const b = el('button', undefined, name);
    b.addEventListener('click', () => { for (const m of allMaterials) m.setLight(SGL_LIGHT_STRATEGIES[name]); });
    strategyRow.appendChild(b);
  }
  sLight.appendChild(strategyRow);
  addSlider(sLight, '房间半透明 %', 0, 100, 1, () => 60, (v) => { plant.roomMaterial.sglOpacity = translucencyToAlpha(v); });

  // HLR
  const sHlr = section('HLR 边线（SGL_ENHANCED_EDGES）');
  addCheckbox(sHlr, '启用', () => pipeline.params.hlr.enabled, (v) => { pipeline.params.hlr.enabled = v; });
  addSlider(sHlr, '深度阈值 mm', 1, 500, 1, () => pipeline.params.hlr.depthThreshold, (v) => { pipeline.params.hlr.depthThreshold = v; });
  addSlider(sHlr, '法线 |cos| 阈值', 0, 1, 0.01, () => pipeline.params.hlr.normalThreshold, (v) => { pipeline.params.hlr.normalThreshold = v; });
  addSlider(sHlr, '梯度方向 |dot| 阈值', 0.99, 1, 0.0001, () => pipeline.params.hlr.gradientDotThreshold, (v) => { pipeline.params.hlr.gradientDotThreshold = v; });
  addSlider(sHlr, '半径 px', 1, 4, 1, () => pipeline.params.hlr.radiusPx, (v) => { pipeline.params.hlr.radiusPx = v; });
  addCheckbox(sHlr, '半透明也画边（EnhancedEdgesTranslucent，E3D 默认开；房间盒）', () => pipeline.params.hlr.translucentEdges, (v) => { pipeline.params.hlr.translucentEdges = v; });
  addCheckbox(sHlr, '辅助对象也画边（EnhancedEdgesHandles，E3D 默认关；左前方蓝球 userData.sglHandle）', () => pipeline.params.hlr.handleEdges, (v) => { pipeline.params.hlr.handleEdges = v; });
  addColor(sHlr, '边线色', () => pipeline.params.hlr.edgeColor, (c) => { pipeline.params.hlr.edgeColor.copy(c); });

  // AO
  const sAo = section('HBAO 伪阴影（SGL_PSEUDO_SHADOWS）');
  addCheckbox(sAo, '启用', () => pipeline.params.ao.enabled, (v) => { pipeline.params.ao.enabled = v; });
  addSlider(sAo, 'R 半径 mm', 20, 3000, 10, () => pipeline.params.ao.radius, (v) => { pipeline.params.ao.radius = v; });
  addSlider(sAo, '方向数', 1, 16, 1, () => pipeline.params.ao.numDirs, (v) => { pipeline.params.ao.numDirs = v; });
  addSlider(sAo, '步数', 1, 16, 1, () => pipeline.params.ao.numSteps, (v) => { pipeline.params.ao.numSteps = v; });
  addSlider(sAo, 'AngleBias', 0, 0.8, 0.01, () => pipeline.params.ao.angleBias, (v) => { pipeline.params.ao.angleBias = v; });
  addSlider(sAo, 'Attenuation', 0, 2, 0.05, () => pipeline.params.ao.attenuation, (v) => { pipeline.params.ao.attenuation = v; });
  addSlider(sAo, 'Contrast', 0, 3, 0.05, () => pipeline.params.ao.contrast, (v) => { pipeline.params.ao.contrast = v; });
  addSlider(sAo, '模糊半径 px', 0, 16, 1, () => pipeline.params.ao.blurRadius, (v) => { pipeline.params.ao.blurRadius = v; });
  addCheckbox(sAo, '模糊锐度按 E3D 每帧算：16 / (深度范围 / 2)（关 = 用下面的固定值）', () => pipeline.params.ao.blurSharpnessAuto, (v) => { pipeline.params.ao.blurSharpnessAuto = v; });
  addSlider(sAo, '固定模糊锐度 1/mm', 0, 0.1, 0.001, () => pipeline.params.ao.blurSharpness, (v) => { pipeline.params.ao.blurSharpness = v; });
  addCheckbox(sAo, '辅助对象也受 / 投伪阴影（PseudoShadowsHandles，E3D 默认关；左前方蓝球）', () => pipeline.params.ao.handleShadows, (v) => { pipeline.params.ao.handleShadows = v; });
  addCheckbox(sAo, '半分辨率（E3D 没有）', () => pipeline.params.ao.halfRes, (v) => { pipeline.params.ao.halfRes = v; });

  // 抗锯齿
  const sAa = section('抗锯齿（出厂 4× MSAA；HLR 采样档位随采样数；FXAA 与 MSAA 互斥）');
  const aaRow = el('div', 'row');
  const aaButtons = new Map<string, HTMLButtonElement>();
  const aaKey = (): string => (pipeline.params.aa.mode === 'msaa' ? `msaa${pipeline.params.aa.samples}` : pipeline.params.aa.mode);
  const refreshAaButtons = (): void => {
    for (const [k, b] of aaButtons) b.style.fontWeight = k === aaKey() ? 'bold' : 'normal';
  };
  const aaChoices: [string, string, () => void][] = [
    ['none', '关', () => { pipeline.params.aa.mode = 'none'; }],
    ['msaa2', 'MSAA 2×', () => { pipeline.params.aa.mode = 'msaa'; pipeline.params.aa.samples = 2; }],
    ['msaa4', 'MSAA 4×（出厂）', () => { pipeline.params.aa.mode = 'msaa'; pipeline.params.aa.samples = 4; }],
    ['msaa8', 'MSAA 8×', () => { pipeline.params.aa.mode = 'msaa'; pipeline.params.aa.samples = 8; }],
    ['fxaa', 'FXAA', () => { pipeline.params.aa.mode = 'fxaa'; }],
  ];
  for (const [key, label, apply] of aaChoices) {
    const b = el('button', undefined, label);
    b.addEventListener('click', () => { apply(); refreshAaButtons(); });
    aaButtons.set(key, b);
    aaRow.appendChild(b);
  }
  refreshAaButtons();
  sAa.appendChild(aaRow);

  // 背景
  const sBg = section('背景（effect_bg_gradient，E3D 3.1：上 = 背景色 grey，下 = 端色白，t 0.233→0.9）');
  addCheckbox(sBg, '渐变', () => pipeline.params.background.gradient, (v) => { pipeline.params.background.gradient = v; });
  addColor(sBg, '背景色（上）', () => pipeline.params.background.top, (c) => { pipeline.params.background.top.copy(c); });
  addColor(sBg, '端色（下）', () => pipeline.params.background.bottom, (c) => { pipeline.params.background.bottom.copy(c); });
  addColor(sBg, '纯色', () => pipeline.params.background.flat, (c) => { pipeline.params.background.flat.copy(c); });
  addSlider(sBg, 't@顶', 0, 1, 0.01, () => pipeline.params.background.gradientTopT, (v) => { pipeline.params.background.gradientTopT = v; });
  addSlider(sBg, 't@底', 0, 1, 0.01, () => pipeline.params.background.gradientBottomT, (v) => { pipeline.params.background.gradientBottomT = v; });

  // ---------------- 渲染循环 ----------------
  const handle: DemoHandle = {
    renderer,
    scene,
    camera,
    pipeline,
    plant,
    renderOnce: () => {
      controls.update();
      pipeline.render(scene, camera, null);
      handle.frames += 1;
    },
    setView,
    setPreset: (id) => { applyPreset(id); refreshPresetButtons(); },
    envCube: null,
    setEnvCubeEnabled: (on) => { envCubeEnabled = on; applyEnvCube(); },
    setFactoryColours: (on) => { factoryColours = on; applyColours(); },
    aid,
    frames: 0,
  };
  window.__e3dLookDemo = handle;

  let lastStats = performance.now();
  let framesSince = 0;
  const loop = (): void => {
    const t0 = performance.now();
    handle.renderOnce();
    framesSince += 1;
    const now = performance.now();
    if (now - lastStats > 500) {
      const fps = (framesSince * 1000) / (now - lastStats);
      const range = pipeline.lastDepthRange;
      const sharp = pipeline.lastBlurSharpness;
      const blurInfo = range !== null && sharp !== null ? ` · 深度范围 ${range.toFixed(0)} mm → 模糊锐度 ${sharp.toFixed(4)}` : '';
      const ss = pipeline.hlrSupersample;
      const aaInfo = ` · AA ${pipeline.params.aa.mode === 'msaa' ? `MSAA ${pipeline.colorSamples || 1}×` : pipeline.params.aa.mode} · HLR ${ss.x}×${ss.y}`;
      statsLine.textContent = `${fps.toFixed(0)} fps · 帧 ${(now - t0).toFixed(1)} ms · ${renderer.domElement.width}×${renderer.domElement.height} · 深度附件 ${pipeline.normalDepthType === FloatType ? 'float32' : 'half'}${blurInfo}${aaInfo}`;
      lastStats = now;
      framesSince = 0;
    }
    requestAnimationFrame(loop);
  };
  loop();
}

main();
