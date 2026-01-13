
<script setup lang="ts">
import { ref } from 'vue';
import { Surreal } from 'surrealdb';

const remoteUrl = ref('ws://localhost:8020');
const localDbUrl = ref('indxdb://SurrealDB_Benchmark');
const dbnum = ref(1112);
const logs = ref<string[]>([]);
const isRunning = ref(false);

const appendLog = (msg: string) => {
  const time = new Date().toLocaleTimeString();
  logs.value.push(`[${time}] ${msg}`);
  console.log(`[Benchmark] ${msg}`);
};

async function runBenchmark() {
  if (isRunning.value) return;
  isRunning.value = true;
  logs.value = [];
  
  appendLog(`🚀 Starting SurrealDB Sync Benchmark`);
  appendLog(`Remote: ${remoteUrl.value}`);
  appendLog(`Local:  ${localDbUrl.value}`);
  appendLog(`DBNum:  ${dbnum.value}`);

  const remote = new Surreal();
  const local = new Surreal();

  try {
    // 1. Connect
    appendLog(`[1/5] Connecting to databases...`);
    await remote.connect(remoteUrl.value);
    await remote.signin({ username: 'root', password: 'root' });
    await remote.use({ namespace: '1516', database: 'AvevaMarineSample' });
    appendLog(` ✅ Remote connected.`);

    await local.connect(localDbUrl.value);
    await local.use({ namespace: '1516', database: 'AvevaMarineSample' });
    appendLog(` ✅ Local (IndexedDB) connected.`);

    // 2. Clear Local Data
    appendLog(`[2/5] Cleaning local data for dbnum ${dbnum.value}...`);
    await local.query(`DELETE pe WHERE dbnum = ${dbnum.value}`);
    appendLog(` ✅ Local clean-up done.`);

    // 3. Fetch Data from Remote
    appendLog(`[3/5] Fetching data from remote...`);
    const startTimeFetch = performance.now();
    
    // Fetch PE
    const peResult = await remote.query<any>(`SELECT * FROM pe WHERE dbnum = ${dbnum.value}`);
    const pes = peResult[0] as any[];
    appendLog(` 📦 Fetched ${pes.length} pe records.`);

    // Fetch InstRelate
    const refnos = pes.map(p => p.id);
    const instRelateResult = await remote.query<any>(`SELECT * FROM inst_relate WHERE id IN $ids`, { ids: refnos });
    const insts = instRelateResult[0] as any[];
    appendLog(` 📦 Fetched ${insts.length} inst_relate records.`);

    const endTimeFetch = performance.now();
    appendLog(` ⏱️  Fetching took: ${((endTimeFetch - startTimeFetch) / 1000).toFixed(2)}s`);

    // 4. Sync to Local
    appendLog(`[4/5] Syncing to local IndexedDB...`);
    const startTimeSync = performance.now();

    const batchSize = 100;
    
    // Sync PE
    appendLog(`  -> Syncing PE...`);
    for (let i = 0; i < pes.length; i += batchSize) {
      const batch = pes.slice(i, i + batchSize);
      await Promise.all(batch.map(p => local.create(p.id, p)));
    }

    // Sync InstRelate
    appendLog(`  -> Syncing InstRelate...`);
    for (let i = 0; i < insts.length; i += batchSize) {
      const batch = insts.slice(i, i + batchSize);
      await Promise.all(batch.map(ins => local.create(ins.id, ins)));
    }

    const endTimeSync = performance.now();
    const syncDuration = (endTimeSync - startTimeSync) / 1000;
    const totalRecords = pes.length + insts.length;

    appendLog(` ⏱️  Syncing took: ${syncDuration.toFixed(2)}s`);
    appendLog(` 📈 Speed: ${(totalRecords / syncDuration).toFixed(2)} records/s`);

    // 5. Verification
    appendLog(`[5/5] Verifying local data...`);
    const verifyResult = await local.query<any>(`SELECT count() FROM pe WHERE dbnum = ${dbnum.value} GROUP ALL`);
    const count = (verifyResult[0] as any[])[0]?.count || 0;
    appendLog(` ✅ Local count for dbnum ${dbnum.value}: ${count}`);

    appendLog(`\n🎉 Benchmark Completed Successfully!`);

  } catch (err) {
    appendLog(`❌ Error: ${err instanceof Error ? err.message : String(err)}`);
    console.error(err);
  } finally {
    await remote.close();
    await local.close();
    isRunning.value = false;
  }
}
</script>

<template>
  <div class="benchmark-container">
    <div class="header">
      <h2>SurrealDB IndexedDB Benchmark</h2>
      <button :disabled="isRunning" @click="runBenchmark">
        {{ isRunning ? 'Running...' : 'Start Benchmark' }}
      </button>
    </div>

    <div class="config">
      <div class="field">
        <label>Remote URL:</label>
        <input v-model="remoteUrl" type="text" />
      </div>
      <div class="field">
        <label>DBNum:</label>
        <input v-model.number="dbnum" type="number" />
      </div>
    </div>

    <div class="logs-panel">
      <div v-for="(log, i) in logs" :key="i" class="log-line">{{ log }}</div>
    </div>
  </div>
</template>

<style scoped>
.benchmark-container {
  padding: 20px;
  background: #1e1e1e;
  color: #d4d4d4;
  font-family: monospace;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid #333;
  padding-bottom: 10px;
}

.config {
  margin: 15px 0;
  display: flex;
  gap: 20px;
}

.field {
  display: flex;
  align-items: center;
  gap: 10px;
}

input {
  background: #333;
  border: 1px solid #444;
  color: #fff;
  padding: 4px 8px;
}

button {
  background: #007acc;
  color: white;
  border: none;
  padding: 8px 16px;
  cursor: pointer;
}

button:disabled {
  background: #444;
  cursor: not-allowed;
}

.logs-panel {
  flex: 1;
  background: #000;
  border-radius: 4px;
  padding: 10px;
  overflow-y: auto;
  border: 1px solid #333;
}

.log-line {
  white-space: pre-wrap;
  margin-bottom: 4px;
  line-height: 1.4;
}
</style>
