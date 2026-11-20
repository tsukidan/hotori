import { randomUUID } from "node:crypto";
import {
    closeSync, constants, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readSync,
    renameSync, unlinkSync, writeFileSync
} from "node:fs";
import { dirname, join } from "node:path";

const MAX_CONFIG_BYTES = 4096;
const HEARTBEAT_TTL_MS = 10000;
const CONFIG_KEYS = ["schemaVersion", "revision", "requestedEnabled", "quality"];
const REPORT_KEYS = ["appliedRevision", "requestedEnabled", "quality", "status", "reason"];
const QUALITIES = new Set(["low", "balanced", "high"]);
const ENABLED_STATUSES = new Set(["active", "suspended", "fallback", "error"]);
const OFF_CONFIG = Object.freeze({ schemaVersion: 1, revision: null, requestedEnabled: false, quality: "balanced" });
const MISSING = Object.freeze({ kind: "missing", config: OFF_CONFIG, error: null });
const UTF8 = new TextDecoder("utf-8", { fatal: true });

function invalid(error) {
    return Object.freeze({ kind: "invalid", config: OFF_CONFIG, error });
}

function hasExactKeys(value, keys) {
    return value != null && typeof value === "object" && !Array.isArray(value)
        && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function directoryExists(path, create = false) {
    const stat = lstatSync(path, { throwIfNoEntry: false });
    if (stat) {
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Unsafe companion directory.");
        return true;
    }
    if (!create) return false;
    try {
        mkdirSync(path, { mode: 0o700 });
    } catch (error) {
        if (error.code !== "EEXIST") throw error;
    }
    return directoryExists(path);
}

function readConfig(path) {
    const stat = lstatSync(path, { throwIfNoEntry: false });
    if (!stat) return MISSING;
    if (!stat.isFile() || stat.isSymbolicLink()) return invalid("The companion configuration must be a regular file.");
    if (stat.size > MAX_CONFIG_BYTES) return invalid("The companion configuration exceeds 4096 bytes.");

    const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);
    const fd = openSync(path, flags);
    const buffer = Buffer.alloc(MAX_CONFIG_BYTES + 1);
    let length = 0;
    try {
        const opened = fstatSync(fd);
        if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino) {
            return invalid("The companion configuration changed during the read.");
        }
        while (length < buffer.length) {
            const count = readSync(fd, buffer, length, buffer.length - length, null);
            if (count === 0) break;
            length += count;
        }
    } finally {
        closeSync(fd);
    }
    if (length > MAX_CONFIG_BYTES) return invalid("The companion configuration exceeds 4096 bytes.");

    let config;
    try {
        config = JSON.parse(UTF8.decode(buffer.subarray(0, length)));
    } catch {
        return invalid("The companion configuration is not valid UTF-8 JSON.");
    }
    if (!hasExactKeys(config, CONFIG_KEYS) || config.schemaVersion !== 1
        || !Number.isSafeInteger(config.revision) || config.revision < 0
        || typeof config.requestedEnabled !== "boolean" || !QUALITIES.has(config.quality)) {
        return invalid("The companion configuration does not match schema version 1.");
    }
    return Object.freeze({ kind: "valid", config: Object.freeze(config), error: null });
}

function validateReport(value) {
    if (!hasExactKeys(value, REPORT_KEYS) || (value.appliedRevision !== null
        && (!Number.isSafeInteger(value.appliedRevision) || value.appliedRevision < 0))
        || typeof value.requestedEnabled !== "boolean" || !QUALITIES.has(value.quality)
        || (value.status !== "disabled" && !ENABLED_STATUSES.has(value.status))
        || (value.reason !== null && (typeof value.reason !== "string" || value.reason.length > 256
            || /[\u0000-\u001f\u007f\u2028\u2029]/u.test(value.reason)))) {
        throw new Error("Invalid companion status report.");
    }
}

function statusMatches(snapshot, status) {
    if (snapshot.kind === "invalid") return status === "error";
    if (snapshot.kind === "missing") return status === "disabled";
    return snapshot.config.requestedEnabled ? ENABLED_STATUSES.has(status) : status === "disabled" || status === "error";
}

