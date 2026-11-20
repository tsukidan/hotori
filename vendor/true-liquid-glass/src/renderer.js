// Adapted from @ybouane/liquidglass 1.0.3 (MIT). See vendor/NOTICE.md.
import { DEFAULTS, BLUR_ITERATIONS, SHADOW_PAD, VS_QUAD, FS_BLIT, FS_BLUR, VS_GLASS, FS_GLASS } from "./vendor/liquidglass-shaders.js";

export { DEFAULTS, SHADOW_PAD };

const DEFAULT_FRAMEBUFFER_BUDGET = 64 * 1024 * 1024;
const FRAMEBUFFER_BYTES_PER_PIXEL = 3 * 4;

export class GlassRenderer {
    constructor({ framebufferBudgetBytes = DEFAULT_FRAMEBUFFER_BUDGET } = {}) {
        if (!Number.isSafeInteger(framebufferBudgetBytes) || framebufferBudgetBytes < FRAMEBUFFER_BYTES_PER_PIXEL) {
            throw new RangeError("Invalid Liquid Glass framebuffer budget");
        }
        this.framebufferBudgetBytes = framebufferBudgetBytes;
        this.framebuffers = new Map();
        this.framebufferBytes = 0;
        this.counts = { uploads: 0, draws: 0, panels: 0, evictions: 0 };
        this.contextLost = false;
        this.destroyed = false;
        this.canvas = document.createElement("canvas");
        this.cropCanvas = document.createElement("canvas");
        this.canvas.width = this.canvas.height = 0;
        this.cropCanvas.width = this.cropCanvas.height = 0;
        this.onContextLost = event => {
            event.preventDefault();
            this.contextLost = true;
            this._forgetResources();
        };
        this.onContextRestored = () => {
            if (this.destroyed) return;
            try {
                this._initialize();
                this.contextLost = false;
            } catch (error) {
                this._releaseResources();
                this.contextLost = true;
                this.restoreError = error;
            }
        };

        try {
            this.cropContext = this.cropCanvas.getContext("2d");
            if (!this.cropContext) throw new Error("Liquid Glass needs a 2D canvas");
            this.gl = this.canvas.getContext("webgl", {
                alpha: true,
                premultipliedAlpha: false,
                antialias: false,
                preserveDrawingBuffer: true,
            });
            if (!this.gl) throw new Error("Liquid Glass needs WebGL");
            this._initialize();
            this.canvas.addEventListener("webglcontextlost", this.onContextLost);
            this.canvas.addEventListener("webglcontextrestored", this.onContextRestored);
        } catch (error) {
            this.destroy();
            throw error;
        }
    }

