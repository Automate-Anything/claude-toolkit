---
name: standard-data-privacy-compliance
description: "Standard 25 of the engineering standards library: data privacy and regulatory compliance. Covers data classification levels, what counts as PII and how to handle it, consent management, data subject rights (access, deletion, portability, correction) under GDPR and CCPA, retention and deletion policy, the regulatory framework reference (GDPR, CCPA, HIPAA and others), privacy by design principles, and breach notification. Read it BEFORE storing, processing, exporting, logging or sharing any personal data, before building signup, consent, cookie banners, account deletion, data export, or analytics, and when the user says \"PII\", \"personal data\", \"GDPR\", \"CCPA\", \"HIPAA\", \"consent\", \"cookie banner\", \"right to be forgotten\", \"delete my data\", \"data retention\", \"privacy policy\", \"data breach\", or \"are we compliant\"."
---

# Data Privacy and Compliance

## PHILOSOPHY
Privacy is not a feature. It is a right. Build it into the architecture from day one. Retrofitting privacy compliance costs 10x more and risks catastrophic fines.

## 1. DATA CLASSIFICATION

Every piece of data in your system belongs to one of these levels:

| Level | Classification | Examples | Handling |
|-------|---------------|----------|----------|
| **PUBLIC** | Safe to share openly | Marketing copy, public profiles, product names | No restrictions |
| **INTERNAL** | Business-sensitive | Internal docs, analytics, non-PII metadata | Access control |
| **CONFIDENTIAL** | Personal / sensitive | Names, emails, phone numbers, addresses | Encrypted, access-logged |
| **RESTRICTED** | Highly sensitive | Passwords, payment data, health records, government IDs | Encrypted at rest + transit, strict audit, minimal retention |

### Rules:
- Classify ALL data before storing it
- Each classification level has different storage, access, and retention rules
- When in doubt, classify UP (treat as more sensitive)
- Document classification in your data model/schema

## 2. PII (PERSONALLY IDENTIFIABLE INFORMATION)

### What Counts as PII:
- Full name, email address, phone number
- Physical address, IP address, geolocation
- Date of birth, government ID numbers (SSN, passport)
- Financial data (bank accounts, credit cards)
- Health/medical data
- Biometric data (fingerprints, face scans)
- Religious, ethnic, political, or sexual orientation data
- Login credentials
- Device identifiers tied to a person

### PII Handling Rules:
- Collect ONLY what you need (data minimization)
- Store with encryption at rest
- Transmit only over TLS/HTTPS
- Log access to PII fields (audit trail)
- Define retention period. Delete when no longer needed.
- Never expose PII in URLs, logs, error messages, or analytics

## 3. CONSENT MANAGEMENT

### When You Need Consent:
- Collecting personal data
- Using data for purposes beyond what was originally collected for
- Sharing data with third parties
- Sending marketing communications
- Setting non-essential cookies or tracking

### Implementation:
- Cookie consent banner (before setting non-essential cookies)
- Privacy policy link on every page
- Clear opt-in for marketing (not pre-checked boxes)
- Record consent: WHO consented, to WHAT, WHEN, and HOW
- Allow withdrawal of consent at any time
- Separate consent per purpose (do not bundle)

## 4. DATA SUBJECT RIGHTS (GDPR / CCPA / Global)

Build systems to handle these requests within 30 days:

| Right | Description | Implementation |
|-------|------------|----------------|
| **Access** | User can request all data you hold about them | Export user data as JSON/CSV |
| **Rectification** | User can request correction of inaccurate data | Edit profile, contact support |
| **Erasure** | User can request deletion ("right to be forgotten") | Delete or anonymize all user data |
| **Portability** | User can request data in machine-readable format | Export as JSON/CSV download |
| **Objection** | User can object to certain processing | Opt-out mechanisms |
| **Restriction** | User can request limitation of processing | Flag account, stop processing |

### Technical Requirements:
- User data export endpoint (all data associated with a user ID)
- User data deletion endpoint (cascade delete or anonymize)
- Audit trail of data access and modifications
- Ability to locate ALL data for a given user across all systems

## 5. DATA RETENTION & DELETION

### Define Retention Periods Per Data Type:
| Data | Retention | After Expiry |
|------|-----------|-------------|
| Active user account data | While account is active + 30 days after deletion request | Hard delete or anonymize |
| Transaction records | Per legal requirement (often 7 years) | Archive, then delete |
| Access logs | 90 days | Auto-delete |
| Security logs | 1 year minimum | Archive |
| Marketing consent records | Duration of consent + 3 years | Archive |
| Session data | 24 hours after expiry | Auto-delete |
| Temporary files | 24 hours | Auto-delete |

### Deletion Rules:
- "Delete" means permanently remove OR irreversibly anonymize
- Cascade deletion: when a user is deleted, ALL their data is deleted
- Backup data: also purge from backups or document that backup retention is separate
- Third parties: request deletion from any third party the data was shared with

## 6. REGULATORY FRAMEWORK REFERENCE

| Regulation | Region | Key Requirements |
|-----------|--------|-----------------|
| **GDPR** | EU/EEA | Consent, data rights, DPO, 72-hour breach notification, fines up to 4% global revenue |
| **CCPA/CPRA** | California, USA | Right to know, delete, opt-out of sale, non-discrimination |
| **HIPAA** | USA (healthcare) | PHI protection, access controls, audit trails, BAA agreements |
| **PCI-DSS** | Global (payments) | Cardholder data protection, network security, vulnerability management |
| **SOC 2** | Global (SaaS) | Security, availability, processing integrity, confidentiality, privacy |
| **LGPD** | Brazil | Similar to GDPR, requires DPO, consent-based |
| **POPIA** | South Africa | Consent, purpose limitation, data minimization |
| **PIPEDA** | Canada | Consent, limited collection, accuracy, safeguards |

### Implementation Approach:
- Identify which regulations apply to YOUR users and YOUR data
- Start with GDPR compliance (most comprehensive, covers most requirements)
- Layer additional requirements as needed (PCI-DSS for payments, HIPAA for health)

## 7. PRIVACY BY DESIGN PRINCIPLES

1. **Proactive**: Prevent privacy issues before they occur
2. **Default**: Privacy is the default setting (opt-in, not opt-out)
3. **Embedded**: Privacy built into the architecture, not bolted on
4. **Positive-Sum**: Full functionality AND full privacy (not either/or)
5. **End-to-End**: Protection through the entire data lifecycle
6. **Visibility**: Keep it open and transparent to users
7. **User-Centric**: User interests first in every design decision

## 8. BREACH NOTIFICATION

If a data breach occurs:
- Assess scope and severity within 24 hours
- Notify regulatory authorities within 72 hours (GDPR requirement)
- Notify affected users without undue delay
- Document: what data was exposed, how many users, what you are doing about it
- Preserve evidence for investigation
- Implement remediation measures

## IMPLEMENTATION REQUIREMENT
Every project handling user data must classify that data, implement appropriate protections per classification level, honor data subject rights, and have a documented breach response plan. Privacy is not optional. It is architecture.

## RELATED SKILLS

- `standard-audit-ready-code`: the encryption, logging and deletion requirements auditors check.
- `standard-security-fortress`: the security controls that protect the data.
- `apple-app-store-submission`: Apple's account deletion and privacy label rules.
- `security-rls-permissions`: tenant isolation at the database layer.