function writeStatus(path, value) {
    const existing = lstatSync(path, { throwIfNoEntry: false });
    if (existing && (!existing.isFile() || existing.isSymbolicLink())) throw new Error("Unsafe companion status file.");
    const temporary = `${path}.${randomUUID()}.tmp`;
    const fd = openSync(temporary, "wx", 0o600);
    try {
        try {
            writeFileSync(fd, `${JSON.stringify(value)}\n`, "utf8");
            fsyncSync(fd);
        } finally {
            closeSync(fd);
        }
        renameSync(temporary, path);
    } catch (error) {
        try {
            unlinkSync(temporary);
        } catch {
            // A temporary file is ignored by status readers.
        }
        throw error;
    }
}

// Only the main-process wrapper can choose the bridge root. Renderer calls carry a session ID and report data.
export function createCompanionNative(root) {
    const hotoriDirectory = dirname(root);
    const appDataDirectory = dirname(hotoriDirectory);
    const statusDirectory = join(root, "status");
    const configPath = join(root, "config.json");
    const sessions = new WeakMap();

    function refresh(session) {
        let snapshot;
        try {
            snapshot = directoryExists(hotoriDirectory) && directoryExists(root) ? readConfig(configPath) : MISSING;
        } catch {
            snapshot = invalid("Could not read the companion configuration.");
        }
        if (snapshot.kind === "valid") {
            const { config } = snapshot;
            const previous = session.lastValid;
            if (previous && (config.revision < previous.revision || (config.revision === previous.revision
                && (config.requestedEnabled !== previous.requestedEnabled || config.quality !== previous.quality)))) {
                snapshot = invalid("The companion configuration revision is older or conflicts with the last accepted request.");
            } else {
                session.lastValid = config;
            }
        }
        session.snapshot = snapshot;
        return snapshot;
    }

    function publish(session, pluginEnabled, status, reason, appliedRevision) {
        const { config } = session.snapshot;
        const now = Date.now();
        const entry = {
            schemaVersion: 1,
            instanceId: session.id,
            pid: process.pid,
            pluginEnabled,
            requestedRevision: config.revision,
            appliedRevision,
            requestedEnabled: config.requestedEnabled,
            quality: config.quality,
            status,
            reason,
            updatedAt: new Date(now).toISOString(),
            heartbeatExpiresAt: new Date(now + HEARTBEAT_TTL_MS).toISOString()
        };
        try {
            if (!existsSync(appDataDirectory)) mkdirSync(appDataDirectory, { recursive: true });
            if (!directoryExists(hotoriDirectory, true) || !directoryExists(root, true) || !directoryExists(statusDirectory, true)) {
                throw new Error("Companion status directory disappeared.");
            }
            writeStatus(join(statusDirectory, `${session.id}.json`), entry);
        } catch {
            throw new Error("Could not publish companion status.");
        }
    }

    function end(sender, session) {
        sessions.delete(sender);
        sender.removeListener("destroyed", session.onDestroyed);
        const revision = session.snapshot.config.revision;
        const appliedRevision = session.appliedRevision === revision ? revision : null;
        publish(session, false, "disabled", null, appliedRevision);
    }

    function requireSession(sender, id) {
        const session = sessions.get(sender);
        if (!session || session.id !== id) throw new Error("Unknown companion session.");
        return session;
    }

    return {
        open({ sender }) {
            if (sender.isDestroyed()) throw new Error("Unknown companion session.");
            const previous = sessions.get(sender);
            if (previous) end(sender, previous);
            const session = {
                id: randomUUID(), lastValid: null, snapshot: MISSING, appliedRevision: null,
                onDestroyed() {
                    if (sessions.get(sender) !== session) return;
                    try {
                        end(sender, session);
                    } catch {
                        // Unwritten shutdowns are covered by the heartbeat expiry.
                    }
                }
            };
            sessions.set(sender, session);
            sender.once("destroyed", session.onDestroyed);
            return { sessionId: session.id, snapshot: refresh(session) };
        },
        poll({ sender }, id) {
            return refresh(requireSession(sender, id));
        },
        report({ sender }, id, value) {
            const session = requireSession(sender, id);
            validateReport(value);
            const snapshot = refresh(session);
            const { config } = snapshot;
            if (value.appliedRevision !== config.revision || value.requestedEnabled !== config.requestedEnabled
                || value.quality !== config.quality || !statusMatches(snapshot, value.status)) {
                throw new Error("Status no longer matches the companion configuration.");
            }
            publish(session, true, value.status, value.reason, value.appliedRevision);
            session.appliedRevision = value.appliedRevision;
        },
        close({ sender }, id) {
            const session = sessions.get(sender);
            if (session?.id === id) end(sender, session);
        }
    };
}
