
import { Surreal } from "surrealdb";

const REMOTE_URL = "ws://localhost:8020";
const LOCAL_DB_URL = "indxdb://SurrealDB_Benchmark";
const NAMESPACE = "1516";
const DATABASE = "AvevaMarineSample";
const DBNUM = 1112;

async function runBenchmark() {
    console.log(`\n🚀 Starting SurrealDB Sync Benchmark`);
    console.log(`-----------------------------------`);
    console.log(`Remote: ${REMOTE_URL}`);
    console.log(`Local:  ${LOCAL_DB_URL}`);
    console.log(`DBNum:  ${DBNUM}`);
    console.log(`-----------------------------------\n`);

    const remote = new Surreal();
    const local = new Surreal();

    try {
        // 1. Connect and Signin
        console.log(`[1/5] Connecting to databases...`);
        await remote.connect(REMOTE_URL);
        await remote.signin({ username: "root", password: "root" });
        await remote.use({ namespace: NAMESPACE, database: DATABASE });
        console.log(` ✅ Remote connected.`);

        await local.connect(LOCAL_DB_URL);
        // IndexedDB normally doesn't need signin in SurrealDB JS if not configured, 
        // but we'll use same namespace/db for consistency
        await local.use({ namespace: NAMESPACE, database: DATABASE });
        console.log(` ✅ Local (IndexedDB) connected.`);

        // 2. Clear Local Data (Optional but good for clean benchmark)
        console.log(`[2/5] Cleaning local data for dbnum ${DBNUM}...`);
        await local.query(`DELETE pe WHERE dbnum = ${DBNUM}`);
        // inst_relate needs to be deleted by reference or by joining, 
        // for simplicity in benchmark we'll count results later
        console.log(` ✅ Local clean-up done (pe table).`);

        // 3. Fetch Data from Remote
        console.log(`[3/5] Fetching data from remote...`);
        const startTimeFetch = performance.now();

        // Fetch PE
        const peResult = await remote.query<any>(`SELECT * FROM pe WHERE dbnum = ${DBNUM}`);
        const pes = peResult[0] as any[];
        console.log(` 📦 Fetched ${pes.length} pe records.`);

        // Fetch InstRelate
        // We fetch inst_relate records that correspond to the pes
        // Optimization: bulk fetch
        const refnos = pes.map(p => p.id);
        const instRelateResult = await remote.query<any>(`SELECT * FROM inst_relate WHERE id IN $ids`, { ids: refnos });
        const insts = instRelateResult[0] as any[];
        console.log(` 📦 Fetched ${insts.length} inst_relate records.`);

        const endTimeFetch = performance.now();
        console.log(` ⏱️  Fetching took: ${((endTimeFetch - startTimeFetch) / 1000).toFixed(2)}s`);

        // 4. Sync to Local
        console.log(`[4/5] Syncing to local IndexedDB...`);
        const startTimeSync = performance.now();

        // Transactional insertion (SurrealDB 3.0 supports transactions via query or special syntax)
        // We'll use a simple batching approach for benchmark
        const batchSize = 100;

        // Sync PE
        console.log(`  -> Syncing PE...`);
        for (let i = 0; i < pes.length; i += batchSize) {
            const batch = pes.slice(i, i + batchSize);
            // We use CREATE to ensure they are written. 
            // In Surreal, CREATE with ID will fail if exists, but we deleted them above.
            // Alternatively use RELATE or UPSERT if available
            await Promise.all(batch.map(p => local.create(p.id, p)));
        }

        // Sync InstRelate
        console.log(`  -> Syncing InstRelate...`);
        for (let i = 0; i < insts.length; i += batchSize) {
            const batch = insts.slice(i, i + batchSize);
            await Promise.all(batch.map(ins => local.create(ins.id, ins)));
        }

        const endTimeSync = performance.now();
        const syncDuration = (endTimeSync - startTimeSync) / 1000;
        const totalRecords = pes.length + insts.length;

        console.log(` ⏱️  Syncing took: ${syncDuration.toFixed(2)}s`);
        console.log(` 📈 Speed: ${(totalRecords / syncDuration).toFixed(2)} records/s`);

        // 5. Verification Query from Local
        console.log(`[5/5] Verifying local data...`);
        const verifyResult = await local.query<any>(`SELECT count() FROM pe WHERE dbnum = ${DBNUM} GROUP ALL`);
        const count = (verifyResult[0] as any[])[0]?.count || 0;
        console.log(` ✅ Local count for dbnum ${DBNUM}: ${count}`);

        console.log(`\n🎉 Benchmark Completed Successfully!`);

    } catch (err) {
        console.error(`\n❌ Benchmark Failed:`, err);
    } finally {
        await remote.close();
        await local.close();
        process.exit(0);
    }
}

runBenchmark();