    _initialize() {
        const gl = this.gl;
        this.restoreError = null;
        const textureLimit = gl.getParameter(gl.MAX_TEXTURE_SIZE);
        const renderbufferLimit = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE);
        const [viewportWidth, viewportHeight] = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
        this.maxWidth = Math.min(textureLimit, renderbufferLimit, viewportWidth);
        this.maxHeight = Math.min(textureLimit, renderbufferLimit, viewportHeight);
        this.blit = this._createProgram(VS_QUAD, FS_BLIT, ["u_tex", "u_scale", "u_offset"]);
        this.blur = this._createProgram(VS_QUAD, FS_BLUR, ["u_tex", "u_dir"]);
        this.glass = this._createProgram(VS_GLASS, FS_GLASS, [
            "u_bgTex", "u_blurTex", "u_center", "u_size", "u_radius", "u_res", "u_pad", "u_refract",
            "u_chroma", "u_edgeHL", "u_spec", "u_fresnel", "u_distort", "u_alpha", "u_sat", "u_tint",
            "u_zRadius", "u_brightness", "u_shadowAlpha", "u_shadowSpread", "u_shadowOffY", "u_bevelMode",
        ]);
        this.quadBuffer = this._createBuffer([-1, -1, 1, -1, -1, 1, 1, 1]);
        this.panelBuffer = this._createBuffer([-.5, -.5, .5, -.5, -.5, .5, .5, .5]);
    }

    _createProgram(vertexSource, fragmentSource, uniforms) {
        const gl = this.gl;
        const program = gl.createProgram();
        if (!program) throw new Error("Could not allocate a Liquid Glass WebGL program");
        let vertex, fragment;
        try {
            vertex = this._compile(gl.VERTEX_SHADER, vertexSource);
            fragment = this._compile(gl.FRAGMENT_SHADER, fragmentSource);
            gl.attachShader(program, vertex);
            gl.attachShader(program, fragment);
            gl.linkProgram(program);
            if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
                throw new Error(`Liquid Glass shader link failed: ${gl.getProgramInfoLog(program)}`);
            }
            const position = gl.getAttribLocation(program, "a_pos");
            if (position < 0) throw new Error("Liquid Glass shader position attribute is unavailable");
            gl.detachShader(program, vertex);
            gl.detachShader(program, fragment);
            return {
                program,
                position,
                uniforms: Object.fromEntries(uniforms.map(name => [name, gl.getUniformLocation(program, name)])),
            };
        } catch (error) {
            gl.deleteProgram(program);
            throw error;
        } finally {
            if (vertex) gl.deleteShader(vertex);
            if (fragment) gl.deleteShader(fragment);
        }
    }

    _compile(type, source) {
        const gl = this.gl;
        const shader = gl.createShader(type);
        if (!shader) throw new Error("Could not allocate a Liquid Glass shader");
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            const message = gl.getShaderInfoLog(shader);
            gl.deleteShader(shader);
            throw new Error(`Liquid Glass shader compilation failed: ${message}`);
        }
        return shader;
    }

    _createBuffer(vertices) {
        const gl = this.gl;
        const buffer = gl.createBuffer();
        if (!buffer) throw new Error("Could not allocate a Liquid Glass vertex buffer");
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
        return buffer;
    }

    _createFramebuffer(width, height) {
        const gl = this.gl;
        const texture = gl.createTexture();
        const framebuffer = gl.createFramebuffer();
        try {
            if (!texture || !framebuffer) throw new Error("Could not allocate a Liquid Glass framebuffer");
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
            this._configureTexture();
            gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
            if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
                throw new Error("Liquid Glass framebuffer is incomplete");
            }
            return { texture, framebuffer };
        } catch (error) {
            if (texture) gl.deleteTexture(texture);
            if (framebuffer) gl.deleteFramebuffer(framebuffer);
            throw error;
        } finally {
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        }
    }

    _configureTexture() {
        const gl = this.gl;
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }

    _targetsFor(width, height) {
        const bytes = width * height * FRAMEBUFFER_BYTES_PER_PIXEL;
        if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 ||
            width > this.maxWidth || height > this.maxHeight || bytes > this.framebufferBudgetBytes) {
            throw new RangeError("Liquid Glass panel exceeds the framebuffer size or memory budget");
        }
        if (this.canvas.width < width || this.canvas.height < height) {
            this.canvas.width = width;
            this.canvas.height = height;
        }
        if (this.gl.drawingBufferWidth < width || this.gl.drawingBufferHeight < height) {
            throw new RangeError("The WebGL drawing buffer is too small for the Liquid Glass panel");
        }

        const key = `${width}x${height}`;
        let targets = this.framebuffers.get(key);
        if (targets) {
            this.framebuffers.delete(key);
            this.framebuffers.set(key, targets);
            return targets;
        }

        while (this.framebufferBytes + bytes > this.framebufferBudgetBytes) {
            const oldest = this.framebuffers.keys().next().value;
            const previous = this.framebuffers.get(oldest);
            this._deleteTargetSet(previous);
            this.framebuffers.delete(oldest);
            this.framebufferBytes -= previous.bytes;
            this.counts.evictions++;
        }
        targets = { width, height, bytes };
        try {
            targets.sharp = this._createFramebuffer(width, height);
            targets.blurA = this._createFramebuffer(width, height);
            targets.blurB = this._createFramebuffer(width, height);
        } catch (error) {
            this._deleteTargetSet(targets);
            throw error;
        }
        this.framebuffers.set(key, targets);
        this.framebufferBytes += bytes;
        return targets;
    }

    _draw(program, buffer = this.quadBuffer) {
        const gl = this.gl;
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.enableVertexAttribArray(program.position);
        gl.vertexAttribPointer(program.position, 2, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        this.counts.draws++;
    }

    uploadAndBlur(sourceCanvas, sourceX, sourceY, width, height, blurAmount) {
        this._checkAvailable();
        this.activeTargets = null;
        const gl = this.gl;
        const targets = this._targetsFor(width, height);
        // Reset canvas origin state even if the old source failed WebGL upload.
        this.cropCanvas.width = width;
        this.cropCanvas.height = height;
        // Refraction can sample the padded area beyond the viewport. Leaving
        // that area transparent turns its RGB into black in the optical pass,
        // especially on a narrow member rail at the right edge. Extend the
        // wallpaper's edge pixels, matching CLAMP_TO_EDGE texture sampling.
        const segments = (start, length, sourceLength) => {
            const a = Math.max(0, Math.min(length, -start));
            const b = Math.max(a, Math.min(length, sourceLength - start));
            return [[0, a, 0, 1], [a, b - a, Math.max(0, start), b - a], [b, length - b, sourceLength - 1, 1]];
        };
        const xs = segments(sourceX, width, sourceCanvas.width);
        const ys = segments(sourceY, height, sourceCanvas.height);
        for (const [dy, dh, sy, sh] of ys) for (const [dx, dw, sx, sw] of xs) {
            if (dw > 0 && dh > 0)
                this.cropContext.drawImage(sourceCanvas, sx, sy, sw, sh, dx, dy, dw, dh);
        }

        gl.activeTexture(gl.TEXTURE0);
        if (!this.sourceTexture) {
            this.sourceTexture = gl.createTexture();
            if (!this.sourceTexture) throw new Error("Could not allocate the Liquid Glass source texture");
            gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
            this._configureTexture();
        } else {
            gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
        }
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        try {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.cropCanvas);
        } finally {
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        }
        this.counts.uploads++;

        gl.bindFramebuffer(gl.FRAMEBUFFER, targets.sharp.framebuffer);
        gl.viewport(0, 0, width, height);
        gl.useProgram(this.blit.program);
        gl.uniform1i(this.blit.uniforms.u_tex, 0);
        gl.uniform2f(this.blit.uniforms.u_scale, 1, 1);
        gl.uniform2f(this.blit.uniforms.u_offset, 0, 0);
        this._draw(this.blit);

        gl.bindFramebuffer(gl.FRAMEBUFFER, targets.blurA.framebuffer);
        gl.bindTexture(gl.TEXTURE_2D, targets.sharp.texture);
        this._draw(this.blit);
        if (blurAmount > 0) {
            const spread = blurAmount * 2.5;
            gl.useProgram(this.blur.program);
            gl.uniform1i(this.blur.uniforms.u_tex, 0);
            for (let step = 0; step < BLUR_ITERATIONS; step++) {
                gl.bindFramebuffer(gl.FRAMEBUFFER, targets.blurB.framebuffer);
                gl.bindTexture(gl.TEXTURE_2D, targets.blurA.texture);
                gl.uniform2f(this.blur.uniforms.u_dir, spread / width, 0);
                this._draw(this.blur);
                gl.bindFramebuffer(gl.FRAMEBUFFER, targets.blurA.framebuffer);
                gl.bindTexture(gl.TEXTURE_2D, targets.blurB.texture);
                gl.uniform2f(this.blur.uniforms.u_dir, 0, spread / height);
                this._draw(this.blur);
            }
        }
        this.activeTargets = targets;
    }

    renderGlassPanel(config, width, height, dpr) {
        const targets = this._requireTargets();
        const gl = this.gl;
        const { uniforms: u } = this.glass;
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.useProgram(this.glass.program);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, targets.sharp.texture);
        gl.uniform1i(u.u_bgTex, 0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, targets.blurA.texture);
        gl.uniform1i(u.u_blurTex, 1);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, this.canvas.height - targets.height, targets.width, targets.height);
        gl.uniform2f(u.u_res, targets.width, targets.height);
        gl.uniform2f(u.u_center, targets.width * .5, targets.height * .5);
        gl.uniform2f(u.u_size, width * dpr, height * dpr);
        gl.uniform1f(u.u_radius, config.cornerRadius * dpr);
        gl.uniform1f(u.u_pad, SHADOW_PAD * dpr);
        gl.uniform1f(u.u_refract, config.refraction);
        gl.uniform1f(u.u_chroma, config.chromAberration);
        gl.uniform1f(u.u_edgeHL, config.edgeHighlight);
        gl.uniform1f(u.u_spec, config.specular);
        gl.uniform1f(u.u_fresnel, config.fresnel);
        gl.uniform1f(u.u_distort, config.distortion);
        gl.uniform1f(u.u_alpha, config.opacity);
        gl.uniform1f(u.u_sat, config.saturation);
        gl.uniform1f(u.u_tint, config.tintStrength);
        gl.uniform1f(u.u_zRadius, config.zRadius * dpr);
        gl.uniform1f(u.u_brightness, config.brightness);
        gl.uniform1f(u.u_shadowAlpha, config.shadowOpacity);
        gl.uniform1f(u.u_shadowSpread, config.shadowSpread * dpr);
        gl.uniform1f(u.u_shadowOffY, config.shadowOffsetY * dpr);
        gl.uniform1f(u.u_bevelMode, config.bevelMode);
        this._draw(this.glass, this.panelBuffer);
        gl.disable(gl.BLEND);
        this.counts.panels++;
    }

    clear() {
        const { width, height } = this._requireTargets();
        const gl = this.gl;
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        const y = this.canvas.height - height;
        gl.viewport(0, y, width, height);
        gl.enable(gl.SCISSOR_TEST);
        gl.scissor(0, y, width, height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.disable(gl.SCISSOR_TEST);
    }

    _checkAvailable() {
        if (this.destroyed || this.contextLost || this.gl.isContextLost()) {
            throw new Error("The Liquid Glass WebGL context is unavailable");
        }
    }

    _requireTargets() {
        this._checkAvailable();
        if (!this.activeTargets) throw new Error("Upload a Liquid Glass backdrop before drawing a panel");
        return this.activeTargets;
    }

    getStats() {
        return { ...this.counts, framebufferBytes: this.framebufferBytes, framebufferSets: this.framebuffers.size };
    }

    resize() {
        if (this.destroyed) return;
        if (!this.gl.isContextLost()) {
            this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
            for (const targets of this.framebuffers.values()) this._deleteTargetSet(targets);
            if (this.sourceTexture) this.gl.deleteTexture(this.sourceTexture);
        }
        this.sourceTexture = null;
        this.activeTargets = null;
        this.framebuffers.clear();
        this.framebufferBytes = 0;
        this.canvas.width = this.canvas.height = 0;
        this.cropCanvas.width = this.cropCanvas.height = 0;
    }

    _deleteTargetSet(targets) {
        for (const target of [targets.sharp, targets.blurA, targets.blurB]) {
            if (!target) continue;
            this.gl.deleteFramebuffer(target.framebuffer);
            this.gl.deleteTexture(target.texture);
        }
    }

    _forgetResources() {
        this.sourceTexture = this.activeTargets = null;
        this.blit = this.blur = this.glass = null;
        this.quadBuffer = this.panelBuffer = null;
        this.framebuffers.clear();
        this.framebufferBytes = 0;
    }

    _releaseResources() {
        const gl = this.gl;
        if (gl && !gl.isContextLost()) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            for (const targets of this.framebuffers.values()) this._deleteTargetSet(targets);
            if (this.sourceTexture) gl.deleteTexture(this.sourceTexture);
            for (const program of [this.blit, this.blur, this.glass]) {
                if (program) gl.deleteProgram(program.program);
            }
            for (const buffer of [this.quadBuffer, this.panelBuffer]) {
                if (buffer) gl.deleteBuffer(buffer);
            }
        }
        this._forgetResources();
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.canvas.removeEventListener("webglcontextlost", this.onContextLost);
        this.canvas.removeEventListener("webglcontextrestored", this.onContextRestored);
        this._releaseResources();
        this.canvas.width = this.canvas.height = 0;
        this.cropCanvas.width = this.cropCanvas.height = 0;
        if (this.gl && !this.gl.isContextLost()) this.gl.getExtension("WEBGL_lose_context")?.loseContext();
        this.gl = null;
        this.canvas.remove();
    }
}
