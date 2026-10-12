// Browser smoke test (Playwright + Chromium):  node tests/e2e.js [outDir]
// Opens index.html from disk at phone size, loads a random position, solves it,
// plays a few moves and saves screenshots.  Fails on any page error.
'use strict';
var path = require('path');
var fs = require('fs');
var playwright;
try { playwright = require('playwright'); } catch (e) { playwright = require(path.join(process.execPath, '../../lib/node_modules/playwright')); }

var root = path.resolve(__dirname, '..');
var out = process.argv[2] || path.join(root, 'tests', 'screenshots');
fs.mkdirSync(out, { recursive: true });

(async function () {
  var browser = await playwright.chromium.launch();
  var errors = [];
  async function run(file, viewport, prefix) {
    var page = await browser.newPage({ viewport: viewport, deviceScaleFactor: 2 });
    page.on('pageerror', function (e) { errors.push(prefix + ': ' + e.message); });
    page.on('console', function (m) { if (m.type() === 'error') errors.push(prefix + ' console: ' + m.text()); });
    await page.goto('file://' + path.join(root, file));
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(out, prefix + '-1-hold.png'), fullPage: true });
    await page.click('#btn-example');
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(out, prefix + '-2-visible.png'), fullPage: true });
    await page.click('#btn-next-step');           // -> M2 reveal
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(out, prefix + '-3-reveal.png'), fullPage: true });
    await page.click('#input-steps li:last-child'); // -> check
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(out, prefix + '-4-check.png'), fullPage: true });
    await page.click('#btn-next-step');           // solve
    await page.waitForTimeout(400);
    for (var i = 0; i < 3; i++) { await page.click('#btn-fwd'); await page.waitForTimeout(700); }
    await page.screenshot({ path: path.join(out, prefix + '-5-solution.png'), fullPage: true });
    var progress = await page.textContent('#move-progress');
    if (!/ход 4 из/.test(progress)) errors.push(prefix + ': unexpected progress "' + progress + '"');
    await page.click('#btn-last');
    await page.waitForTimeout(300);
    var big = await page.textContent('#move-big');
    if (big.indexOf('Готово') < 0) errors.push(prefix + ': not solved at the end: ' + big);
    await page.click('.tab[data-tab="sim"]');
    await page.waitForTimeout(200);
    await page.fill('#sim-alg', "Rw U Rw' U'");
    await page.click('#btn-sim-run');
    await page.waitForTimeout(1600);
    await page.screenshot({ path: path.join(out, prefix + '-6-sim.png'), fullPage: true });
    await page.click('.tab[data-tab="shape"]');
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(out, prefix + '-7-shape.png'), fullPage: true });
    await page.click('.tab[data-tab="help"]');
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(out, prefix + '-8-help.png'), fullPage: true });
    await page.close();
  }
  await run('index.html', { width: 390, height: 844 }, 'phone');
  await run('index.html', { width: 1280, height: 900 }, 'desktop');
  if (fs.existsSync(path.join(root, 'puppet-solver.html'))) await run('puppet-solver.html', { width: 390, height: 844 }, 'single');
  await browser.close();
  if (errors.length) { console.log('ERRORS:\n' + errors.join('\n')); process.exit(1); }
  console.log('e2e ok, screenshots in', out);
})().catch(function (e) { console.error(e); process.exit(1); });
