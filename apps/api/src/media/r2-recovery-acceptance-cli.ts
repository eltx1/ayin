import { r2RecoveryAcceptanceExitCode, runR2RecoveryAcceptance } from "./r2-recovery-acceptance.js";

const args = process.argv.slice(2);
if (args.some((argument) => argument !== "--cleanup-owned-fixtures") || args.length > 1) {
  process.stderr.write("Unsupported acceptance argument. No provider request was made.\n");
  process.exitCode = 1;
} else {
  const report = await runR2RecoveryAcceptance(process.env, {
    cleanupOwnedFixtures: args.includes("--cleanup-owned-fixtures"),
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = r2RecoveryAcceptanceExitCode(report.status);
}
