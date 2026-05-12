---
tier: admin
name: ezra:compliance
description: "Manage compliance profiles — ISO 25010, OWASP, SOC2, HIPAA, PCI-DSS, GDPR, WCAG. Activate profiles to auto-configure standards and security rules."
---

# EZRA Compliance — Profile Manager

You are managing compliance profiles. Profiles map to predefined sets of standards and security rules that get merged into EZRA settings when activated.

## Subcommands

Parse the user input to determine which subcommand they want. If no subcommand is given, default to listing profiles.

### list (default)

Display all available compliance profiles with activation status:

```
EZRA COMPLIANCE PROFILES
========================================
Profile         Status      Rules
----------------------------------------
iso-25010       inactive    24 rules
owasp-2025      inactive    10 rules
soc2            inactive    15 rules
hipaa           inactive    12 rules
pci-dss         inactive    14 rules
gdpr            inactive    11 rules
wcag-aa         inactive     8 rules
========================================
Active: 0 of 7 profiles
```

### activate <profile>

Activate a compliance profile:

1. Validate the profile name exists
2. Load current settings
3. Merge the profile rules into standards and security custom_rules
4. Mark the profile as active in .ezra/compliance-state.yaml
5. Write updated settings
6. Confirm activation with list of added rules

### deactivate <profile>

Deactivate a compliance profile:

1. Validate the profile is currently active
2. Load current settings
3. Remove the profile rules from standards and security custom_rules
4. Mark the profile as inactive in .ezra/compliance-state.yaml
5. Write updated settings
6. Confirm deactivation

### check

Run compliance check against active profiles:

1. Load all active profiles
2. For each profile, verify all required rules are present in settings
3. Check if any required rules have been overridden or removed
4. Report compliance status per profile

Output format:
```
COMPLIANCE CHECK
========================================
Profile: owasp-2025
  [PASS] SQL injection prevention
  [PASS] XSS protection
  [PASS] CSRF token validation
  ...
Status: COMPLIANT (10/10 rules met)
========================================
```

### report

Generate a comprehensive compliance report:

1. Show all profiles (active and inactive)
2. For active profiles, run full compliance check
3. Summarize gaps and recommendations
4. Include remediation steps for any failures

## Built-in Profiles

### iso-25010 — Software Quality Model
Quality characteristics: functionality, reliability, usability, efficiency, maintainability, portability.
Maps to standards rules for code quality, test coverage, documentation, and architecture.

### owasp-2025 — OWASP Top 10 2025
Security rules: injection prevention, broken authentication, sensitive data exposure, XXE, broken access control,
security misconfiguration, XSS, insecure deserialization, known vulnerabilities, insufficient logging.
Maps to security custom_rules.

### soc2 — Trust Services Criteria
Criteria: security, availability, processing integrity, confidentiality, privacy.
Maps to both standards and security rules.

### hipaa — Health Data Protection
Rules: access controls, audit trails, encryption, data integrity, transmission security,
PHI minimum necessary, breach notification, BAA requirements, disposal procedures,
risk assessment, workforce training, facility security.
Maps to security custom_rules.

### pci-dss — Payment Card Data
Rules: firewall configuration, no vendor defaults, protect stored data, encrypt transmission,
antivirus, secure systems, restrict access, unique IDs, restrict physical access,
track and monitor, test security, information security policy, key management, input validation.
Maps to security custom_rules.

### gdpr — EU Data Protection
Rules: lawful processing, purpose limitation, data minimisation, accuracy,
storage limitation, integrity and confidentiality, accountability,
data protection by design, DPIA requirement, breach notification, DPO requirement.
Maps to both standards and security rules.

### wcag-aa — Web Accessibility
Rules: text alternatives, time-based media alternatives, adaptable content,
distinguishable content, keyboard accessible, enough time, seizures and physical reactions,
navigable content.
Maps to standards custom_rules.

## Suggested Next Steps

After a compliance check, suggest:
- Run `/ezra:scan --preset security-deep` to verify security compliance
- Run `/ezra:settings` to review and adjust enforcement rules
- Run `/ezra:health` for overall governance health
