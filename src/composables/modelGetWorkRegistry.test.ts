import { beforeEach, describe, expect, it } from 'vitest';

import {
  advanceGetWorkRoot,
  forgetGetWorkRoot,
  getWorkRegisteredRoots,
  getWorkRegisteredScopes,
  noteGetWorkDbnumScope,
  noteGetWorkRoot,
  noteGetWorkScopeChecked,
  noteGetWorkSiteKnown,
  resetGetWorkRegistry,
} from './modelGetWorkRegistry';

beforeEach(() => {
  resetGetWorkRegistry();
});

describe('取最新的登记表：直接装进场景的节点', () => {
  it('登记时 refno 归一成 a_b；同一个节点再登记覆盖原来那一行', () => {
    noteGetWorkRoot('24384/26547', 8000, { modelSesno: 1143, fileLatestSesno: 1143 }, 'show_dbnum');
    noteGetWorkRoot('24381_145018', 7997, { modelSesno: null, fileLatestSesno: null }, 'show_refno');
    noteGetWorkRoot('24384_26547', 8000, { modelSesno: 1146, fileLatestSesno: 1146 }, 'debug_refno');
    expect(getWorkRegisteredRoots()).toEqual([
      { refno: '24384_26547', dbnum: 8000, loadedModelSesno: 1146, loadedFileLatestSesno: 1146, origin: 'debug_refno' },
      { refno: '24381_145018', dbnum: 7997, loadedModelSesno: null, loadedFileLatestSesno: null, origin: 'show_refno' },
    ]);
  });

  it('空 refno、解不出库号的不登记', () => {
    noteGetWorkRoot('', 8000, { modelSesno: 1, fileLatestSesno: 1 }, 'show_refno');
    noteGetWorkRoot('24384_1', Number.NaN, { modelSesno: 1, fileLatestSesno: 1 }, 'show_refno');
    noteGetWorkRoot('24384_1', 0, { modelSesno: 1, fileLatestSesno: 1 }, 'show_refno');
    expect(getWorkRegisteredRoots()).toEqual([]);
  });

  it('推进水位只动表里有的节点；撤掉之后不再出现', () => {
    noteGetWorkRoot('24384_26547', 8000, { modelSesno: 1143, fileLatestSesno: 1143 }, 'show_dbnum');
    advanceGetWorkRoot('24384/26547', { modelSesno: 1146, fileLatestSesno: 1149 });
    advanceGetWorkRoot('24384_9', { modelSesno: 1146, fileLatestSesno: 1149 });
    expect(getWorkRegisteredRoots()).toEqual([
      { refno: '24384_26547', dbnum: 8000, loadedModelSesno: 1146, loadedFileLatestSesno: 1149, origin: 'show_dbnum' },
    ]);
    forgetGetWorkRoot('24384/26547');
    expect(getWorkRegisteredRoots()).toEqual([]);
  });

  it('读出去的是拷贝：改它不影响表', () => {
    noteGetWorkRoot('24384_26547', 8000, { modelSesno: 1143, fileLatestSesno: 1143 }, 'show_dbnum');
    getWorkRegisteredRoots()[0]!.loadedModelSesno = 9999;
    expect(getWorkRegisteredRoots()[0]!.loadedModelSesno).toBe(1143);
  });
});

describe('取最新的登记表：整库显示过的库', () => {
  it('记下已在管的 SITE、要不要找新 SITE、显示时库文件的最新会话；同一个库再显示一次名单合并', () => {
    noteGetWorkDbnumScope(8000, { sites: ['24384/26547'], discover: true, fileLatestSesno: 1143 });
    noteGetWorkDbnumScope(8000, { sites: ['24384_30000', ''], discover: false, fileLatestSesno: 1146 });
    const [scope] = getWorkRegisteredScopes();
    expect(scope).toMatchObject({ dbnum: 8000, discover: false, checkedFileLatestSesno: 1146 });
    expect([...scope!.knownSites]).toEqual(['24384_26547', '24384_30000']);
  });

  it('新装进来的 SITE 记成已在管；找过一次之后记下当时库文件的最新会话；没登记过的库不管', () => {
    noteGetWorkDbnumScope(8000, { sites: [], discover: true, fileLatestSesno: 1143 });
    noteGetWorkSiteKnown(8000, '24384/30000');
    noteGetWorkSiteKnown(7997, '24381_1');
    noteGetWorkScopeChecked(8000, 1149);
    noteGetWorkScopeChecked(7997, 5);
    const scopes = getWorkRegisteredScopes();
    expect(scopes).toHaveLength(1);
    expect([...scopes[0]!.knownSites]).toEqual(['24384_30000']);
    expect(scopes[0]!.checkedFileLatestSesno).toBe(1149);
  });

  it('库号不对的不登记；读出去的名单是拷贝', () => {
    noteGetWorkDbnumScope(0, { sites: ['1_1'], discover: true, fileLatestSesno: 1 });
    expect(getWorkRegisteredScopes()).toEqual([]);
    noteGetWorkDbnumScope(8000, { sites: ['24384_26547'], discover: true, fileLatestSesno: 1143 });
    getWorkRegisteredScopes()[0]!.knownSites.add('x_y');
    expect(getWorkRegisteredScopes()[0]!.knownSites.has('x_y')).toBe(false);
  });

  it('场景清空：两张表都撤掉', () => {
    noteGetWorkRoot('24384_26547', 8000, { modelSesno: 1143, fileLatestSesno: 1143 }, 'show_dbnum');
    noteGetWorkDbnumScope(8000, { sites: ['24384_26547'], discover: true, fileLatestSesno: 1143 });
    resetGetWorkRegistry();
    expect(getWorkRegisteredRoots()).toEqual([]);
    expect(getWorkRegisteredScopes()).toEqual([]);
  });
});
