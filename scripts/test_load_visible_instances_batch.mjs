// 批量测试：visible-insts + instances_{dbno}.json (+ glb 可访问性) 链路校验（不依赖 WebGL）
//
// 前置：确保后端 /api 与 /files 可访问（例如 web_server 跑在 8080）
//
// 用法：
//  1) 直接传参：
//     VITE_GEN_MODEL_API_BASE_URL=http://localhost:8080 node scripts/test_load_visible_instances_batch.mjs 17496_106028 24383_73962
//
//  2) 用环境变量（逗号/空白分隔均可）：
//     REFNOS="17496_106028,24383_84631 17496_123351" node scripts/test_load_visible_instances_batch.mjs
//
// 可选参数：
//   LOD=L1
//   MAX_REFNOS=200          # 每个 root refno 最多抽样多少个 visible refnos 做 instances 命中校验
//   CHECK_GLB=1             # 抽检 glb 可访问性（会发起 HEAD/GET）
//   OUT=artifacts/report.json

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const API_BASE = (process.env.VITE_GEN_MODEL_API_BASE_URL || 'http://localhost:8080').replace(/\/$/, '')
const LOD = process.env.LOD || 'L1'
const MAX_REFNOS = Number(process.env.MAX_REFNOS || '200')
const CHECK_GLB = process.env.CHECK_GLB === '1'

function mustOk(cond, msg) {
  if (!cond) throw new Error(msg)
}

function parseDbno(refno) {
  const s = String(refno)
  const idx = s.indexOf('_')
  mustOk(idx > 0, `非法 refno（无法解析 dbno）: ${s}`)
  const dbno = Number(s.slice(0, idx))
  mustOk(Number.isFinite(dbno) && dbno > 0, `非法 dbno: ${s.slice(0, idx)}`)
  return dbno
}

function buildInstanceIndexByRefno(instancesManifest) {
  const index = new Map()
  const groups = []
    .concat(instancesManifest?.ungrouped || [])
    .concat(instancesManifest?.bran_groups || [])
    .concat(instancesManifest?.equi_groups || [])

  for (const row of groups) {
    const refno = String(row.refno || '')
    if (!refno) continue
    const list = index.get(refno) || []
    list.push(row)
    index.set(refno, list)
  }
  return index
}

async function fetchJson(url) {
  const resp = await fetch(url)
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`HTTP ${resp.status} ${resp.statusText}: ${url}\n${text}`)
  }
  return await resp.json()
}

async function headOrSmallGet(url) {
  const head = await fetch(url, { method: 'HEAD' }).catch(() => null)
  if (head && head.ok) return true
  if (head && head.status !== 405 && head.status !== 404) return false

  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 1500)
  try {
    const resp = await fetch(url, { signal: ac.signal })
    return resp.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

function parseRefnosFromEnvAndArgs() {
  const defaults = ['17496_106028', '24383_73962', '24383_84631', '17496_123351']
  const env = String(process.env.REFNOS || '')
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)

  const args = process.argv.slice(2).map((s) => String(s || '').trim()).filter(Boolean)
  const list = (args.length > 0 ? args : env.length > 0 ? env : defaults)
  return Array.from(new Set(list))
}

