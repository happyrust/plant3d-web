import { afterEach, describe, expect, it, vi } from 'vitest';

import { PerspectiveCamera, Vector2 } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import { bindDynamicPivotToCanvas, createRememberedPivotMarker } from './DynamicPivotCanvasBinding';

import type { DynamicPivotController } from './DynamicPivotController';

const CANVAS_LEFT = 120;
const CANVAS_TOP = 40;
const CANVAS_WIDTH = 1000;
const CANVAS_HEIGHT = 800;

function createTestCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  Object.defineProperty(canvas, 'clientWidth', { value: CANVAS_WIDTH, configurable: true });
  Object.defineProperty(canvas, 'clientHeight', { value: CANVAS_HEIGHT, configurable: true });
  canvas.getBoundingClientRect = () =>
    ({
      left: CANVAS_LEFT,
      top: CANVAS_TOP,
      right: CANVAS_LEFT + CANVAS_WIDTH,
      bottom: CANVAS_TOP + CANVAS_HEIGHT,
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      x: CANVAS_LEFT,
      y: CANVAS_TOP,
      toJSON: () => ({}),
    }) as DOMRect;
  canvas.setPointerCapture = vi.fn();
  canvas.releasePointerCapture = vi.fn();
  document.body.appendChild(canvas);
  return canvas;
}

function createHarness(options: { isSuspended?: () => boolean } = {}) {
  const canvas = createTestCanvas();
  const camera = new PerspectiveCamera(30, CANVAS_WIDTH / CANVAS_HEIGHT, 0.1, 10000);
  camera.up.set(0, 0, 1);
  camera.position.set(0, -20, 0);
  const controls = new OrbitControls(camera, canvas);
  controls.update();

  const controller = {
    handleMouseDown: vi.fn(),
    handleMouseMove: vi.fn(),
    handleMouseUp: vi.fn(),
    handleWheel: vi.fn(),
  };
  let currentController: typeof controller | null = controller;

  const controlsStart = vi.fn();
  controls.addEventListener('start', controlsStart);

  const unbind = bindDynamicPivotToCanvas({
    canvas,
    controls,
    getController: () => currentController as unknown as DynamicPivotController | null,
    isSuspended: options.isSuspended,
  });

  const pointer = (
    type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
    x: number,
    y: number,
    init: PointerEventInit = {},
  ): PointerEvent => {
    const event = new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      pointerId: 1,
      pointerType: 'mouse',
      button: type === 'pointermove' ? -1 : 0,
      buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
      ...init,
    });
    canvas.dispatchEvent(event);
    return event;
  };

  const wheel = (x: number, y: number, deltaY: number): WheelEvent => {
    const event = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY,
      deltaMode: 0,
    });
    // happy-dom 的 WheelEvent 不继承 MouseEvent，构造参数里的 clientX / clientY 会被丢掉；浏览器里是带着的
    Object.defineProperty(event, 'clientX', { value: x });
    Object.defineProperty(event, 'clientY', { value: y });
    canvas.dispatchEvent(event);
    return event;
  };

  const cleanup = () => {
    unbind();
    controls.dispose();
    canvas.remove();
  };

  return {
    canvas,
    controls,
    controller,
    controlsStart,
    unbind,
    pointer,
    wheel,
    cleanup,
    detachController() {
      currentController = null;
    },
  };
}

/** 画布内坐标：客户区坐标减去画布左上角 */
function inCanvas(clientX: number, clientY: number): Vector2 {
  return new Vector2(clientX - CANVAS_LEFT, clientY - CANVAS_TOP);
}

