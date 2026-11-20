import assert from "node:assert/strict";
import { linkSync, mkdirSync, mkdtempSync, rmdirSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createLocalWallpaperReader } from "../src/local-wallpaper.js";

const name = "d60b0cb1ec13b33a";
const prefix = "vencord:///themes/hotori-assets/";
const png = Buffer.from("89504e470d0a1a0a0102030405060708", "hex");

function fixture(t) {
    const directory = mkdtempSync(join(tmpdir(), "hotori-wallpaper-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const themes = join(directory, "themes");
    const assets = join(themes, "hotori-assets");
    mkdirSync(assets, { recursive: true });
    return { directory, assets, read: createLocalWallpaperReader(themes) };
}

test("reads only supported raster types and returns cloneable bytes", async t => {
    const { assets, read } = fixture(t);
    for (const [extension, mime, image] of [
        ["png", "image/png", png],
        ["jpg", "image/jpeg", Buffer.from("ffd8ffe000010203", "hex")],
        ["gif", "image/gif", Buffer.from("GIF87a\x01\x02")],
        ["gif", "image/gif", Buffer.from("GIF89a\x03\x04")],
        ["webp", "image/webp", Buffer.from("RIFF\x08\0\0\0WEBPVP8 ")]
    ]) {
        const asset = `${name}.${extension}`;
        writeFileSync(join(assets, asset), image);
        const result = structuredClone(await read(prefix + asset));
        assert.equal(result.mime, mime);
        assert.equal(result.bytes.constructor, Uint8Array);
        assert.deepEqual(result.bytes, Uint8Array.from(image));
    }
});

test("rejects traversal, escapes, URL components and arbitrary names", async t => {
    const { assets, read } = fixture(t);
    writeFileSync(join(assets, `${name}.png`), png);
    for (const uri of [
        null, {}, `${prefix}../${name}.png`, `${prefix}..\\${name}.png`, `${prefix}%2E%2E%2F${name}.png`,
        `${prefix}%64${name.slice(1)}.png`, `${prefix}${name}.png?key=1`, `${prefix}${name}.png#hash`,
        `${prefix}${name}.png\n`, `${prefix}${name}.png\0`, `${prefix}${name}.PNG`, `${prefix}${name}.jpeg`,
        `${prefix}${name}.svg`, `${prefix}${name}.png:stream`, `${prefix}home-logo-preview.png`,
        `vencord://themes/hotori-assets/${name}.png`, `vencord://host/themes/hotori-assets/${name}.png`,
        `file:///themes/hotori-assets/${name}.png`, `https://example.com/${name}.png`
    ]) {
        await assert.rejects(read(uri), /Unsupported local wallpaper URL/);
    }
});

test("rejects invalid signatures, hard links, oversized files and directories", async t => {
    const { assets, directory, read } = fixture(t);
    const asset = `${name}.png`;
    const path = join(assets, asset);
    const uri = prefix + asset;
    const rejection = /Could not read a supported Hotori wallpaper/;
    await assert.rejects(read(uri), rejection);
    for (const invalid of [Buffer.alloc(0), png.subarray(0, 7), Buffer.from("GIF89a"), Buffer.from("<svg/>")]) {
        writeFileSync(path, invalid);
        await assert.rejects(read(uri), rejection);
    }
    writeFileSync(path, png);
    truncateSync(path, 50 * 1024 * 1024 + 1);
    await assert.rejects(read(uri), rejection);
    rmSync(path);

    const external = join(directory, "external.png");
    writeFileSync(external, png);
    linkSync(external, path);
    await assert.rejects(read(uri), rejection);
    rmSync(path);
    mkdirSync(path);
    await assert.rejects(read(uri), rejection);
});

test("rejects wallpaper directory links", async t => {
    const { assets, directory, read } = fixture(t);
    const target = join(directory, "target");
    mkdirSync(target);
    writeFileSync(join(target, `${name}.png`), png);
    rmdirSync(assets);
    try {
        symlinkSync(target, assets, "junction");
    } catch (error) {
        if (error.code !== "EPERM" && error.code !== "EACCES") throw error;
        t.skip("This environment cannot create directory links.");
        return;
    }
    await assert.rejects(read(`${prefix}${name}.png`), /Could not read a supported Hotori wallpaper/);
});