async function testOneRefno(refno) {
  const started = Date.now()
  const dbno = parseDbno(refno)

  const visibleUrl = `${API_BASE}/api/e3d/visible-insts/${encodeURIComponent(refno)}`
  const visible = await fetchJson(visibleUrl)
  mustOk(visible && visible.success === true, `[visible-insts] 失败: ${JSON.stringify(visible).slice(0, 300)}`)

  const visibleRefnos = Array.isArray(visible.refnos) ? visible.refnos.map(String) : []
  mustOk(visibleRefnos.length > 0, `[visible-insts] 返回空 refnos: ${JSON.stringify(visible).slice(0, 300)}`)

  const instUrl = `${API_BASE}/files/output/instances/instances_${dbno}.json`
  const manifest = await fetchJson(instUrl)
  mustOk(manifest && typeof manifest === 'object', `[instances] json 解析失败: ${instUrl}`)

  const index = buildInstanceIndexByRefno(manifest)
  mustOk(index.size > 0, `[instances] manifest 未包含任何 refno 记录: ${instUrl}`)

  const sampleCount = Math.max(1, Math.min(MAX_REFNOS, visibleRefnos.length))
  const sample = visibleRefnos.slice(0, sampleCount)

  const missing = []
  for (const r of sample) {
    if (!index.has(r)) missing.push(r)
  }
  mustOk(
    missing.length === 0,
    `[instances] 缺少可见 refno 记录: missing=${missing.length}/${sample.length}（示例=${missing.slice(0, 5).join(',')}）`
  )

  let glbChecked = 0
  let glbBad = 0
  const badGlbs = []

  if (CHECK_GLB) {
    const geoHashes = new Set()
    for (const r of sample.slice(0, 50)) {
      const rows = index.get(r) || []
      for (const row of rows) {
        const insts = row.instances || []
        for (const inst of insts) {
          if (inst && inst.geo_hash != null) geoHashes.add(String(inst.geo_hash))
        }
      }
    }
    const list = Array.from(geoHashes).slice(0, 20)
    glbChecked = list.length
    for (const h of list) {
      const glbUrl = `${API_BASE}/files/meshes/lod_${LOD}/${encodeURIComponent(h)}_${LOD}.glb`
      const ok = await headOrSmallGet(glbUrl)
      if (!ok) {
        glbBad++
        badGlbs.push(glbUrl)
      }
    }
    mustOk(glbBad === 0, `[glb] 抽检失败: bad=${glbBad}/${list.length}（示例=${badGlbs.slice(0, 3).join(',')}）`)
  }

  return {
    refno,
    dbno,
    visibleCount: visibleRefnos.length,
    sampleCount,
    glbChecked,
    glbBad,
    ms: Date.now() - started,
  }
}

async function main() {
  const refnos = parseRefnosFromEnvAndArgs()
  mustOk(refnos.length > 0, '未提供任何 refno')

  const results = []
  let okCount = 0
  let failCount = 0

  console.log(`[batch] API_BASE=${API_BASE}`)
  console.log(`[batch] LOD=${LOD} MAX_REFNOS=${MAX_REFNOS} CHECK_GLB=${CHECK_GLB ? 1 : 0}`)
  console.log(`[batch] refnos=${refnos.length} (${refnos.join(',')})`)

  for (const refno of refnos) {
    const started = Date.now()
    try {
      const r = await testOneRefno(refno)
      okCount++
      results.push({ ok: true, ...r })
      console.log(
        `[ok] ${refno} visible=${r.visibleCount} sample=${r.sampleCount} glb=${r.glbChecked > 0 ? `${r.glbChecked}/${r.glbChecked}` : '-'} ms=${r.ms}`
      )
    } catch (e) {
      failCount++
      const msg = e instanceof Error ? e.message : String(e)
      results.push({ ok: false, refno, error: msg, ms: Date.now() - started })
      console.error(`[fail] ${refno} ${msg}`)
    }
  }

  const out = process.env.OUT
    ? path.resolve(process.cwd(), process.env.OUT)
    : path.resolve(process.cwd(), 'artifacts', `visible_instances_batch_${Date.now()}.json`)
  const outDir = path.dirname(out)
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true })
  }
  writeFileSync(
    out,
    JSON.stringify(
      {
        apiBase: API_BASE,
        lod: LOD,
        maxRefnos: MAX_REFNOS,
        checkGlb: CHECK_GLB,
        ok: okCount,
        fail: failCount,
        results,
      },
      null,
      2
    )
  )

  console.log(`[batch] done ok=${okCount} fail=${failCount} report=${out}`)
  process.exit(failCount > 0 ? 1 : 0)
}

await main()

