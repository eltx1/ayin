# Task 44 implementation boundary

Task 44 adds recovery tooling and automation only. It does not move the production PostgreSQL server, enable WAL archiving, copy production data into CI, expose the backup bucket publicly, or automatically perform a production database cutover.

Production backup scheduling becomes active only after operations provision `/home/ayin/env/backup.env`, create the dedicated private backup bucket/credentials, install the systemd timer, run an initial verified backup, and complete a real non-production restore drill.
