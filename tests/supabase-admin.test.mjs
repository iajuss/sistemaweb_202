import assert from "node:assert/strict";
import test from "node:test";

test("lança erro claro se SUPABASE_SERVICE_ROLE_KEY não está definida", async () => {
  const original = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    const { createSupabaseAdminClient } = await import("../lib/supabase/admin.ts?semkey");
    assert.throws(() => createSupabaseAdminClient(), /SUPABASE_SERVICE_ROLE_KEY/);
  } finally {
    if (original !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = original;
  }
});
