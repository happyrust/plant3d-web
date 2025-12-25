import { useConsoleStore } from './useConsoleStore';
import { useViewerContext } from './useViewerContext';
import { pdmsGetUiAttr } from '@/api/genModelPdmsAttrApi';
import { e3dSearch } from '@/api/genModelE3dApi';
import { getModelTreeInstance } from '@/composables/useModelTreeStore';

// Helper to format vector
function formatPos(p: number[] | Float32Array | Float64Array | { [key: number]: number, length: number }): string {
    if (!p) return 'N/A';
    if (Array.isArray(p) || ArrayBuffer.isView(p)) {
        return `${p[0]?.toFixed(2)} ${p[1]?.toFixed(2)} ${p[2]?.toFixed(2)}`;
    }
    return 'Invalid Pos';
}

export function usePdmsConsoleCommands() {
    const store = useConsoleStore();
    const ctx = useViewerContext();

    function getViewer() {
        return ctx.viewerRef.value;
    }

    function getSelectedId(): string | null {
        // 优先从模型树获取选中节点
        const tree = getModelTreeInstance();
        if (tree && tree.selectedIds.value.size > 0) {
            // 返回第一个选中的节点
            const firstId = tree.selectedIds.value.values().next().value;
            if (firstId) return firstId;
        }

        // 回退：从场景选中对象获取
        const viewer = getViewer();
        if (!viewer) return null;
        // @ts-ignore
        const selected = viewer.scene.selectedObjects;
        if (!selected) return null;
        const ids = Object.keys(selected);
        if (ids.length === 0) return null;
        return ids[0] ?? null; // Return first selected
    }

    // --- Command Handlers ---

    // Q (Query)
    store.registerCommand('q', async (args: string[]) => {
        const viewer = getViewer();
        if (!viewer) {
            store.addLog('error', 'Viewer not ready');
            return;
        }

        const id = getSelectedId();
        if (!id && args[0]?.toUpperCase() !== 'REF') {
            store.addLog('error', 'No element selected (CE is unset)');
            return;
        }

        const cmd = args.join(' ').toUpperCase();

        // Handle Q REF (Refno) - 查询参考号
        if (cmd === 'REF' || cmd === 'REFNO') {
            if (id) {
                store.addLog('output', `Refno: ${id}`);
            }
            return;
        }

        // Handle Q DBNUM - 查询数据库编号
        if (cmd === 'DBNUM') {
            if (id) {
                // refno 格式是 "dbnum_refno"，提取 dbnum 部分
                const parts = id.split('_');
                if (parts.length >= 2) {
                    store.addLog('output', `DBNUM: ${parts[0]}`);
                } else {
                    store.addLog('info', 'Cannot parse DBNUM from refno');
                }
            }
            return;
        }

        // 需要从后端获取属性的查询
        if (!id) return;

        try {
            const resp = await pdmsGetUiAttr(id);
            if (!resp.success) {
                store.addLog('error', resp.error_message || 'Failed to fetch attributes');
                return;
            }

            const attrs = resp.attrs as Record<string, unknown>;

            // Helper function to get attribute value (case-insensitive)
            const getAttr = (name: string): unknown => {
                return attrs[name] ?? attrs[name.toUpperCase()] ?? attrs[name.toLowerCase()];
            };

            // Helper function to format position/orientation
            const formatVec3 = (val: unknown): string | null => {
                if (val === null || val === undefined) return null;
                if (typeof val === 'string') return val;
                if (Array.isArray(val) && val.length >= 3) {
                    const x = typeof val[0] === 'number' ? val[0].toFixed(2) : val[0];
                    const y = typeof val[1] === 'number' ? val[1].toFixed(2) : val[1];
                    const z = typeof val[2] === 'number' ? val[2].toFixed(2) : val[2];
                    return `${x} ${y} ${z}`;
                }
                if (typeof val === 'object' && val !== null) {
                    const obj = val as Record<string, number>;
                    if ('x' in obj && 'y' in obj && 'z' in obj) {
                        return `${obj.x?.toFixed?.(2) ?? obj.x} ${obj.y?.toFixed?.(2) ?? obj.y} ${obj.z?.toFixed?.(2) ?? obj.z}`;
                    }
                }
                return String(val);
            };

            // Handle Q WPOS / Q POS WRT /* - 查询世界坐标位置
            if (cmd === 'WPOS' || cmd === 'POS WRT /*') {
                const pos = getAttr('WPOS') ?? getAttr('POS');
                if (pos !== undefined) {
                    const formatted = formatVec3(pos);
                    store.addLog('output', `Position (World): ${formatted}`);
                } else {
                    // 尝试从场景对象获取
                    // @ts-ignore - Xeokit Entity 有 position 属性
                    const object = viewer.scene.objects[id];
                    // @ts-ignore
                    if (object?.position) {
                        // @ts-ignore
                        store.addLog('output', `Position (World): ${formatPos(object.position)}`);
                    } else {
                        store.addLog('info', 'World position not available');
                    }
                }
                return;
            }

            // Handle Q POS - 查询本地坐标位置
            if (cmd === 'POS') {
                const pos = getAttr('POS') ?? getAttr('POSITION');
                if (pos !== undefined) {
                    const formatted = formatVec3(pos);
                    store.addLog('output', `Position (Local): ${formatted}`);
                } else {
                    store.addLog('info', 'Local position not available');
                }
                return;
            }

            // Handle Q WORI / Q ORI WRT /* - 查询世界坐标方位
            if (cmd === 'WORI' || cmd === 'ORI WRT /*') {
                const ori = getAttr('WORI') ?? getAttr('ORI');
                if (ori !== undefined) {
                    const formatted = formatVec3(ori);
                    store.addLog('output', `Orientation (World): ${formatted}`);
                } else {
                    store.addLog('info', 'World orientation not available');
                }
                return;
            }

            // Handle Q ORI - 查询本地坐标方位
            if (cmd === 'ORI') {
                const ori = getAttr('ORI') ?? getAttr('ORIENTATION');
                if (ori !== undefined) {
                    const formatted = formatVec3(ori);
                    store.addLog('output', `Orientation (Local): ${formatted}`);
                } else {
                    store.addLog('info', 'Local orientation not available');
                }
                return;
            }

            // Handle Q POS WRT OWNER - 查询相对于拥有者的位置
            if (cmd === 'POS WRT OWNER') {
                const pos = getAttr('LPOS') ?? getAttr('LOCAL_POS') ?? getAttr('POS');
                if (pos !== undefined) {
                    const formatted = formatVec3(pos);
                    store.addLog('output', `Position (WRT OWNER): ${formatted}`);
                } else {
                    store.addLog('info', 'Local position not available');
                }
                return;
            }

            // Handle Q ORI WRT OWNER - 查询相对于拥有者的方位
            if (cmd === 'ORI WRT OWNER') {
                const ori = getAttr('LORI') ?? getAttr('LOCAL_ORI') ?? getAttr('ORI');
                if (ori !== undefined) {
                    const formatted = formatVec3(ori);
                    store.addLog('output', `Orientation (WRT OWNER): ${formatted}`);
                } else {
                    store.addLog('info', 'Local orientation not available');
                }
                return;
            }

            // Handle Q ATT <Attribute>
            if (cmd.startsWith('ATT')) {
                const attrName = args[1];
                if (!attrName) {
                    store.addLog('error', 'Usage: Q ATT <attribute_name>');
                    return;
                }

                const val = getAttr(attrName);
                if (val !== undefined) {
                    store.addLog('output', `${attrName}: ${val}`);
                } else {
                    store.addLog('info', `Attribute ${attrName} not found on ${id}`);
                }
                return;
            }

            // Fallback: Query any attribute directly: "Q NAME" -> implicit attribute query
            if (args.length === 1) {
                const attr = args[0];
                if (!attr) return;

                const val = getAttr(attr);
                if (val !== undefined) {
                    store.addLog('output', `${attr}: ${val}`);
                } else {
                    store.addLog('info', `Property '${attr}' not found.`);
                }
                return;
            }

            store.addLog('info', `Unknown Query: ${cmd}`);
        } catch (e) {
            store.addLog('error', `API Error: ${e}`);
        }
    });

    // = <Refno> (Go to Refno)
    store.registerCommand('=', async (args: string[]) => {
        let refno = args[0];
        if (!refno) {
            store.addLog('error', 'Usage: = <refno>');
            return;
        }

        // 将斜线格式转换为下划线格式（例如 17496/272482 -> 17496_272482）
        refno = refno.replace(/\//g, '_');

        const tree = getModelTreeInstance();
        if (!tree) {
            store.addLog('error', 'Model tree not initialized');
            return;
        }

        try {
            // Use focusNodeById to expand ancestors and select the node
            await tree.focusNodeById(refno, {
                flyTo: true,
                syncSceneSelection: true,
                clearSearch: true
            });
            store.addLog('output', `CE set to: ${refno}`);
        } catch (e) {
            store.addLog('error', `Navigation failed: ${e instanceof Error ? e.message : String(e)}`);
        }
    });

    // / <Name> (Go to Name)
    store.registerCommand('/', async (args: string[]) => {
        const name = args.join(' ');
        if (!name) {
            store.addLog('error', 'Usage: / <name>');
            return;
        }

        store.addLog('input', `Searching for '${name}'...`);

        try {
            const resp = await e3dSearch({ keyword: name, limit: 10 });
            if (resp.success && resp.items.length > 0) {
                const match = resp.items.find(i => i.name === name || i.name === `/${name}`) || resp.items[0];

                if (match) {
                    const refno = match.refno;
                    store.addLog('output', `Found: ${match.name} (${refno})`);

                    const tree = getModelTreeInstance();
                    if (!tree) {
                        store.addLog('error', 'Model tree not initialized');
                        return;
                    }

                    try {
                        // Use focusNodeById to expand ancestors and select the node
                        await tree.focusNodeById(refno, {
                            flyTo: true,
                            syncSceneSelection: true,
                            clearSearch: true
                        });
                        store.addLog('output', `CE set to: ${match.name} (${refno})`);
                    } catch (e) {
                        store.addLog('error', `Navigation failed: ${e instanceof Error ? e.message : String(e)}`);
                    }
                }
            } else {
                store.addLog('error', `Name '${name}' not found.`);
            }
        } catch (e) {
            store.addLog('error', `Search failed: ${e}`);
        }
    });
}
