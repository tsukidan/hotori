import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { join } from "node:path";

const LOCAL_URI = /^vencord:\/\/\/themes\/hotori-assets\/([a-f0-9]{16}\.(png|jpg|gif|webp))$/u;
const MAX_BYTES = 50 * 1024 * 1024;
const OPEN_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];
const MIME = {
    png: "image/png",
    jpg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp"
};

function hasImageSignature(extension, header) {
    switch (extension) {
        case "png": return PNG.every((byte, index) => header[index] === byte);
        case "jpg": return JPEG.every((byte, index) => header[index] === byte);
        case "gif": return header.toString("latin1", 0, 6) === "GIF87a" || header.toString("latin1", 0, 6) === "GIF89a";
        case "webp": return header.length >= 12 && header.toString("latin1", 0, 4) === "RIFF"
            && header.toString("latin1", 8, 12) === "WEBP";
        default: return false;
    }
}

async function readExactly(file, bytes, offset = 0) {
    while (offset < bytes.length) {
        const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
        if (!bytesRead) throw new Error("Wallpaper file ended during the read.");
        offset += bytesRead;
    }
}

async function directoryStat(path) {
    const stat = await lstat(path, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Unsafe wallpaper directory.");
    return stat;
}

function sameEntry(first, second) {
    return first.dev === second.dev && first.ino === second.ino;
}

export function createLocalWallpaperReader(themesRoot) {
    const assetRoot = join(themesRoot, "hotori-assets");

    return async function readLocalWallpaper(uri) {
        const match = typeof uri === "string" && LOCAL_URI.exec(uri);
        if (!match || match[0] !== uri) throw new Error("Unsupported local wallpaper URL.");
        const [, name, extension] = match;
        const path = join(assetRoot, name);

        try {
            const themes = await directoryStat(themesRoot);
            const assets = await directoryStat(assetRoot);
            const candidate = await lstat(path, { bigint: true });
            if (!candidate.isFile() || candidate.isSymbolicLink() || candidate.nlink !== 1n
                || candidate.size < 1n || candidate.size > BigInt(MAX_BYTES)) {
                throw new Error("Unsafe wallpaper file.");
            }

            const file = await open(path, OPEN_FLAGS);
            try {
                const opened = await file.stat({ bigint: true });
                if (!opened.isFile() || opened.nlink !== 1n || !sameEntry(candidate, opened) || opened.size !== candidate.size
                    || !sameEntry(themes, await directoryStat(themesRoot)) || !sameEntry(assets, await directoryStat(assetRoot))) {
                    throw new Error("Wallpaper file changed before the read.");
                }

                const size = Number(opened.size);
                const header = Buffer.alloc(Math.min(size, 12));
                await readExactly(file, header);
                if (!hasImageSignature(extension, header)) throw new Error("Wallpaper type does not match its file extension.");

                const bytes = new Uint8Array(size);
                bytes.set(header);
                await readExactly(file, bytes, header.length);
                const finished = await file.stat({ bigint: true });
                if (finished.size !== opened.size || finished.mtimeNs !== opened.mtimeNs || finished.ctimeNs !== opened.ctimeNs) {
                    throw new Error("Wallpaper file changed during the read.");
                }
                return { mime: MIME[extension], bytes };
            } finally {
                await file.close();
            }
        } catch {
            throw new Error("Could not read a supported Hotori wallpaper.");
        }
    };
}
