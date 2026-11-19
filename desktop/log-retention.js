'use strict';
/**
 * Keep Electron's logs (desktop.log, desktop.old.log) to the last RETENTION_DAYS days.
 *
 * Same rule as the backend's (backend/apps/core/desktop/log_retention.py), which prunes the files Python
 * writes. Logs are append-only, so a file is kept from its FIRST recent entry (within the retention, not in
 * the future): everything after it was written later, whatever its stamp says. A file with no recent entry
 * is emptied (desktop.old.log: deleted) only when one of the two logs has an entry from the last year;
 * otherwise the PC clock is probably wrong right now and nothing is touched. Lines without a timestamp
 * belong to the entry above; bytes are kept as they are; a file Windows refuses to replace is skipped until
 * the next start. main.js calls this before electron-log writes anything.
 */
const fs = require('fs');
const path = require('path');

const RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const FUTURE_TOLERANCE_MS = DAY_MS;       // a stamp later than this is from a clock ahead of the PC's
const CLOCK_DOUBT_MS = 365 * DAY_MS;      // newest entry older than this: suspect the PC clock, not the log
const TAIL_BYTES = 64 * 1024;
const DESKTOP_LOGS = ['desktop.log', 'desktop.old.log'];
// electron-log format in main.js: "[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}" (local time)
const STAMP = /^\[(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/;

/** When the entry starting on this line was written (local time), or null for a continuation line. */
function entryTime(line) {
  const m = STAMP.exec(line);
  if (!m) return null;
  const [year, month, day, hour, minute, second] = m.slice(1).map(Number);
  const date = new Date(year, month - 1, day, hour, minute, second);
  return date.getMonth() === month - 1 && date.getDate() === day ? date : null;   // rejects 2026-13-45
}

/** Split a Buffer into lines, each keeping its own line ending. */
function splitLines(buffer) {
  const lines = [];
  let start = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    if (buffer[i] === 0x0a) {
      lines.push(buffer.subarray(start, i + 1));
      start = i + 1;
    }
  }
  if (start < buffer.length) lines.push(buffer.subarray(start));
  return lines;
}

const stampOf = (line) => entryTime(line.subarray(0, 32).toString('latin1'));

/**
 * Index of the first line to keep (0: keep everything, lines.length: nothing is recent). `clockTrusted`
 * says whether some log has an entry from the last year; left undefined, it is judged on this file alone.
 */
function firstLineToKeep(lines, now, days = RETENTION_DAYS, clockTrusted = undefined) {
  const cutoff = now.getTime() - days * DAY_MS;
  const ceiling = now.getTime() + FUTURE_TOLERANCE_MS;
  let newest = null;
  for (let i = 0; i < lines.length; i += 1) {
    const stamp = stampOf(lines[i]);
    if (!stamp || stamp.getTime() > ceiling) continue;   // continuation line, or a clock ahead of the PC's
    if (stamp.getTime() >= cutoff) return i;             // first recent entry: the rest was written later
    if (!newest || stamp > newest) newest = stamp;
  }
  if (!newest) return 0;                                  // only future stamps: real age unknown
  const trusted = clockTrusted === undefined ? newest.getTime() >= now.getTime() - CLOCK_DOUBT_MS : clockTrusted;
  return trusted ? lines.length : 0;
}

/** Time of the last entry of `file` that is not stamped in the future (reads the tail only). */
function newestBelievableTime(file, now) {
  const size = fs.statSync(file).size;
  const length = Math.min(size, TAIL_BYTES);
  const tail = Buffer.alloc(length);
  const fd = fs.openSync(file, 'r');
  try {
    fs.readSync(fd, tail, 0, length, size - length);
  } finally {
    fs.closeSync(fd);
  }
  const lines = splitLines(tail);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const stamp = stampOf(lines[i]);
    if (stamp && stamp.getTime() <= now.getTime() + FUTURE_TOLERANCE_MS) return stamp;
  }
  return null;
}

/** Remove the entries older than `days` from `file`; returns the number of lines removed. */
function trimFile(file, now, days = RETENTION_DAYS, clockTrusted = undefined) {
  const lines = splitLines(fs.readFileSync(file));
  const keepFrom = firstLineToKeep(lines, now, days, clockTrusted);
  if (keepFrom === 0) return 0;
  const temporary = `${file}.tmp`;
  try {
    fs.writeFileSync(temporary, Buffer.concat(lines.slice(keepFrom)));
    fs.renameSync(temporary, file);
  } catch (err) {
    try { fs.unlinkSync(temporary); } catch (_) { /* never written */ }
    throw err;
  }
  return keepFrom;
}

/**
 * Apply the retention to Electron's logs in `logsDir`. desktop.log is kept (emptied if nothing recent is
 * left); desktop.old.log is deleted when nothing recent is left.
 * Returns { trimmed: {name: lines removed}, deleted: [names], skipped: [names] }.
 */
function pruneDesktopLogs(logsDir, { now = new Date(), days = RETENTION_DAYS } = {}) {
  const report = { trimmed: {}, deleted: [], skipped: [] };
  const files = DESKTOP_LOGS.map((name) => [name, path.join(logsDir, name)]).filter(([, file]) => fs.existsSync(file));
  // Judge the clock once: an entry from the last year in either log means the clock agrees with the logs.
  let newest = null;
  for (const [, file] of files) {
    try {
      const stamp = newestBelievableTime(file, now);
      if (stamp && (!newest || stamp > newest)) newest = stamp;
    } catch (_) { /* unreadable: judged without it */ }
  }
  const clockTrusted = Boolean(newest) && newest.getTime() >= now.getTime() - CLOCK_DOUBT_MS;
  for (const [name, file] of files) {
    try {
      const removed = trimFile(file, now, days, clockTrusted);
      if (removed && name !== 'desktop.log' && fs.statSync(file).size === 0) {
        fs.unlinkSync(file);
        report.deleted.push(name);
      } else if (removed) {
        report.trimmed[name] = removed;
      }
    } catch (_) {
      report.skipped.push(name);
    }
  }
  return report;
}

/** One log line for a pruning report ('' when nothing was removed or skipped). */
function describe(report, days = RETENTION_DAYS) {
  const parts = Object.keys(report.trimmed).sort().map((name) => `${name}: ${report.trimmed[name]} line(s)`);
  if (report.deleted.length) parts.push(`deleted ${report.deleted.join(', ')}`);
  if (report.skipped.length) parts.push(`in use, retried next start: ${report.skipped.join(', ')}`);
  return parts.length ? `Log retention (${days} days): ${parts.join('; ')}` : '';
}

module.exports = {
  RETENTION_DAYS, entryTime, splitLines, firstLineToKeep, newestBelievableTime, trimFile, pruneDesktopLogs, describe,
};
