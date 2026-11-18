import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Business ids are UUID strings. `Number("0285e8f8-…")` is NaN and `parseInt` of the same is 285, so
 * coercing an id sends null or a wrong id to the server (or never matches when compared). This reads the
 * source and fails on any parseInt()/Number() whose argument is an id.
 */
const SRC = path.resolve(__dirname, "../..");
const COERCION = /\b(?:parseInt|Number)\(\s*([\w.?!]+)\s*[,)]/g;
const LOOKS_LIKE_ID = /(^|[.?!])id$|Id$|_id$|^vid$/;

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

function idCoercions(source: string): string[] {
  return [...source.matchAll(COERCION)].filter((m) => LOOKS_LIKE_ID.test(m[1])).map((m) => m[0]);
}

describe("ids are never coerced to numbers", () => {
  it("finds no parseInt()/Number() on an id in the application source", () => {
    const found = sourceFiles(SRC).flatMap((file) =>
      idCoercions(fs.readFileSync(file, "utf8")).map((call) => `${path.relative(SRC, file)}: ${call}`),
    );
    expect(found).toEqual([]);
  });

  it("recognises the calls that were wrong", () => {
    expect(idCoercions("list.find((b) => b.id === parseInt(savedId, 10))")).toEqual(["parseInt(savedId,"]);
    expect(idCoercions("branch: branchId ? Number(branchId) : null")).toEqual(["Number(branchId)"]);
    expect(idCoercions("variant: Number(vid), q: 1")).toEqual(["Number(vid)"]);
    expect(idCoercions("supplier: parseInt(supplierId)")).toEqual(["parseInt(supplierId)"]);
    expect(idCoercions("x = Number(row.id)")).toEqual(["Number(row.id)"]);
  });

  it("leaves amounts and quantities alone", () => {
    expect(idCoercions("Number(sale.amount_paid); parseInt(quantity); Number(valid); parseInt(paid, 10)")).toEqual([]);
  });
});
