import { pathToFileURL } from "node:url";
import { requireTestDatabase } from "../../scripts/test-database-guard.mjs";

const refuse = () => {
  throw new Error("Backup/restore tests require one explicit isolated test database connection.");
};

export function backupTestDatabase(env = process.env) {
  const url = new URL(requireTestDatabase(env));
  // libpq can otherwise redirect a -h connection through inherited configuration.
  if (env.PGHOSTADDR || env.PGSERVICE || env.PGSERVICEFILE || env.PGOPTIONS) refuse();
  const password = decodeURIComponent(url.password);
  if (!password || !["127.0.0.1", "localhost"].includes(url.hostname)) refuse();
  return {
    host: url.hostname,
    port: url.port || "5432",
    user: decodeURIComponent(url.username),
    password,
    database: url.pathname.slice(1),
  };
}

export function validateBackupTestTarget(mode, env = process.env) {
  const config = backupTestDatabase(env);
  const prefix = mode === "backup" ? "AYIN_BACKUP_" : "AYIN_RESTORE_";
  if (!["backup", "restore"].includes(mode)) refuse();
  for (const [suffix, expected] of Object.entries({
    PGHOST: config.host,
    PGPORT: config.port,
    PGUSER: config.user,
    PGPASSWORD: config.password,
  })) {
    if (env[prefix + suffix] !== expected) refuse();
  }
  const database = env[prefix + (mode === "backup" ? "PGDATABASE" : "DATABASE")];
  const pattern =
    mode === "backup" ? /^ayin_backup_[a-z0-9_]{1,48}$/ : /^ayin_restore_[a-z0-9_]{1,48}$/;
  if (!pattern.test(database || "")) refuse();
  if (mode === "restore" && env.AYIN_RESTORE_ADMIN_DATABASE !== config.database) refuse();
  return config;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv[2] === "connection") {
      // Captured privately by the shell; never include this output in logs/artifacts.
      process.stdout.write(JSON.stringify(backupTestDatabase()));
    } else {
      validateBackupTestTarget(process.argv[2]);
    }
  } catch {
    console.error("Backup/restore tests require one explicit isolated test database connection.");
    process.exitCode = 1;
  }
}
