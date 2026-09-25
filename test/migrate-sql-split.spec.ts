import { describe, expect, it } from "vitest";
// @ts-expect-error - No declaration file for this script
import {
  readDollarQuoteTag,
  splitSqlStatements,
} from "../packages/db/scripts/migrate-sql-split.mjs";

describe("readDollarQuoteTag", () => {
  it("reads the bare $$ tag", () => {
    expect(readDollarQuoteTag("$$", 0)).toBe("$$");
  });

  it("reads a named tag like $tag$", () => {
    expect(readDollarQuoteTag("$tag$", 0)).toBe("$tag$");
  });

  it("returns null when there is no closing $", () => {
    expect(readDollarQuoteTag("$tag", 0)).toBeNull();
  });

  it("returns null when the index is not a $", () => {
    expect(readDollarQuoteTag("abc", 0)).toBeNull();
  });
});

describe("splitSqlStatements", () => {
  it("splits plain statements on semicolons", () => {
    expect(splitSqlStatements("SELECT 1; SELECT 2;")).toEqual([
      "SELECT 1",
      "SELECT 2",
    ]);
  });

  it("ignores a semicolon inside a single-quoted string literal", () => {
    const statements = splitSqlStatements(
      "INSERT INTO t (v) VALUES ('a;b'); SELECT 1;",
    );
    expect(statements).toEqual([
      "INSERT INTO t (v) VALUES ('a;b')",
      "SELECT 1",
    ]);
  });

  it("ignores a semicolon inside a $$...$$ dollar-quoted body", () => {
    const sql = `
      CREATE FUNCTION f() RETURNS void LANGUAGE sql AS $$
        SELECT 1; SELECT 2;
      $$;
      SELECT 3;
    `;
    const statements = splitSqlStatements(sql);
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain("SELECT 1; SELECT 2;");
    expect(statements[1]).toBe("SELECT 3");
  });

  it("ignores a semicolon inside a tagged $tag$...$tag$ dollar-quoted body", () => {
    const sql = `
      CREATE FUNCTION pg_temp.f(x jsonb) RETURNS jsonb LANGUAGE sql AS $tag$
        SELECT CASE WHEN x #>> '{}' = 'a;b' THEN x ELSE x END;
      $tag$;
      SELECT 1;
    `;
    const statements = splitSqlStatements(sql);
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain("'a;b'");
    expect(statements[1]).toBe("SELECT 1");
  });

  it("does not close a tagged dollar-quote on a bare $$", () => {
    const sql = "SELECT $tag$ literal $$ still inside $tag$; SELECT 2;";
    const statements = splitSqlStatements(sql);
    expect(statements).toHaveLength(2);
    expect(statements[0]).toBe("SELECT $tag$ literal $$ still inside $tag$");
    expect(statements[1]).toBe("SELECT 2");
  });

  it("ignores semicolons inside line and block comments", () => {
    const sql = `
      -- comment with a ; semicolon
      SELECT 1; /* block ; comment */ SELECT 2;
    `;
    const statements = splitSqlStatements(sql);
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain("-- comment with a ; semicolon");
    expect(statements[0]).toContain("SELECT 1");
    expect(statements[1]).toBe("/* block ; comment */ SELECT 2");
  });

  it("drops empty statements produced by trailing whitespace or semicolons", () => {
    expect(splitSqlStatements("SELECT 1;;  ;")).toEqual(["SELECT 1"]);
  });
});
