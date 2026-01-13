/**
 * 在 plant3d-web 环境下测试使用 surrealdb.js 获取模型数据
 * 验证对 17496_123351 的获取
 */

import { Surreal } from "surrealdb";

const DB_URL = "ws://localhost:8020";
const TARGET_REFNO = "17496_123351";

async function main() {
    console.log(`=== [plant3d-web] 模型数据获取测试: ${TARGET_REFNO} ===\n`);

    const db = new Surreal();

    try {
        // 1. 连接与登录
        console.log(`📡 正在连接到 ${DB_URL}...`);
        await db.connect(DB_URL);

        console.log("🔐 正在登录 (root/root)...");
        await db.signin({
            username: "root",
            password: "root",
        });

        console.log("📂 设置 namespace/database (1516/AvevaMarineSample)...");
        await db.use({
            namespace: "1516",
            database: "AvevaMarineSample",
        });
        console.log("✅ 环境准备就绪\n");

        // 2. 模拟 useSurrealModelQuery 中的 queryInsts 核心逻辑
        console.log(`🔍 正在查询几何实例信息: ${TARGET_REFNO}...`);

        const instRelateKey = `inst_relate:⟨${TARGET_REFNO}⟩`;

        // 简化版的查询 SQL，参考 useSurrealModelQuery.ts
        const sql = `
            SELECT
                record::id(in.id) as refno,
                record::id(in.owner ?? in) as owner,
                generic,
                world_trans.d as world_trans,
                (SELECT value out.d FROM in->inst_relate_aabb LIMIT 1)[0] as world_aabb,
                (SELECT 
                    trans.d as transform, 
                    record::id(out) as geo_hash, 
                    false as is_tubi, 
                    out.unit_flag ?? false as unit_flag 
                 FROM out->geo_relate 
                 WHERE visible 
                   && (out.meshed || out.unit_flag || record::id(out) IN ['1','2','3']) 
                   && trans.d != none 
                   && geo_type IN ['Pos', 'DesiPos', 'CatePos']) as insts,
                <datetime>dt as date,
                spec_value
            FROM [${instRelateKey}] 
            WHERE world_trans.d != none
        `;

        const result = await db.query(sql);
        console.log("📜 查询结果:");
        console.log(JSON.stringify(result[0], null, 2));

        if (Array.isArray(result[0]) && result[0].length > 0) {
            console.log("\n✅ 成功获取到几何实例数据!");
            const row = result[0][0];
            if (row.insts && row.insts.length > 0) {
                console.log(`🎨 包含 ${row.insts.length} 个几何实例片段 (insts)`);
            } else {
                console.log("⚠️  核心几何实例片段 (insts) 列表为空，请检查数据关联。");
            }
        } else {
            console.log("\n❌ 未找到对应数据，请确认 ID 是否正确或 world_trans 是否存在。");

            // 补充检查：基础记录是否存在
            console.log(`\n🔍 补充检查: 直接查询 ${instRelateKey}...`);
            const rawCheck = await db.query(`SELECT * FROM ${instRelateKey}`);
            console.log("基础记录数据:", JSON.stringify(rawCheck[0], null, 2));
        }

    } catch (error) {
        console.error("❌ 发生错误:", error);
    } finally {
        await db.close();
        console.log("\n🔌 连接已关闭");
    }
}

main();
