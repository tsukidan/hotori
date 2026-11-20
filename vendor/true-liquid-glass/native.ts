import type { IpcMainInvokeEvent } from "electron";
import { THEMES_DIR } from "@main/utils/constants";
import { homedir } from "node:os";
import { join } from "node:path";

import { createCompanionNative } from "./src/companion-native.js";
import { createLocalWallpaperReader } from "./src/local-wallpaper.js";

const appData = process.platform === "win32"
    ? process.env.APPDATA || join(homedir(), "AppData", "Roaming")
    : join(homedir(), ".config");
const bridge = createCompanionNative(join(appData, "Hotori", "TrueLiquidGlass"));
const readWallpaper = createLocalWallpaperReader(THEMES_DIR);

export function readLocalWallpaper(_event: IpcMainInvokeEvent, uri: string) {
    return readWallpaper(uri);
}

export function open(event: IpcMainInvokeEvent) {
    return bridge.open(event);
}

export function poll(event: IpcMainInvokeEvent, sessionId: string) {
    return bridge.poll(event, sessionId);
}

export function report(event: IpcMainInvokeEvent, sessionId: string, status: unknown) {
    bridge.report(event, sessionId, status);
}

export function close(event: IpcMainInvokeEvent, sessionId: string) {
    bridge.close(event, sessionId);
}
