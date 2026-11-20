const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createRequire } = require('node:module');

const root = path.resolve(__dirname, '..');
const dependencyRoot = process.env.HOTORI_TEST_DEPENDENCIES;
const referencePath = process.env.HOTORI_RENDERER_REFERENCE;
const { chromium } = dependencyRoot
    ? createRequire(path.join(dependencyRoot, 'package.json'))('playwright')
    : require('playwright');

async function main() {
    const assets = new Map([
        ['/src/renderer.js', path.join(root, 'src/renderer.js')],
        ['/src/vendor/liquidglass-shaders.js', path.join(root, 'src/vendor/liquidglass-shaders.js')],
    ]);
    if (referencePath) assets.set('/reference.js', referencePath);

    const browser = await chromium.launch({ channel: 'msedge', headless: true });
    try {
        const page = await browser.newPage();
        await page.route('http://renderer.test/**', async route => {
            const pathname = new URL(route.request().url()).pathname;
            if (pathname === '/') {
                await route.fulfill({ contentType: 'text/html', body: '<!doctype html><body>' });
            } else if (assets.has(pathname)) {
                const body = await fs.readFile(assets.get(pathname));
                await route.fulfill({ contentType: 'text/javascript', body });
            } else {
                await route.fulfill({ status: 404 });
            }
        });
        await page.goto('http://renderer.test/');
        if (referencePath) await page.addScriptTag({ url: '/reference.js' });
        const proof = await page.evaluate(async () => {
            const { GlassRenderer, DEFAULTS, SHADOW_PAD } = await import('/src/renderer.js');
            const renderer = new GlassRenderer();
            const reference = window.HotoriLiquidGlass && new window.HotoriLiquidGlass.GlassRenderer();
            const source = document.createElement('canvas');
            source.width = 640;
            source.height = 480;
            const context = source.getContext('2d');
            for (let y = 0; y < source.height; y += 8) {
                for (let x = 0; x < source.width; x += 8) {
                    context.fillStyle = (x / 8 + y / 8) % 2 ? '#ddeeff' : '#492442';
                    context.fillRect(x, y, 8, 8);
                }
            }

            const config = {
                ...DEFAULTS, cornerRadius: 20, refraction: 1.2, zRadius: 60, chromAberration: .2, brightness: -.2,
            };
            const cases = [[240, 140, 1, .25], [97, 60, 2, .3], [45, 290, 1, .5], [30, 40, 1, 0], [220, 20, 1, .25]];
            const comparisons = [];
            const centerAlphas = [];
            for (const [panelWidth, panelHeight, dpr, blur] of cases) {
                const width = (panelWidth + 2 * SHADOW_PAD) * dpr;
                const height = (panelHeight + 2 * SHADOW_PAD) * dpr;
                const render = target => {
                    target.uploadAndBlur(source, 35, 25, width, height, blur);
                    target.clear();
                    target.renderGlassPanel(config, panelWidth, panelHeight, dpr);
                    const output = document.createElement('canvas');
                    output.width = width;
                    output.height = height;
                    const ctx = output.getContext('2d');
                    ctx.drawImage(target.canvas, 0, 0, width, height, 0, 0, width, height);
                    return ctx.getImageData(0, 0, width, height).data;
                };
                const actual = render(renderer);
                centerAlphas.push(actual[(Math.floor(height / 2) * width + Math.floor(width / 2)) * 4 + 3]);
                if (reference) {
                    const expected = render(reference);
                    let maxError = 0;
                    for (let i = 0; i < actual.length; i++) {
                        maxError = Math.max(maxError, Math.abs(actual[i] - expected[i]));
                    }
                    comparisons.push(maxError);
                }
            }
            // A rail abutting the viewport must not feed transparent black into
            // refraction. Check all crop edges, including all four corners.
            const solid = document.createElement('canvas'); solid.width = solid.height = 64;
            const solidCtx = solid.getContext('2d'); solidCtx.fillStyle='#80a0c0'; solidCtx.fillRect(0,0,64,64);
            for (const [x,y] of [[-20,-20],[44,-20],[-20,44],[44,44],[-100,0],[100,0]]) {
                renderer.uploadAndBlur(solid,x,y,108,104,.3);
                const crop = renderer.cropContext.getImageData(0,0,108,104).data;
                for (let i=0;i<crop.length;i+=4) {
                    if (crop[i]!==128 || crop[i+1]!==160 || crop[i+2]!==192 || crop[i+3]!==255)
                        throw new Error(`Wallpaper padding produced a dark/transparent sample at ${x},${y}`);
                }
            }
            renderer.destroy();
            reference?.destroy();

            const limited = new GlassRenderer({ framebufferBudgetBytes: 25_000 });
            limited.uploadAndBlur(source, 0, 0, 30, 30, 0);
            limited.uploadAndBlur(source, 0, 0, 40, 30, 0);
            const evicted = limited.getStats();

            let oversizedBlocked = false;
            try {
                limited.uploadAndBlur(source, 0, 0, 100, 100, 0);
            } catch (error) {
                oversizedBlocked = error instanceof RangeError;
            }
            const afterOversized = limited.getStats();

            limited.resize();
            const resized = limited.getStats();
            const gl = limited.gl;
            const checkFramebufferStatus = gl.checkFramebufferStatus;
            gl.checkFramebufferStatus = () => gl.FRAMEBUFFER_INCOMPLETE_ATTACHMENT;
            let incompleteBlocked = false;
            try {
                limited.uploadAndBlur(source, 0, 0, 25, 25, 0);
            } catch (error) {
                incompleteBlocked = error.message.includes('incomplete');
            } finally {
                gl.checkFramebufferStatus = checkFramebufferStatus;
            }
            const afterIncomplete = limited.getStats();

            limited.uploadAndBlur(source, 0, 0, 25, 25, 0);
            limited.destroy();
            limited.destroy();
            const destroyed = limited.getStats();
            return { centerAlphas, comparisons, evicted, oversizedBlocked, afterOversized, resized, incompleteBlocked, afterIncomplete, destroyed };
        });

        assert.deepEqual(proof.centerAlphas, [255, 255, 255, 255, 255]);
        if (referencePath) assert.deepEqual(proof.comparisons, [0, 0, 0, 0, 0]);
        assert.equal(proof.evicted.framebufferBytes, 40 * 30 * 12);
        assert.equal(proof.evicted.framebufferSets, 1);
        assert.equal(proof.evicted.evictions, 1);
        assert(proof.oversizedBlocked, 'Reject oversize before allocating');
        assert.deepEqual(proof.afterOversized, proof.evicted);
        assert.equal(proof.resized.framebufferBytes, 0);
        assert(proof.incompleteBlocked, 'Reject incomplete framebuffers');
        assert.equal(proof.afterIncomplete.framebufferSets, 0);
        assert.equal(proof.afterIncomplete.framebufferBytes, 0);
        assert.equal(proof.destroyed.framebufferBytes, 0);
        assert.equal(proof.destroyed.framebufferSets, 0);
        console.log('PASS: mixed panel sizes and DPR, framebuffer eviction and bounds, incomplete framebuffer recovery, and cleanup.');
        if (referencePath) console.log('PASS: exact pixel parity with the pinned original renderer across five panel configurations.');
    } finally {
        await browser.close();
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
