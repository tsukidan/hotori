import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
    linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync,
    rmSync, symlinkSync, writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createCompanionNative } from "../src/companion-native.js";

const config = (revision, requestedEnabled = true, quality = "high") => ({
    schemaVersion: 1, revision, requestedEnabled, quality
});
const report = (appliedRevision, requestedEnabled = true, quality = "high", status = "active", reason = null) => ({
    appliedRevision, requestedEnabled, quality, status, reason
});

class Sender extends EventEmitter {
    destroyed = false;

    isDestroyed() {
        return this.destroyed;
    }

    destroy() {
        this.destroyed = true;
        this.emit("destroyed");
    }
}

function fixture(t) {
    const directory = mkdtempSync(join(tmpdir(), "hotori-companion-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const root = join(directory, "Hotori", "TrueLiquidGlass");
    const configPath = join(root, "config.json");
    const statusDirectory = join(root, "status");
    const bridge = createCompanionNative(root);
    const event = { sender: new Sender() };
    return {
        bridge, configPath, directory, event, root, statusDirectory,
        write(value) {
            mkdirSync(root, { recursive: true });
            const temporary = join(root, "config.json.tmp");
            writeFileSync(temporary, Buffer.isBuffer(value) || typeof value === "string" ? value : JSON.stringify(value));
            renameSync(temporary, configPath);
        },
        statusPath(id) {
            return join(statusDirectory, `${id}.json`);
        },
        readStatus(id) {
            return JSON.parse(readFileSync(this.statusPath(id), "utf8"));
        }
    };
}

test("missing and invalid configurations fail closed with bounded, strict reads", t => {
    const f = fixture(t);
    const { bridge, event } = f;
    const { sessionId, snapshot } = bridge.open(event);
    const off = config(null, false, "balanced");
    assert.deepEqual(snapshot, { kind: "missing", config: off, error: null });
    bridge.report(event, sessionId, report(null, false, "balanced", "disabled"));
    assert.equal(f.readStatus(sessionId).appliedRevision, null);

    for (const value of [
        "{", "null", "[]", " ".repeat(4097), Buffer.from([0x7b, 0xff, 0x7d]),
        { ...config(0), schemaVersion: 2 }, { ...config(0), requestedEnabled: "true" },
        { ...config(0), quality: "ultra" }, { ...config(0), revision: "0" },
        { ...config(0), revision: Number.MAX_SAFE_INTEGER + 1 }, { ...config(0), revision: 1.5 },
        config(-1), { ...config(0), extra: true }, { schemaVersion: 1, revision: 0 }
    ]) {
        f.write(value);
        const snapshot = bridge.poll(event, sessionId);
        assert.equal(snapshot.kind, "invalid");
        assert.deepEqual(snapshot.config, off);
        assert.equal(typeof snapshot.error, "string");
    }
    assert.throws(() => bridge.report(event, sessionId, report(null, false, "balanced", "disabled")), /no longer matches/);
    bridge.report(event, sessionId, report(null, false, "balanced", "error", "Invalid configuration"));
    assert.equal(f.readStatus(sessionId).status, "error");

    f.write(JSON.stringify(config(0)).padEnd(4096, " "));
    assert.deepEqual(bridge.poll(event, sessionId), { kind: "valid", config: config(0), error: null });
});

test("atomic configuration replacements are observed and revision rollback fails closed", t => {
    const f = fixture(t);
    f.write(config(7));
    const { bridge, event } = f;
    const { sessionId, snapshot } = bridge.open(event);
    assert.deepEqual(snapshot.config, config(7));
    f.write(config(7, false));
    assert.equal(bridge.poll(event, sessionId).kind, "invalid");
    f.write(config(6));
    assert.equal(bridge.poll(event, sessionId).kind, "invalid");
    rmSync(f.configPath);
    assert.equal(bridge.poll(event, sessionId).kind, "missing");
    f.write(config(6));
    assert.equal(bridge.poll(event, sessionId).kind, "invalid");
    f.write(config(7));
    assert.deepEqual(bridge.poll(event, sessionId).config, config(7));
    f.write(config(8, false, "low"));
    assert.deepEqual(bridge.poll(event, sessionId).config, config(8, false, "low"));
});

test("reports must match current config and replace the previous status atomically", t => {
    const f = fixture(t);
    f.write(config(8));
    const { bridge, event } = f;
    const { sessionId } = bridge.open(event);
    bridge.report(event, sessionId, report(8));
    const first = f.readStatus(sessionId);
    assert.deepEqual(first, {
        schemaVersion: 1, instanceId: sessionId, pid: process.pid, pluginEnabled: true,
        requestedRevision: 8, appliedRevision: 8, requestedEnabled: true, quality: "high",
        status: "active", reason: null, updatedAt: first.updatedAt, heartbeatExpiresAt: first.heartbeatExpiresAt
    });
    assert.equal(Date.parse(first.heartbeatExpiresAt) - Date.parse(first.updatedAt), 10000);
    const previousFile = join(f.directory, "previous-status.json");
    linkSync(f.statusPath(sessionId), previousFile);

    f.write(config(9, true, "balanced"));
    assert.throws(() => bridge.report(event, sessionId, report(8)), /no longer matches/);
    assert.throws(() => bridge.report(event, sessionId, report(9)), /no longer matches/);
    assert.throws(() => bridge.report(event, sessionId, report(9, true, "balanced", "disabled")), /no longer matches/);
    assert.throws(() => bridge.report(event, sessionId, report(9, true, "balanced", "fallback", "bad\nreason")), /Invalid/);
    assert.throws(() => bridge.report(event, sessionId, { ...report(9), path: "other" }), /Invalid/);
    assert.deepEqual(f.readStatus(sessionId), first);
    bridge.report(event, sessionId, report(9, true, "balanced", "fallback", "WebGL unavailable"));
    assert.equal(f.readStatus(sessionId).requestedRevision, 9);
    assert.equal(f.readStatus(sessionId).appliedRevision, 9);
    assert.equal(f.readStatus(sessionId).reason, "WebGL unavailable");
    assert.deepEqual(JSON.parse(readFileSync(previousFile, "utf8")), first);
    assert.deepEqual(readdirSync(f.statusDirectory), [`${sessionId}.json`]);
});

test("sessions are sender-owned and closing or destroying retains a disabled heartbeat", t => {
    const f = fixture(t);
    f.write(config(3));
    const { bridge, event } = f;
    const another = { sender: new Sender() };
    const first = bridge.open(event).sessionId;
    const second = bridge.open(another).sessionId;
    assert.notEqual(first, second);
    assert.throws(() => bridge.poll(another, first), /Unknown companion session/);
    assert.throws(() => bridge.report(another, first, report(3)), /Unknown companion session/);
    bridge.close(another, first);
    bridge.report(event, first, report(3));
    bridge.report(another, second, report(3));
    bridge.close(event, first);
    bridge.close(event, first);
    assert.throws(() => bridge.poll(event, first), /Unknown companion session/);
    assert.throws(() => bridge.report(event, first, report(3)), /Unknown companion session/);
    assert.equal(event.sender.listenerCount("destroyed"), 0);
    const stopped = f.readStatus(first);
    assert.equal(stopped.pluginEnabled, false);
    assert.equal(stopped.status, "disabled");
    assert.equal(stopped.requestedRevision, 3);
    assert.equal(stopped.appliedRevision, 3);
    assert.equal(stopped.requestedEnabled, true);
    assert.equal(f.readStatus(second).pluginEnabled, true);

    const restarted = bridge.open(another).sessionId;
    assert.equal(f.readStatus(second).pluginEnabled, false);
    assert.throws(() => bridge.report(another, second, report(3)), /Unknown companion session/);
    assert.equal(another.sender.listenerCount("destroyed"), 1);
    f.write(config(4));
    bridge.poll(another, restarted);
    another.sender.destroy();
    assert.equal(f.readStatus(restarted).pluginEnabled, false);
    assert.equal(f.readStatus(restarted).requestedRevision, 4);
    assert.equal(f.readStatus(restarted).appliedRevision, null);
    assert.equal(another.sender.listenerCount("destroyed"), 0);
    assert.throws(() => bridge.poll(another, restarted), /Unknown companion session/);
    assert.throws(() => bridge.open(another), /Unknown companion session/);
});

test("status directory links cannot redirect writes", t => {
    const f = fixture(t);
    f.write(config(1));
    const outside = join(f.directory, "outside");
    mkdirSync(outside);
    try {
        symlinkSync(outside, f.statusDirectory, "junction");
    } catch (error) {
        if (error.code !== "EPERM" && error.code !== "EACCES") throw error;
        t.skip("This environment cannot create directory links.");
        return;
    }
    const { bridge, event } = f;
    const { sessionId } = bridge.open(event);
    assert.throws(() => bridge.report(event, sessionId, report(1)), /Could not publish/);
    assert.throws(() => bridge.close(event, sessionId), /Could not publish/);
    assert.throws(() => bridge.poll(event, sessionId), /Unknown companion session/);
    assert.deepEqual(readdirSync(outside), []);
});

test("an unusable status directory blocks reports while still letting sessions close", t => {
    const f = fixture(t);
    f.write(config(1));
    writeFileSync(f.statusDirectory, "untouched");
    const { bridge, event } = f;
    const { sessionId } = bridge.open(event);
    assert.throws(() => bridge.report(event, sessionId, report(1)), /Could not publish/);
    assert.throws(() => bridge.close(event, sessionId), /Could not publish/);
    assert.throws(() => bridge.poll(event, sessionId), /Unknown companion session/);
    assert.equal(readFileSync(f.statusDirectory, "utf8"), "untouched");
});