describe('bindDynamicPivotToCanvas：按下只登记，OrbitControls 发出 start 才交给焦点控制器', () => {
  const cleanups: (() => void)[] = [];

  afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()?.();
  });

  it('OrbitControls 认了这次按下：把这次按下交过去，位置换算成画布内坐标，一次按下只交一次', () => {
    const h = createHarness();
    cleanups.push(h.cleanup);

    const down = h.pointer('pointerdown', 620, 340);

    expect(h.controlsStart).toHaveBeenCalledTimes(1);
    expect(h.controller.handleMouseDown).toHaveBeenCalledTimes(1);
    expect(h.controller.handleMouseDown).toHaveBeenCalledWith(inCanvas(620, 340), down);
  });

  it('中键、右键、Shift+左键同样要等 start，且原样带上那次按下的事件（动作由控制器按它判定）', () => {
    for (const init of [{ button: 1, buttons: 4 }, { button: 2, buttons: 2 }, { button: 0, buttons: 1, shiftKey: true }]) {
      const h = createHarness();
      cleanups.push(h.cleanup);

      const down = h.pointer('pointerdown', 300, 200, init);

      expect(h.controlsStart).toHaveBeenCalledTimes(1);
      expect(h.controller.handleMouseDown).toHaveBeenCalledTimes(1);
      expect(h.controller.handleMouseDown).toHaveBeenCalledWith(inCanvas(300, 200), down);
    }
  });

  it('按下被工具截走（OrbitControls 收不到）：什么都不交；之后滚轮或别处发出的 start 也不会把它补交', () => {
    const h = createHarness();
    cleanups.push(h.cleanup);

    // 工具的监听挂在接线之后、OrbitControls 之前：接线已经登记了这次按下
    const intercept = (event: Event) => event.stopImmediatePropagation();
    h.canvas.addEventListener('pointerdown', intercept, { capture: true });
    h.pointer('pointerdown', 620, 340);
    h.canvas.removeEventListener('pointerdown', intercept, { capture: true });

    expect(h.controlsStart).not.toHaveBeenCalled();
    expect(h.controller.handleMouseDown).not.toHaveBeenCalled();

    h.wheel(620, 340, -120);
    expect(h.controlsStart).toHaveBeenCalledTimes(1);
    h.controls.dispatchEvent({ type: 'start' });
    expect(h.controlsStart).toHaveBeenCalledTimes(2);
    expect(h.controller.handleMouseDown).not.toHaveBeenCalled();

    // 下一次没被截走的按下照常交，交的是新的这一次
    const down = h.pointer('pointerdown', 700, 400);
    expect(h.controller.handleMouseDown).toHaveBeenCalledTimes(1);
    expect(h.controller.handleMouseDown).toHaveBeenCalledWith(inCanvas(700, 400), down);
  });

  it('按下在外层就被截走（接线和 OrbitControls 都收不到）：不交', () => {
    const h = createHarness();
    cleanups.push(h.cleanup);

    const intercept = (event: Event) => event.stopPropagation();
    document.body.addEventListener('pointerdown', intercept, { capture: true });
    cleanups.push(() => document.body.removeEventListener('pointerdown', intercept, { capture: true }));
    h.pointer('pointerdown', 620, 340);

    expect(h.controlsStart).not.toHaveBeenCalled();
    expect(h.controller.handleMouseDown).not.toHaveBeenCalled();
  });

  it('相机控制器被禁用、或按的是它不认的键：没有 start，不交', () => {
    const disabled = createHarness();
    cleanups.push(disabled.cleanup);
    disabled.controls.enabled = false;
    disabled.pointer('pointerdown', 620, 340);
    expect(disabled.controlsStart).not.toHaveBeenCalled();
    expect(disabled.controller.handleMouseDown).not.toHaveBeenCalled();

    const unknownButton = createHarness();
    cleanups.push(unknownButton.cleanup);
    unknownButton.pointer('pointerdown', 620, 340, { button: 3, buttons: 8 });
    expect(unknownButton.controlsStart).not.toHaveBeenCalled();
    expect(unknownButton.controller.handleMouseDown).not.toHaveBeenCalled();

    const rotateOff = createHarness();
    cleanups.push(rotateOff.cleanup);
    rotateOff.controls.enableRotate = false;
    rotateOff.pointer('pointerdown', 620, 340);
    expect(rotateOff.controlsStart).not.toHaveBeenCalled();
    expect(rotateOff.controller.handleMouseDown).not.toHaveBeenCalled();
  });

  it('移动、抬起 / 取消、滚轮照常转给焦点控制器，移动和滚轮带画布内坐标', () => {
    const h = createHarness();
    cleanups.push(h.cleanup);

    h.pointer('pointerdown', 620, 340);
    const move = h.pointer('pointermove', 660, 320);
    expect(h.controller.handleMouseMove).toHaveBeenCalledTimes(1);
    expect(h.controller.handleMouseMove).toHaveBeenCalledWith(inCanvas(660, 320), move);

    h.pointer('pointerup', 660, 320);
    expect(h.controller.handleMouseUp).toHaveBeenCalledTimes(1);
    h.pointer('pointercancel', 660, 320);
    expect(h.controller.handleMouseUp).toHaveBeenCalledTimes(2);

    const wheelEvent = h.wheel(300, 200, -120);
    expect(h.controller.handleWheel).toHaveBeenCalledTimes(1);
    expect(h.controller.handleWheel).toHaveBeenCalledWith(inCanvas(300, 200), wheelEvent);
    // 滚轮自己的 start 不会被当成一次按下
    expect(h.controller.handleMouseDown).toHaveBeenCalledTimes(1);
  });

  it('滚轮先到焦点控制器、再到 OrbitControls（它要在相机动之前对好焦点）', () => {
    const h = createHarness();
    cleanups.push(h.cleanup);

    const order: string[] = [];
    h.controller.handleWheel.mockImplementation(() => order.push('pivot'));
    h.controls.addEventListener('start', () => order.push('controls'));
    h.wheel(300, 200, -120);

    expect(order).toEqual(['pivot', 'controls']);
  });

  it('isSuspended 为真时按下、移动、滚轮都不交；抬起照常交（让在途的手势能收尾）', () => {
    let suspended = true;
    const h = createHarness({ isSuspended: () => suspended });
    cleanups.push(h.cleanup);

    h.pointer('pointerdown', 620, 340);
    h.pointer('pointermove', 660, 320);
    h.wheel(300, 200, -120);
    expect(h.controlsStart).toHaveBeenCalled();
    expect(h.controller.handleMouseDown).not.toHaveBeenCalled();
    expect(h.controller.handleMouseMove).not.toHaveBeenCalled();
    expect(h.controller.handleWheel).not.toHaveBeenCalled();

    h.pointer('pointerup', 660, 320);
    expect(h.controller.handleMouseUp).toHaveBeenCalledTimes(1);

    suspended = false;
    h.pointer('pointerdown', 620, 340);
    expect(h.controller.handleMouseDown).toHaveBeenCalledTimes(1);
  });

  it('焦点控制器不在（还没建好或已销毁）时事件照常流过，不报错', () => {
    const h = createHarness();
    cleanups.push(h.cleanup);
    h.detachController();

    expect(() => {
      h.pointer('pointerdown', 620, 340);
      h.pointer('pointermove', 660, 320);
      h.pointer('pointerup', 660, 320);
      h.wheel(300, 200, -120);
    }).not.toThrow();
    expect(h.controlsStart).toHaveBeenCalledTimes(2);
  });

  it('解除接线后不再转发，也不再听 start', () => {
    const h = createHarness();
    cleanups.push(h.cleanup);

    const removeControlsListener = vi.spyOn(h.controls, 'removeEventListener');
    h.unbind();
    expect(removeControlsListener).toHaveBeenCalledWith('start', expect.any(Function));

    h.pointer('pointerdown', 620, 340);
    h.pointer('pointermove', 660, 320);
    h.pointer('pointerup', 660, 320);
    h.wheel(300, 200, -120);

    expect(h.controlsStart).toHaveBeenCalledTimes(2);
    expect(h.controller.handleMouseDown).not.toHaveBeenCalled();
    expect(h.controller.handleMouseMove).not.toHaveBeenCalled();
    expect(h.controller.handleMouseUp).not.toHaveBeenCalled();
    expect(h.controller.handleWheel).not.toHaveBeenCalled();
  });
});

