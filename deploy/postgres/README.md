# AYIN PostgreSQL operations

Production bootstrap remains in `bootstrap-local-production.sh`.

Task 44 backup/recovery tooling:

- `backup-production.sh` — daily encrypted, remotely verified logical backup;
- `restore-drill.sh` — guarded non-production restore verification;
- `install-backup-timer.sh` — installs the hardened daily systemd timer;
- `test-backup-restore.sh` — isolated CI acceptance drill using synthetic data only;
- `systemd/` — production service/timer units.

Operational policy, RPO/RTO, retention, key custody and recovery steps are documented in `docs/TASK44_BACKUP_RESTORE.md`.
