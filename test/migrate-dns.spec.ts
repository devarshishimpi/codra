import { describe, expect, it } from "vitest";
import {
  shouldPerformDnsLookup,
  // @ts-expect-error - No declaration file for this script
} from "../packages/db/scripts/migrate-env.mjs";

describe("shouldPerformDnsLookup", () => {
  it("returns true for standard hostnames and domains", () => {
    expect(
      shouldPerformDnsLookup("postgresql://user:pass@localhost:5432/dbname"),
    ).toBe(true);
    expect(
      shouldPerformDnsLookup("postgresql://user:pass@db.neon.tech:5432/dbname"),
    ).toBe(true);
    expect(
      shouldPerformDnsLookup(
        "postgresql://user:pass@postgres.internal:5432/dbname",
      ),
    ).toBe(true);
  });

  it("returns false for Unix domain sockets (percent-encoded libpq path)", () => {
    expect(
      shouldPerformDnsLookup(
        "postgresql://user:pass@%2Fvar%2Frun%2Fpostgresql/dbname",
      ),
    ).toBe(false);
    expect(shouldPerformDnsLookup("postgresql://%2Ftmp/dbname")).toBe(false);
  });

  it("returns false for omitted hosts or query-only socket paths", () => {
    expect(
      shouldPerformDnsLookup("postgresql:///dbname?host=/var/run/postgresql"),
    ).toBe(false);
    expect(shouldPerformDnsLookup("postgresql:///dbname")).toBe(false);
  });

  it("returns false for IPv4 and IPv6 literals", () => {
    expect(
      shouldPerformDnsLookup("postgresql://user:pass@127.0.0.1:5432/dbname"),
    ).toBe(false);
    expect(
      shouldPerformDnsLookup("postgresql://user:pass@10.0.0.5:5432/dbname"),
    ).toBe(false);
    expect(
      shouldPerformDnsLookup("postgresql://user:pass@[::1]:5432/dbname"),
    ).toBe(false);
    expect(
      shouldPerformDnsLookup(
        "postgresql://user:pass@[2001:db8::1]:5432/dbname",
      ),
    ).toBe(false);
  });

  it("returns false for falsy or unparseable inputs", () => {
    expect(shouldPerformDnsLookup("")).toBe(false);
    expect(shouldPerformDnsLookup(undefined)).toBe(false);
    expect(shouldPerformDnsLookup("not a url")).toBe(false);
  });
});
