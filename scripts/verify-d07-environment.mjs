import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const candidates = [
  process.env.REVIEW_WORD_CONVERTER,
  process.env.SOFFICE_PATH,
  'soffice',
  'C:/Program Files/LibreOffice/program/soffice.exe',
  'C:/Program Files (x86)/LibreOffice/program/soffice.exe',
].filter(Boolean);

const result = {
  checkedAt: new Date().toISOString(),
  converter: { configured: process.env.REVIEW_WORD_CONVERTER ?? null, found: null },
  tempDirectory: { path: os.tmpdir(), writable: false },
  limits: {
    maxBytes: process.env.REVIEW_MAX_FILE_BYTES ?? '52428800',
    timeoutMs: process.env.REVIEW_CONVERSION_TIMEOUT_MS ?? '45000',
    concurrency: process.env.REVIEW_CONVERSION_CONCURRENCY ?? '2',
  },
  samples: ['PDF', 'DOCX', 'DOC', 'corrupt', 'encrypted', 'timeout', 'oversized'],
  blockers: [],
};

for (const candidate of candidates) {
  if (candidate === 'soffice') {
    try {
      result.converter.found = execFileSync(process.platform === 'win32' ? 'where' : 'which', ['soffice'], { encoding: 'utf8' }).trim().split(/\r?\n/)[0];
      if (result.converter.found) break;
    } catch {}
    continue;
  }
  try {
    await fs.access(candidate);
    result.converter.found = candidate;
    break;
  } catch {}
}
if (!result.converter.found && process.env.REVIEW_WORD_CONVERTER) {
  result.blockers.push('REVIEW_WORD_CONVERTER points to a missing file');
}
if (!result.converter.found) result.blockers.push('LibreOffice/soffice converter was not found');

const probe = path.join(os.tmpdir(), `plant3d-d07-${process.pid}-${Date.now()}.tmp`);
try {
  await fs.writeFile(probe, 'd07-write-probe');
  await fs.rm(probe, { force: true });
  result.tempDirectory.writable = true;
} catch (error) {
  result.blockers.push(`temporary directory is not writable: ${error.message}`);
}

for (const [key, value] of Object.entries(result.limits)) {
  if (!/^\d+$/.test(String(value)) || Number(value) <= 0) result.blockers.push(`${key} must be a positive integer`);
}
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.blockers.length ? 2 : 0;
