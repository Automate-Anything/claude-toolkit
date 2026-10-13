---
name: standard-backup-disaster-recovery
description: "Standard 22 of the engineering standards library: backups and disaster recovery. Covers the 3-2-1 rule, what to back up and what not to, backup schedules and retention, backup verification (an untested backup is not a backup), RPO and RTO targets, disaster scenarios with prevention and recovery, backup and restore commands for MySQL, PostgreSQL, MongoDB and SQLite, automated backup setup and monitoring, and the incident response checklist. Read it BEFORE setting up backups, choosing retention, planning recovery objectives, writing a restore procedure, or designing for a region or server failure, and when the user says \"backup\", \"restore\", \"disaster recovery\", \"DR plan\", \"RPO\", \"RTO\", \"point-in-time recovery\", \"we lost data\", or \"what happens if the database dies\"."
---

# Backup and Disaster Recovery: data protection

> **Agent rule.** Restore commands overwrite data. An agent never runs a restore, a destructive
> database command, or anything against production data on its own initiative. Test restores go to
> an isolated environment, and only when the owner asks. Before any database write, pull the live
> schema and verify against it.

## PHILOSOPHY
Data loss is permanent. Hardware fails. Humans make mistakes. Attacks happen. The only question is: when disaster strikes, how fast can you recover?

## 1. BACKUP STRATEGY (3-2-1 RULE)

- **3** copies of data (original + 2 backups)
- **2** different storage types (local + cloud, or different cloud regions)
- **1** copy offsite (geographically separate from primary)

## 2. WHAT TO BACKUP

### ALWAYS Backup:
- Database (full dump + incremental/WAL)
- User-uploaded files and media
- Application configuration (encrypted)
- SSL certificates and keys
- Environment-specific configs
- Scheduled job definitions (cron, scheduled tasks)

### Version-Controlled (Git = your backup):
- Application source code
- Infrastructure-as-code definitions
- CI/CD pipeline configurations
- Documentation

### DO NOT Backup:
- Dependencies (node_modules, vendor, venv). Reinstall from lockfile.
- Build artifacts (dist, build). Rebuild from source.
- Cache files. Regenerated automatically.
- Log files (archive separately with different retention)

## 3. BACKUP SCHEDULE

| Data Type | Frequency | Retention | Method |
|-----------|-----------|-----------|--------|
| Database (full) | Daily | 30 days | Automated dump |
| Database (incremental) | Hourly | 7 days | WAL/binlog shipping |
| Database (transaction log) | Continuous | 7 days | Point-in-time recovery |
| User uploads | Daily | 90 days | File sync/snapshot |
| Config/secrets | On change | 90 days | Encrypted backup |
| Full system snapshot | Weekly | 4 weeks | VM/container snapshot |

## 4. BACKUP VERIFICATION (CRITICAL)

**An untested backup is not a backup.**

- Test restore from backup at least monthly
- Verify data integrity after restore (row counts, checksums)
- Document the exact restore procedure step by step
- Time the restore process (know your Recovery Time Objective)
- Test in an isolated environment (never restore to production accidentally)

## 5. DISASTER RECOVERY OBJECTIVES

### Recovery Point Objective (RPO)
"How much data can we afford to lose?"
- Critical systems: < 1 hour (use continuous replication)
- Standard systems: < 24 hours (daily backups)
- Low priority: < 1 week

### Recovery Time Objective (RTO)
"How fast must we be back online?"
- Critical systems: < 1 hour
- Standard systems: < 4 hours
- Low priority: < 24 hours

## 6. DISASTER SCENARIOS & RESPONSES

| Scenario | Prevention | Recovery |
|----------|-----------|----------|
| Accidental data deletion | Soft deletes, confirmation dialogs, RBAC | Restore from backup (point-in-time) |
| Database corruption | Replication, checksums | Restore from last clean backup |
| Server failure | Redundancy, auto-scaling | Failover to standby, redeploy |
| Ransomware/attack | Network segmentation, patching, backups | Restore from clean offsite backup |
| Region outage | Multi-region deployment | DNS failover to secondary region |
| Credential compromise | Rotation, MFA, monitoring | Revoke all keys, rotate, audit logs |
| Developer error (bad deploy) | CI/CD gates, staging testing | Rollback to previous version |

## 7. DATABASE BACKUP COMMANDS

### MySQL
```bash
# Full backup
mysqldump --single-transaction --routines --triggers --all-databases > backup.sql

# Restore
mysql < backup.sql
```

### PostgreSQL
```bash
# Full backup
pg_dump -Fc database_name > backup.dump

# Restore
pg_restore -d database_name backup.dump
```

### MongoDB
```bash
# Full backup
mongodump --out /backup/path

# Restore
mongorestore /backup/path
```

### SQLite
```bash
# Just copy the file
cp database.sqlite database.sqlite.backup
```

### Any Database via Framework:
- Use framework-provided backup tools when available
- Ensure backups include schema + data + indexes + constraints

## 8. AUTOMATED BACKUP SETUP

### Principles:
- Backups run automatically on schedule (cron, scheduled tasks, cloud functions)
- Backup scripts verify success and report failures
- Failed backups trigger alerts immediately
- Backup files are encrypted at rest
- Backup storage has access controls (not publicly readable)
- Old backups are automatically purged based on retention policy

### Monitoring:
- Alert if no backup completed in expected timeframe
- Alert if backup size deviates significantly (indicates corruption or data loss)
- Track backup duration (increasing time may indicate growing data issues)

## 9. INCIDENT RESPONSE CHECKLIST

When disaster strikes:
1. **Assess**: What is affected? How severe? When did it start?
2. **Contain**: Stop the bleeding (take affected systems offline if needed)
3. **Communicate**: Notify stakeholders and users (status page)
4. **Recover**: Execute the documented recovery procedure
5. **Verify**: Confirm data integrity and system functionality
6. **Document**: Post-incident report (what happened, why, how to prevent)

## IMPLEMENTATION REQUIREMENT
Every project has automated backups from day one. Every backup is tested. Every team member knows the recovery procedure. You do not get a second chance with data loss.

## RELATED SKILLS

- `standard-incident-management`: severity levels, postmortems, runbooks.
- `standard-database-design`: schema, migrations, soft deletes.
- `standard-infrastructure-as-code`: rebuilding the infrastructure from code.
