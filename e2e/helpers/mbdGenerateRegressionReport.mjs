import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const DEFAULT_SCREENSHOT_DIR = 'e2e/screenshots';
const DEFAULT_HTML_OUT = 'tmp/mbd-regression-report.html';
const DEFAULT_JSON_OUT = 'tmp/mbd-regression-report.json';
const DEFAULT_MIN_PIPE_SPAN_PX = 180;

function readArgs(argv) {
  const args = {
    screenshotDir: DEFAULT_SCREENSHOT_DIR,
    htmlOut: DEFAULT_HTML_OUT,
    jsonOut: DEFAULT_JSON_OUT,
    refs: null,
    minPipeSpanPx: DEFAULT_MIN_PIPE_SPAN_PX,
    failOnViolation: true,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index] ?? '';
    if (arg === '--screenshots') args.screenshotDir = next();
    else if (arg === '--out') args.htmlOut = next();
    else if (arg === '--json') args.jsonOut = next();
    else if (arg === '--refs') {
      args.refs = next()
        .split(/[,;\s]+/)
        .map((value) => value.trim())
        .filter(Boolean)
        .map(normalizeRef);
    } else if (arg === '--min-pipe-span') {
      args.minPipeSpanPx = Number(next());
    } else if (arg === '--no-fail') {
      args.failOnViolation = false;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function printHelp() {
  console.log(`Usage:
  node e2e/helpers/mbdGenerateRegressionReport.mjs [options]

Options:
  --screenshots <dir>       Directory containing mbd-real-bran-*.json/png files.
  --refs <a,b,c>            Optional normalized refno filter.
  --out <file.html>         HTML report path. Default: ${DEFAULT_HTML_OUT}
  --json <file.json>        JSON report path. Default: ${DEFAULT_JSON_OUT}
  --min-pipe-span <px>      Minimum max visible pipe span. Default: ${DEFAULT_MIN_PIPE_SPAN_PX}
  --no-fail                Write report but exit 0 even if violations exist.
`);
}

function normalizeRef(value) {
  return String(value ?? '').trim().replace(/[\\/]/g, '_');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function readDiagnosticsFiles(screenshotDir, refFilter) {
  const absDir = path.resolve(screenshotDir);
  const refSet = refFilter ? new Set(refFilter) : null;
  return readdirSync(absDir)
    .filter((name) => /^mbd-real-bran-.+\.json$/i.test(name))
    .map((name) => path.join(absDir, name))
    .filter((file) => {
      if (!refSet) return true;
      const match = path.basename(file).match(/^mbd-real-bran-(.+)\.json$/i);
      return match ? refSet.has(normalizeRef(match[1])) : false;
    })
    .sort((a, b) => a.localeCompare(b));
}

function countArray(value) {
  return Array.isArray(value) ? value.length : 0;
}

function countNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function pipeVisualMaxSpan(snapshot) {
  const pipeKinds = new Set([
    'pipe-visual-body',
    'pipe-visual-ring',
    'pipe-visual-band',
    'pipe-visual-rail',
  ]);
  return Math.max(
    0,
    ...(snapshot.line_object_states ?? [])
      .filter((item) => item?.visible && pipeKinds.has(String(item.aux_kind ?? '')))
      .map((item) => countNumber(item.screen_span_px)),
  );
}

function summarizeDiagnostics(file, minPipeSpanPx) {
  const snapshot = JSON.parse(readFileSync(file, 'utf8'));
  const refno = normalizeRef(snapshot.normalized_refno ?? snapshot.refno ?? '');
  const screenshotPath = path.resolve(
    path.dirname(file),
    path.basename(String(snapshot.screenshot_path ?? file).replace(/\.json$/i, '.png')),
  );
  const dimensionLines = snapshot.pixel_summary?.dimension_lines ?? {};
  const pipePixels = snapshot.pixel_summary?.pipe ?? {};
  const maxPipeSpanPx = pipeVisualMaxSpan(snapshot);
  const row = {
    refno,
    output_project: snapshot.output_project ?? null,
    drawing_preset: snapshot.drawing_preset === true,
    screenshot_path: existsSync(screenshotPath) ? screenshotPath : null,
    generated_at: snapshot.generated_at ?? null,
    rendered_counts: snapshot.rendered_counts ?? {},
    severe_screen_overlap_count: countNumber(snapshot.severe_screen_overlap_count),
    out_of_viewport_count: countArray(snapshot.out_of_viewport),
    screen_margin_violation_count: countArray(snapshot.screen_margin?.violations),
    leader_text_crossing_count: countNumber(snapshot.leader_text_crossing?.crossing_count),
    model_dimension_line_crossing_count:
      countNumber(snapshot.model_crossing?.dimension_main_lines?.crossing_count),
    model_leader_extension_crossing_count:
      countNumber(snapshot.model_crossing?.leader_extensions?.crossing_count),
    material_count: (snapshot.screen_items ?? [])
      .filter((item) => String(item.id ?? '').startsWith('tag:material:'))
      .length,
    pipe_visual_max_span_px: Number(maxPipeSpanPx.toFixed(1)),
    main_red_pixels: countNumber(dimensionLines.main_red_pixels),
    min_main_red_pixels: countNumber(dimensionLines.min_main_red_pixels),
    extension_red_pixels: countNumber(dimensionLines.extension_red_pixels),
    min_extension_red_pixels: countNumber(dimensionLines.min_extension_red_pixels),
    pipe_blue_pixels: countNumber(pipePixels.total_blue_pixels),
    min_pipe_blue_pixels: countNumber(pipePixels.min_total_blue_pixels),
    violations: [],
  };

  if (row.severe_screen_overlap_count > 0) {
    row.violations.push(`severe overlap=${row.severe_screen_overlap_count}`);
  }
  if (row.out_of_viewport_count > 0) {
    row.violations.push(`out of viewport=${row.out_of_viewport_count}`);
  }
  if (row.screen_margin_violation_count > 0) {
    row.violations.push(`screen margin=${row.screen_margin_violation_count}`);
  }
  if (row.leader_text_crossing_count > 0) {
    row.violations.push(`leader/text crossing=${row.leader_text_crossing_count}`);
  }
  if (row.model_dimension_line_crossing_count > 0) {
    row.violations.push(`dimension/model crossing=${row.model_dimension_line_crossing_count}`);
  }
  if (row.model_leader_extension_crossing_count > 0) {
    row.violations.push(`leader/model crossing=${row.model_leader_extension_crossing_count}`);
  }
  if (row.pipe_visual_max_span_px < minPipeSpanPx) {
    row.violations.push(`pipe span ${row.pipe_visual_max_span_px}px < ${minPipeSpanPx}px`);
  }
  if (row.min_main_red_pixels > 0 && row.main_red_pixels < row.min_main_red_pixels) {
    row.violations.push(`main red ${row.main_red_pixels} < ${row.min_main_red_pixels}`);
  }
  if (
    row.min_extension_red_pixels > 0 &&
    row.extension_red_pixels < row.min_extension_red_pixels
  ) {
    row.violations.push(
      `extension red ${row.extension_red_pixels} < ${row.min_extension_red_pixels}`,
    );
  }
  if (row.min_pipe_blue_pixels > 0 && row.pipe_blue_pixels < row.min_pipe_blue_pixels) {
    row.violations.push(`pipe blue ${row.pipe_blue_pixels} < ${row.min_pipe_blue_pixels}`);
  }
  return row;
}

function ratioText(actual, min) {
  if (!Number.isFinite(actual) || !Number.isFinite(min) || min <= 0) return '-';
  return `${actual} / ${min} (${(actual / min).toFixed(1)}x)`;
}

function writeReport(rows, htmlOut, jsonOut, minPipeSpanPx) {
  const absHtml = path.resolve(htmlOut);
  const absJson = path.resolve(jsonOut);
  mkdirSync(path.dirname(absHtml), { recursive: true });
  mkdirSync(path.dirname(absJson), { recursive: true });
  const summary = {
    generated_at: new Date().toISOString(),
    sample_count: rows.length,
    passing_count: rows.filter((row) => row.violations.length === 0).length,
    failing_count: rows.filter((row) => row.violations.length > 0).length,
    min_pipe_span_px: minPipeSpanPx,
    rows,
  };
  writeFileSync(absJson, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

  const cards = rows.map((row) => {
    const imgSrc = row.screenshot_path
      ? path.relative(path.dirname(absHtml), row.screenshot_path).replace(/\\/g, '/')
      : '';
    const status = row.violations.length === 0 ? 'PASS' : 'FAIL';
    const statusClass = row.violations.length === 0 ? 'pass' : 'fail';
    const counts = row.rendered_counts ?? {};
    return `<article class="card ${statusClass}">
      <header>
        <strong>${escapeHtml(row.refno)}</strong>
        <span>${status}</span>
      </header>
      ${imgSrc ? `<img src="${escapeHtml(imgSrc)}" alt="${escapeHtml(row.refno)} screenshot">` : '<div class="missing">missing screenshot</div>'}
      <dl>
        <dt>Project</dt><dd>${escapeHtml(row.output_project ?? '-')}</dd>
        <dt>Dims / Tags / Materials</dt><dd>${countNumber(counts.dims)} / ${countNumber(counts.tags)} / ${row.material_count}</dd>
        <dt>Crossings</dt><dd>${row.leader_text_crossing_count + row.model_dimension_line_crossing_count + row.model_leader_extension_crossing_count}</dd>
        <dt>Pipe span</dt><dd>${row.pipe_visual_max_span_px}px</dd>
        <dt>Main red</dt><dd>${ratioText(row.main_red_pixels, row.min_main_red_pixels)}</dd>
        <dt>Extension red</dt><dd>${ratioText(row.extension_red_pixels, row.min_extension_red_pixels)}</dd>
        <dt>Pipe blue</dt><dd>${ratioText(row.pipe_blue_pixels, row.min_pipe_blue_pixels)}</dd>
      </dl>
      ${row.violations.length > 0 ? `<p class="violations">${escapeHtml(row.violations.join('; '))}</p>` : ''}
    </article>`;
  }).join('\n');

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>MBD BRAN Regression Report</title>
  <style>
    body { margin: 24px; font-family: Arial, sans-serif; background: #f5f5f5; color: #111; }
    h1 { margin: 0 0 8px; font-size: 22px; }
    .summary { margin: 0 0 18px; color: #444; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 16px; }
    .card { background: #fff; border: 1px solid #ddd; border-radius: 6px; padding: 12px; }
    .card.pass { border-color: #86b78a; }
    .card.fail { border-color: #d75b5b; }
    header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    header span { font-size: 12px; font-weight: 700; }
    .pass header span { color: #247a2e; }
    .fail header span { color: #b32121; }
    img { width: 100%; background: #eee; border: 1px solid #ddd; display: block; }
    dl { display: grid; grid-template-columns: 145px 1fr; gap: 4px 10px; font-size: 12px; margin: 10px 0 0; }
    dt { color: #555; }
    dd { margin: 0; font-family: Consolas, monospace; }
    .violations { color: #9b1c1c; font-size: 12px; margin: 10px 0 0; }
    .missing { height: 180px; display: grid; place-items: center; background: #eee; color: #777; }
  </style>
</head>
<body>
  <h1>MBD BRAN Regression Report</h1>
  <p class="summary">Generated ${escapeHtml(summary.generated_at)}. Samples: ${summary.sample_count}. Passing: ${summary.passing_count}. Failing: ${summary.failing_count}. Min pipe span: ${minPipeSpanPx}px.</p>
  <section class="grid">
    ${cards}
  </section>
</body>
</html>
`;
  writeFileSync(absHtml, html, 'utf8');
  return summary;
}

try {
  const args = readArgs(process.argv.slice(2));
  const files = readDiagnosticsFiles(args.screenshotDir, args.refs);
  if (files.length === 0) {
    throw new Error(`No mbd-real-bran diagnostics found in ${args.screenshotDir}`);
  }
  const rows = files.map((file) => summarizeDiagnostics(file, args.minPipeSpanPx));
  const summary = writeReport(rows, args.htmlOut, args.jsonOut, args.minPipeSpanPx);
  console.log(JSON.stringify({
    html: path.resolve(args.htmlOut),
    json: path.resolve(args.jsonOut),
    sample_count: summary.sample_count,
    passing_count: summary.passing_count,
    failing_count: summary.failing_count,
  }, null, 2));
  if (args.failOnViolation && summary.failing_count > 0) {
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
