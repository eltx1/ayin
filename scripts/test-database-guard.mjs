// Destructive test suites must never infer their database from application config.
// This allowlist is deliberately limited to disposable loopback PostgreSQL.
export function requireTestDatabase(env = process.env) {
  const fail = () => {
    throw new Error(
      "Destructive tests require APP_ENV=test and an explicit loopback TEST_DATABASE_URL " +
        "for an ayin_test/ayin_e2e database and dedicated test role; DATABASE_URL must match.",
    );
  };
  if (env.APP_ENV !== "test" || !env.TEST_DATABASE_URL) fail();
  let url;
  try {
    url = new URL(env.TEST_DATABASE_URL);
  } catch {
    fail();
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    !/^\/ayin_(?:test|e2e)(?:_[a-z0-9_]+)?$/.test(url.pathname) ||
    !["ayin", "ayin_test", "ayin_e2e"].includes(url.username) ||
    url.hash ||
    (env.DATABASE_URL && env.DATABASE_URL !== env.TEST_DATABASE_URL)
  )
    fail();
  // libpq-compatible clients can override connection coordinates via query options.
  for (const key of url.searchParams.keys()) {
    if (!["schema", "connection_limit", "pool_timeout", "connect_timeout", "sslmode"].includes(key))
      fail();
  }
  return env.TEST_DATABASE_URL;
}
