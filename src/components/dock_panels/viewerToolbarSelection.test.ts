import { describe, expect, it } from 'vitest';

import { resolveViewerToolbarSelection } from './viewerToolbarSelection';

describe('resolveViewerToolbarSelection', () => {
  it('在未写 selectedRefno 时回退到场景选中集', () => {
    expect(
      resolveViewerToolbarSelection({
        selectedRefno: null,
        sceneSelectedObjectIds: ['17496_1', '17496_2'],
      }),
    ).toEqual({
      primaryRefno: null,
      sceneSelectedRefnos: ['17496_1', '17496_2'],
    });
  });

  it('在只有一个场景选中对象时提供 primaryRefno', () => {
    expect(
      resolveViewerToolbarSelection({
        selectedRefno: null,
        sceneSelectedObjectIds: ['17496_1'],
      }),
    ).toEqual({
      primaryRefno: '17496_1',
      sceneSelectedRefnos: ['17496_1'],
    });
  });

  it('优先保留 selection store 的单选 refno，并清洗重复场景选中项', () => {
    expect(
      resolveViewerToolbarSelection({
        selectedRefno: ' 17496_9 ',
        sceneSelectedObjectIds: ['17496_9', ' ', '17496_9', '17496_10'],
      }),
    ).toEqual({
      primaryRefno: '17496_9',
      sceneSelectedRefnos: ['17496_9', '17496_10'],
    });
  });
});
