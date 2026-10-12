// Exercises the actual Windows helper against disposable EXE copies, then starts the real new app.
// Run scripts/sign-release.py sign first. No network update is published or installed on the user's copy.
const { chromium } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const net = require('node:net');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, message, timeout = 45000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await delay(100); }
  throw new Error(message);
}
function run(command, args, options = {}) {
  const child = spawn(command, args, { windowsHide: true, ...options });
  const finished = new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', code => resolve(code)); });
  return { child, finished };
}

(async () => {
  const harness = path.join(root, 'target', 'qa', 'update-helper-harness');
  await fs.mkdir(harness, { recursive: true });
  const cargo = (await fs.readFile(path.join(root, 'Cargo.toml'), 'utf8'))
    .replaceAll('name = "hotori"', 'name = "hotori-update-harness"')
    .replace(/^version = "[^"]+"/m, 'version = "0.0.0"')
    .replace('build = "build.rs"', '')
    .replace('path = "src/main.rs"', 'path = "main.rs"');
  await fs.writeFile(path.join(harness, 'Cargo.toml'), cargo);
  await fs.copyFile(path.join(root, 'Cargo.lock'), path.join(harness, 'Cargo.lock'));
  const modulePath = path.join(root, 'src', 'app_updates.rs');
  await fs.writeFile(path.join(harness, 'main.rs'), `#![allow(dead_code)]\n#![windows_subsystem = "windows"]\n#[path = r"${modulePath}"] mod app_updates;\nfn main() { if !app_updates::helper_entry() { std::thread::sleep(std::time::Duration::from_secs(120)); } }\n`);
  console.log('Building an older-version helper harness for the isolated replacement test…');
  const build = run('cargo', ['build', '--release', '--offline', '--manifest-path', path.join(harness, 'Cargo.toml')], {
    cwd: root, env: { ...process.env, CARGO_TARGET_DIR: path.join(root, 'target') }, stdio: 'inherit'
  });
  assert.equal(await build.finished, 0);
  const sandbox = await fs.mkdtemp(path.join(root, 'target', 'qa', 'app-updater-'));
  const folder = path.join(sandbox, "portable app's folder");
  const appdata = path.join(sandbox, 'appdata');
  const themes = path.join(appdata, 'Vencord', 'themes');
  await fs.mkdir(folder, { recursive: true }); await fs.mkdir(themes, { recursive: true });
  const userTheme = '/* Personal theme must survive an app update. */';
  await fs.writeFile(path.join(themes, 'hotori.theme.css'), userTheme);
  await fs.mkdir(path.join(themes, 'hotori-assets'));
  await fs.writeFile(path.join(themes, 'hotori-assets', 'wallpaper.png'), 'wallpaper sentinel');
  const target = path.join(folder, 'Hotori portable.exe');
  const stage = path.join(folder, '.hotori-update-smoke');
  await fs.mkdir(stage);
  await fs.copyFile(path.join(root, 'target', 'release', 'hotori-update-harness.exe'), target);
  await fs.copyFile(target, path.join(stage, 'helper.exe'));
  for (const name of ['hotori.exe', 'hotori-update.json', 'hotori-update.json.sig']) {
    await fs.copyFile(path.join(root, 'target', 'release', name), path.join(stage, name));
  }
  const manifest = JSON.parse(await fs.readFile(path.join(stage, 'hotori-update.json'), 'utf8'));
  const server = net.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port; await new Promise(resolve => server.close(resolve));
  const env = { ...process.env, APPDATA: appdata, WEBVIEW2_USER_DATA_FOLDER: path.join(sandbox, 'webview'),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1` };
  const original = run(target, [], { env, cwd: folder });
  let helper, browser;
  try {
    await fs.writeFile(path.join(stage, 'plan.json'), JSON.stringify({ target: path.win32.toNamespacedPath(await fs.realpath(target)), parent_pid: original.child.pid, old_sha256: hash(await fs.readFile(target)) }));
    helper = run(path.join(stage, 'helper.exe'), ['--apply-app-update', stage], { env, cwd: folder });
    await until(async () => { try { await fs.access(path.join(stage, 'helper-ready')); return true; } catch { return false; } }, 'Helper did not validate the signed plan.');
    // Replacement must wait until the original process closes.
    assert.notEqual(hash(await fs.readFile(target)), manifest.sha256);
    original.child.kill(); await original.finished;
    await until(async () => { try { return hash(await fs.readFile(target)) === manifest.sha256; } catch { return false; } }, 'EXE was not replaced.');
    await until(async () => { try { return (await fetch(`http://127.0.0.1:${port}/json/version`)).ok; } catch { return false; } }, 'Updated app did not start.');
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    let page;
    await until(async () => { page = browser.contexts()[0].pages().find(p => p.url().includes('tauri.localhost')); return !!page; }, 'Updated app page did not load.');
    await page.waitForSelector('.version');
    assert.equal(await page.locator('.version').textContent(), `v${manifest.version}`);
    assert.equal(await helper.finished, 0);
    assert.equal(await fs.readFile(path.join(themes, 'hotori.theme.css'), 'utf8'), userTheme);
    assert.equal(await fs.readFile(path.join(themes, 'hotori-assets', 'wallpaper.png'), 'utf8'), 'wallpaper sentinel');
    await until(async () => { try { await fs.access(stage); return false; } catch { return true; } }, 'Updater files were not cleaned up.');
    await page.screenshot({ path: path.join(root, 'target', 'qa', 'app-update-restarted.png') });
    await page.locator('#window-close').click();
    console.log(`PASS: signed update installed Hotori ${manifest.version}, waited for the old process, restarted the real app, preserved theme files, and cleaned up its helper.`);
  } finally {
    original.child.kill(); if (helper) helper.child.kill(); if (browser) await browser.close().catch(() => {});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
