import definePlugin, { PluginNative } from "@utils/types";

import { CompanionController } from "./src/companion-controller.js";
import { GlassRuntime } from "./src/runtime.js";

let controller: CompanionController | undefined;
const stop = () => {
    window.removeEventListener("beforeunload", stop);
    const previous = controller;
    controller = undefined;
    previous?.stop();
};

export default definePlugin({
    name: "HotoriTrueLiquidGlass",
    description: "Wallpaper refraction controlled by Hotori's companion configuration. Enable this plugin separately.",
    authors: [{ name: "Hotori", id: 0n }],
    enabledByDefault: false,
    start() {
        if (controller) return;
        const bridge = VencordNative.pluginHelpers.HotoriTrueLiquidGlass as PluginNative<typeof import("./native")>;
        controller = new CompanionController({ bridge, createRuntime: options => new GlassRuntime({
            ...options,
            resolveLocalWallpaper: uri => bridge.readLocalWallpaper(uri)
        }) });
        window.addEventListener("beforeunload", stop);
        controller.start();
    },
    stop,
    getStats() { return controller?.getStats(); }
});
