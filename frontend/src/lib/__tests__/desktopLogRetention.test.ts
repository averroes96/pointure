import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const {
  RETENTION_DAYS,
  entryTime,
  firstLineToKeep,
  pruneDesktopLogs,
  describe: describeReport,
  splitLines,
} = require("../../../../desktop/log-retention.js");

// Electron's desktop.log keeps the last 30 days, with the same rule as the backend's logs
// (backend/apps/core/desktop/log_retention.py): keep a file from its first recent entry.

const NOW = new Date(2026, 10, 18, 10, 0, 0); // 18 Nov 2026, local time

function line(daysAgo: number, text = "[info] [Startup] ShoeDZ Desktop starting"): string {
  const d = new Date(NOW.getTime() - daysAgo * 86400000);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  const when = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.123`;
  return `[${when}] ${text}\n`;
}

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "shodz-logs-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const lines = (text: string) => splitLines(Buffer.from(text));

describe("desktop log retention", () => {
  it("reads electron-log timestamps and ignores continuation lines", () => {
    expect(entryTime("[2026-11-14 15:14:37.261] [error] [Backend] crash")).toEqual(new Date(2026, 10, 14, 15, 14, 37));
    expect(entryTime("    at createConnectionError (node:net:1652:14)")).toBeNull();
    expect(entryTime("[2026-13-45 99:99:99.000] impossible")).toBeNull();
    expect(entryTime("")).toBeNull();
  });

  it("keeps a file from its first recent entry, old stack traces go too", () => {
    expect(RETENTION_DAYS).toBe(30);
    const text = line(40) + line(35, "[error] boom") + "    at stack (x.js:1:1)\n" + line(10) + "  more\n" + line(0);
    expect(firstLineToKeep(lines(text), NOW)).toBe(3);
  });

  it("drops entries stamped by a clock ahead before the first recent entry, keeps those after it", () => {
    const text = "[2072-10-17 15:58:46.725] [info] wrong clock\n" + line(48) + line(5) + "[2072-01-01 00:00:00.000] [info] later\n";
    expect(firstLineToKeep(lines(text), NOW)).toBe(2);
  });

  it("keeps entries stamped by a clock set back after a recent entry", () => {
    expect(firstLineToKeep(lines(line(40) + line(10) + line(60, "[info] clock set back") + line(2)), NOW)).toBe(1);
  });

  it.each([
    ["the PC clock jumped forward", new Date(2072, 9, 17, 15, 58), line(40) + line(2)],
    ["the PC clock was reset to 2000", new Date(2000, 0, 1), line(40) + line(2)],
    ["only stamps ahead of today", NOW, "[2072-10-17 15:58:46.725] [info] a\n"],
  ])("removes nothing when %s", (_label, now, text) => {
    expect(firstLineToKeep(lines(text), now)).toBe(0);
  });

  it("trims desktop.log in place, keeping bytes and line endings", () => {
    const recent = Buffer.concat([Buffer.from(line(2).replace("\n", "\r\n")), Buffer.from([0xff, 0xfe, 0x0a])]);
    fs.writeFileSync(path.join(dir, "desktop.log"), Buffer.concat([Buffer.from(line(40)), recent]));

    const report = pruneDesktopLogs(dir, { now: NOW });

    expect(report).toEqual({ trimmed: { "desktop.log": 1 }, deleted: [], skipped: [] });
    expect(fs.readFileSync(path.join(dir, "desktop.log")).equals(recent)).toBe(true);
    expect(fs.existsSync(path.join(dir, "desktop.log.tmp"))).toBe(false);
  });

  it("empties desktop.log but deletes desktop.old.log when nothing recent is left", () => {
    fs.writeFileSync(path.join(dir, "desktop.log"), line(90));
    fs.writeFileSync(path.join(dir, "desktop.old.log"), line(120) + line(95));

    const report = pruneDesktopLogs(dir, { now: NOW });

    expect(report).toEqual({ trimmed: { "desktop.log": 1 }, deleted: ["desktop.old.log"], skipped: [] });
    expect(fs.readFileSync(path.join(dir, "desktop.log"), "utf8")).toBe("");
    expect(fs.existsSync(path.join(dir, "desktop.old.log"))).toBe(false);
  });

  it("deletes a years-old desktop.old.log when desktop.log is recent, keeps all when nothing is from the last year", () => {
    fs.writeFileSync(path.join(dir, "desktop.log"), line(1));
    fs.writeFileSync(path.join(dir, "desktop.old.log"), line(800));
    expect(pruneDesktopLogs(dir, { now: NOW })).toEqual({ trimmed: {}, deleted: ["desktop.old.log"], skipped: [] });

    fs.writeFileSync(path.join(dir, "desktop.log"), line(700));
    fs.writeFileSync(path.join(dir, "desktop.old.log"), line(800));
    expect(pruneDesktopLogs(dir, { now: NOW })).toEqual({ trimmed: {}, deleted: [], skipped: [] });
    expect(fs.existsSync(path.join(dir, "desktop.old.log"))).toBe(true);
  });

  it("leaves recent logs, the backend's logs and missing files alone", () => {
    const recent = line(3) + line(1);
    fs.writeFileSync(path.join(dir, "desktop.log"), recent);
    fs.writeFileSync(path.join(dir, "shodz.log"), line(90));             // pruned by the backend, not here

    expect(pruneDesktopLogs(dir, { now: NOW })).toEqual({ trimmed: {}, deleted: [], skipped: [] });
    expect(fs.readFileSync(path.join(dir, "desktop.log"), "utf8")).toBe(recent);
    expect(fs.readFileSync(path.join(dir, "shodz.log"), "utf8")).toBe(line(90));
    expect(pruneDesktopLogs(path.join(dir, "missing"), { now: NOW })).toEqual({ trimmed: {}, deleted: [], skipped: [] });
  });

  it("reports as one log line", () => {
    expect(describeReport({ trimmed: {}, deleted: [], skipped: [] })).toBe("");
    expect(describeReport({ trimmed: { "desktop.log": 40 }, deleted: ["desktop.old.log"], skipped: [] })).toBe(
      "Log retention (30 days): desktop.log: 40 line(s); deleted desktop.old.log",
    );
  });
});
