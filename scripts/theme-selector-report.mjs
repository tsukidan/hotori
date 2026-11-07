import fs from 'node:fs';
import path from 'node:path';

// Read-only suggestions. Matching source classes does not prove DOM equivalence.
function readArgs(args) {
  const opts = { baseline: [], current: [] };
  for (let i = 0; i < args.length; i++) {
    const key = args[i].replace(/^--/, '');
    if (!['theme', 'baseline', 'current', 'out'].includes(key) || !args[i + 1] || args[i + 1].startsWith('--')) {
      throw new Error('Usage: node scripts/theme-selector-report.mjs --theme file.css --baseline old.css|json --current new.css|json [--out report.json]');
    }
    const value = args[++i];
    if (Array.isArray(opts[key])) opts[key].push(value);
    else if (opts[key]) throw new Error(`Duplicate --${key}`);
    else opts[key] = value;
  }
  if (!opts.theme || !opts.baseline.length || !opts.current.length) throw new Error('Provide --theme, --baseline and --current. Snapshot options may be repeated.');
  return opts;
}
function readStyles(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  if (!text.trimStart().startsWith('[')) return text;
  const data = JSON.parse(text);
  if (!Array.isArray(data) || !data.length || data.some(item => typeof item.css !== 'string')) {
    throw new Error(`Expected a nonempty array of {css: string} entries: ${file}`);
  }
  return data.map(item => item.css).join('\n');
}
function splitClass(name) {
  const match = name.match(/^(.+?)(_{1,2}[a-f0-9]{5,6})$/) || name.match(/^(.+?)(_[A-Za-z0-9_-]{6})$/);
  return match ? { base: match[1], suffix: match[2] } : null;
}
function collect(text) {
  const classes = new Map();
  const groups = new Map();
  for (const match of text.matchAll(/\.([A-Za-z][A-Za-z0-9_-]*)/g)) {
    const name = match[1];
    const parts = splitClass(name);
    if (!parts) continue;
    classes.set(name, parts);
    if (!groups.has(parts.suffix)) groups.set(parts.suffix, new Set());
    if (!/^(fontScaling|eyebrow|code|display-sm|display-md|display-lg)$/.test(parts.base)) {
      groups.get(parts.suffix).add(parts.base);
    }
  }
  return { classes, groups };
}
function main() {
  const opts = readArgs(process.argv.slice(2));
  const inputs = [opts.theme, ...opts.baseline, ...opts.current].map(file => path.resolve(file));
  if (opts.out && inputs.includes(path.resolve(opts.out))) throw new Error('Output must not overwrite an input file.');
  const baseline = collect(opts.baseline.map(readStyles).join('\n'));
  const current = collect(opts.current.map(readStyles).join('\n'));
  const theme = collect(fs.readFileSync(opts.theme, 'utf8'));
  if (!baseline.classes.size || !current.classes.size) throw new Error('No recognized generated classes in one snapshot; inspect the naming format before continuing.');
  const frequency = new Map();
  for (const names of current.groups.values()) for (const name of names) frequency.set(name, (frequency.get(name) || 0) + 1);
  const weight = name => Math.log(1 + current.groups.size / (frequency.get(name) || 1));
  const sum = names => [...names].reduce((total, name) => total + weight(name), 0);
  const moduleCache = new Map();
  const results = [];
  for (const [name, parts] of theme.classes) {
    if (current.classes.has(name)) {
      results.push({ name, status: 'present' });
      continue;
    }
    if (!baseline.classes.has(name)) {
      results.push({ name, status: 'not-in-baseline' });
      continue;
    }
    if (!moduleCache.has(parts.suffix)) {
      const oldNames = baseline.groups.get(parts.suffix);
      const oldWeight = sum(oldNames);
      const ranked = [];
      for (const [suffix, names] of current.groups) {
        const overlap = new Set([...oldNames].filter(member => names.has(member)));
        if (!overlap.size) continue;
        const shared = sum(overlap);
        const total = oldWeight + sum(names) - shared;
        ranked.push({ suffix, score: total ? shared / total : 0, coverage: oldWeight ? shared / oldWeight : 0, overlap: overlap.size });
      }
      ranked.sort((a, b) => b.score - a.score);
      moduleCache.set(parts.suffix, ranked);
    }
    const ranked = moduleCache.get(parts.suffix);
    const best = ranked[0];
    const candidate = best ? parts.base + best.suffix : null;
    const confident = best && best.score >= 0.74 && best.coverage >= 0.85 && best.score - (ranked[1]?.score || 0) > 0.1 && current.classes.has(candidate);
    results.push({ name, status: confident ? 'candidate-review-required' : 'unresolved', candidate: confident ? candidate : null, alternatives: ranked.slice(0, 3).map(item => ({ ...item, className: parts.base + item.suffix, classPresent: current.classes.has(parts.base + item.suffix) })) });
  }
  const report = {
    schemaVersion: 1,
    note: 'Read-only source-based suggestions. Review declarations and live DOM before applying. Unloaded routes and changed naming formats limit coverage.',
    inputs: { theme: opts.theme, baseline: opts.baseline, current: opts.current },
    counts: results.reduce((counts, item) => ({ ...counts, [item.status]: (counts[item.status] || 0) + 1 }), {}),
    results
  };
  const output = JSON.stringify(report, null, 2) + '\n';
  if (opts.out) fs.writeFileSync(opts.out, output);
  else process.stdout.write(output);
  process.stderr.write(JSON.stringify(report.counts) + '\n');
}
try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