describe('createRememberedPivotMarker：记住的旋转中心的小圆点', () => {
  const HOST_LEFT = 100;
  const HOST_TOP = 30;
  const disposers: (() => void)[] = [];

  afterEach(() => {
    while (disposers.length > 0) {
      disposers.pop()?.();
    }
  });

  /** 叠加层左上角在 (100, 30)，画布左上角在 (120, 40)：画布在叠加层里偏 (20, 10) */
  function setup() {
    const canvas = createTestCanvas();
    const host = document.createElement('div');
    host.getBoundingClientRect = () =>
      ({
        left: HOST_LEFT,
        top: HOST_TOP,
        right: HOST_LEFT + 1100,
        bottom: HOST_TOP + 900,
        width: 1100,
        height: 900,
        x: HOST_LEFT,
        y: HOST_TOP,
        toJSON: () => ({}),
      }) as DOMRect;
    document.body.appendChild(host);
    const marker = createRememberedPivotMarker(host, canvas);
    disposers.push(() => {
      marker.dispose();
      host.remove();
      canvas.remove();
    });
    const findDot = () => document.querySelector<HTMLElement>('[data-testid="dtx-remembered-pivot"]');
    return { host, marker, findDot };
  }

  it('建出来挂在叠加层里，先不显示，不吃鼠标', () => {
    const { host, findDot } = setup();

    const dot = findDot();
    expect(dot?.parentElement).toBe(host);
    expect(dot?.style.display).toBe('none');
    expect(dot?.style.pointerEvents).toBe('none');
  });

  it('给了位置就显示在那一点：画布内坐标换成叠加层自己的坐标', () => {
    const { marker, findDot } = setup();

    marker.place({ x: 300, y: 200 });
    expect(findDot()?.style.display).toBe('block');
    expect(findDot()?.style.transform).toBe('translate(320px, 210px)');

    marker.place({ x: 301.5, y: 180 });
    expect(findDot()?.style.transform).toBe('translate(321.5px, 190px)');
  });

  it('place(null) 收起，再给位置重新显示', () => {
    const { marker, findDot } = setup();

    marker.place({ x: 300, y: 200 });
    marker.place(null);
    expect(findDot()?.style.display).toBe('none');

    marker.place({ x: 300, y: 200 });
    expect(findDot()?.style.display).toBe('block');
    expect(findDot()?.style.transform).toBe('translate(320px, 210px)');
  });

  it('被别人从叠加层里清掉以后，下一次 place 把它放回去', () => {
    const { host, marker, findDot } = setup();

    marker.place({ x: 300, y: 200 });
    host.replaceChildren();
    expect(findDot()).toBeNull();

    marker.place({ x: 300, y: 200 });
    expect(findDot()?.parentElement).toBe(host);
    expect(findDot()?.style.display).toBe('block');
  });

  it('dispose 之后圆点从页面上拿掉', () => {
    const { marker, findDot } = setup();

    marker.place({ x: 300, y: 200 });
    marker.dispose();
    expect(findDot()).toBeNull();
  });
});
