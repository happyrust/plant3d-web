import { readFileSync } from 'node:fs';
import path from 'node:path';

const DEFAULT_FIXTURE = 'e2e/fixtures/mbd-branch-corpus.json';

function readArgs(argv) {
  const args = {
    fixture: DEFAULT_FIXTURE,
    project: null,
    priority: null,
    format: 'env',
    includeExpectedLengths: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index] ?? '';
    if (arg === '--fixture') args.fixture = next();
    else if (arg === '--project') args.project = next();
    else if (arg === '--priority') args.priority = next();
    else if (arg === '--format') args.format = next();
    else if (arg === '--include-expected-lengths') args.includeExpectedLengths = true;
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!['env', 'json', 'refs'].includes(args.format)) {
    throw new Error(`Unsupported --format ${args.format}`);
  }
  return args;
}

function printHelp() {
  console.log(`Usage:
  node e2e/helpers/mbdPrintBranchCorpus.mjs [options]

Options:
  --fixture <file>                 Corpus JSON path. Default: ${DEFAULT_FIXTURE}
  --project <name>                 Filter samples by output_project.
  --priority <smoke|regression>    Filter samples by priority.
  --format <env|json|refs>         Output shell env, JSON, or comma refs. Default: env.
  --include-expected-lengths       Emit MBD_REAL_EXPECTED_LENGTHS when all selected samples share known lengths.
`);
}

function loadCorpus(file) {
  const abs = path.resolve(file);
  const corpus = JSON.parse(readFileSync(abs, 'utf8'));
  if (!Array.isArray(corpus.samples)) {
    throw new Error(`Invalid corpus file, missing samples: ${abs}`);
  }
  return corpus;
}

function normalizeSample(sample) {
  const refno = String(sample?.refno ?? '').trim().replace(/[\\/]/g, '_');
  if (!refno) return null;
  return {
    ...sample,
    backendUrl: String(sample?.backendUrl ?? '').trim(),
    dbno: Number.isFinite(Number(sample?.dbno)) && Number(sample?.dbno) > 0
      ? Number(sample.dbno)
      : undefined,
    refno,
    project: String(sample?.project ?? '').trim(),
    priority: String(sample?.priority ?? '').trim(),
    expectedLengthTexts: Array.isArray(sample?.expectedLengthTexts)
      ? sample.expectedLengthTexts.map((item) => String(item).trim()).filter(Boolean)
      : [],
  };
}

function selectSamples(corpus, args) {
  return corpus.samples
    .map(normalizeSample)
    .filter(Boolean)
    .filter((sample) => !args.project || sample.project === args.project)
    .filter((sample) => !args.priority || sample.priority === args.priority);
}

function quotePowerShell(value) {
  return String(value).replace(/'/g, '\'\'');
}

function uniqueNonEmpty(values) {
  return Array.from(new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean)));
}

function resolveBackendUrl(corpus, samples) {
  const explicit = uniqueNonEmpty(samples.map((sample) => sample.backendUrl));
  if (explicit.length === 1) return explicit[0];

  const projects = uniqueNonEmpty(samples.map((sample) => sample.project));
  if (
    projects.length === 1 &&
    projects[0] === String(corpus.defaults?.marineProject ?? '').trim() &&
    corpus.defaults?.marineBackendUrl
  ) {
    return String(corpus.defaults.marineBackendUrl).trim();
  }

  if (
    projects.length === 1 &&
    projects[0] === String(corpus.defaults?.multiBranchProject ?? '').trim() &&
    corpus.defaults?.multiBranchBackendUrl
  ) {
    return String(corpus.defaults.multiBranchBackendUrl).trim();
  }

  return String(corpus.defaults?.backendUrl ?? '').trim();
}

function emitEnv(corpus, samples, args) {
  const firstProject = samples[0]?.project ?? corpus.defaults?.primaryProject ?? '';
  const backendUrl = resolveBackendUrl(corpus, samples);
  const refs = samples.map((sample) => sample.refno).join(',');
  if (backendUrl) {
    console.log(`$env:MBD_REAL_BACKEND_URL='${quotePowerShell(backendUrl)}'`);
  }
  console.log(`$env:MBD_REAL_OUTPUT_PROJECT='${quotePowerShell(firstProject)}'`);
  console.log(`$env:MBD_REAL_REFNOS='${quotePowerShell(refs)}'`);
  if (samples.length === 1) {
    console.log(`$env:MBD_REAL_REFNO='${quotePowerShell(samples[0].refno)}'`);
    if (samples[0].dbno) {
      console.log(`$env:MBD_REAL_SHOW_DBNUM='${quotePowerShell(samples[0].dbno)}'`);
    }
  }
  if (args.includeExpectedLengths) {
    const expected = samples
      .map((sample) => sample.expectedLengthTexts.join(','))
      .filter(Boolean);
    if (expected.length === 1 && samples.length === 1) {
      console.log(`$env:MBD_REAL_EXPECTED_LENGTHS='${quotePowerShell(expected[0])}'`);
    }
  }
}

const args = readArgs(process.argv.slice(2));
const corpus = loadCorpus(args.fixture);
const samples = selectSamples(corpus, args);

if (samples.length === 0) {
  throw new Error('No corpus samples matched the requested filters.');
}

if (args.format === 'json') {
  console.log(JSON.stringify({ ...corpus, samples }, null, 2));
} else if (args.format === 'refs') {
  console.log(samples.map((sample) => sample.refno).join(','));
} else {
  emitEnv(corpus, samples, args);
}
