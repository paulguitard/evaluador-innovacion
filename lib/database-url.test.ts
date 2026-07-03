import { describe, expect, it } from "vitest";
import { normalizeDatabaseUrl } from "./database-url";

describe("normalizeDatabaseUrl", () => {
  it("encodes ampersands in password", () => {
    const raw =
      "postgresql://postgres.whbpuajsivmedsuxnyox:&WC&FqbqjVq2Yqi@aws-1-sa-east-1.pooler.supabase.com:6543/postgres";
    expect(normalizeDatabaseUrl(raw)).toBe(
      "postgresql://postgres.whbpuajsivmedsuxnyox:%26WC%26FqbqjVq2Yqi@aws-1-sa-east-1.pooler.supabase.com:6543/postgres"
    );
  });

  it("leaves already-encoded passwords unchanged", () => {
    const encoded =
      "postgresql://user:%26WC%26FqbqjVq2Yqi@host.supabase.com:6543/postgres";
    expect(normalizeDatabaseUrl(encoded)).toBe(encoded);
  });
});
