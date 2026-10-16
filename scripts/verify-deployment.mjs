// Compile isolated artifacts to prove Pages environment flags do not accidentally
// noindex the selected production branch. Never deploys or touches dist/.
import { spawnSync } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { load } from 'cheerio';

const pkg = JSON.parse(await readFile('node_modules/astro/package.json', 'utf8'));
const bin = path.resolve('node_modules/astro', typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.astro);
const outDir = 'reports/deployment-test-artifact';
const productionBranch = process.env.PRODUCTION_BRANCH || spawnSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).stdout.trim();
if (!productionBranch) throw new Error('Set PRODUCTION_BRANCH to the existing Pages production branch');
async function htmlFiles(dir) {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...await htmlFiles(file));
    else if (file.endsWith('.html')) result.push(file);
  }
  return result;
}
const cases = [
  { name: 'existing-production-branch', env: { CF_PAGES_BRANCH: productionBranch, PRODUCTION_BRANCH: productionBranch, SITE_NOINDEX: 'false' }, noindex: 157 },
  { name: 'preview-branch', env: { CF_PAGES_BRANCH: 'verification-preview', PRODUCTION_BRANCH: productionBranch, SITE_NOINDEX: 'false' }, noindex: 280 },
  { name: 'explicit-preview-flag', env: { CF_PAGES_BRANCH: productionBranch, PRODUCTION_BRANCH: productionBranch, SITE_NOINDEX: 'true' }, noindex: 280 },
];
const results = [];
for (const test of cases) {
  const processResult = spawnSync(process.execPath, [bin, 'build', '--outDir', outDir], { env: { ...process.env, ...test.env }, encoding: 'utf8', timeout: 120000 });
  await writeFile(`reports/deployment-${test.name}.log`, processResult.stdout + processResult.stderr);
  if (processResult.status !== 0) throw new Error(`Isolated ${test.name} build failed; see its log`);
  const files = await htmlFiles(outDir);
  let noindex = 0;
  for (const file of files) {
    const $ = load(await readFile(file, 'utf8'));
    if (/noindex/i.test($('meta[name=robots]').attr('content') || '')) noindex++;
    if (!$('link[rel=canonical]').attr('href')?.startsWith('https://nicetrix.com/')) throw new Error('Preview canonical changed production origin');
  }
  const robots = await readFile(path.join(outDir, 'robots.txt'), 'utf8');
  const disallowsSite = robots.includes('Disallow: /\n');
  const passed = files.length === 280 && noindex === test.noindex && disallowsSite === (test.noindex === 280);
  results.push({ name: test.name, status: passed ? 'PASS' : 'FAIL', htmlPages: files.length, noindexPages: noindex, robotsDisallowsSite: disallowsSite });
  console.log(JSON.stringify(results.at(-1)));
}
await writeFile('reports/deployment-environment-verification.json', JSON.stringify({ status: results.every(r => r.status === 'PASS') ? 'PASS' : 'FAIL', productionBranch, cases: results, remoteDeployment: 'NOT RUN; no GitHub, DNS, hosting or Cloudflare account writes' }, null, 2) + '\n');
if (results.some(r => r.status !== 'PASS')) process.exitCode = 1;
