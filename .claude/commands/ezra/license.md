---
tier: admin
name: ezra:license
description: "License management for EZRA — status, activate, deactivate, features"
---

# /ezra:license

Manage your EZRA license tier.

## Subcommands

### status
Show current license tier, validity, and available features.

### activate <key>
Activate a license key. Key format: `ezra_pro_XXXXXXXX`, `ezra_team_XXXXXXXX`, or `ezra_ent_XXXXXXXX`.

### deactivate
Deactivate current license and revert to Core tier.

### features
List all features with their required tier and current availability.

### upgrade
Show upgrade options and pricing.

### refresh
Clear cached license data, forcing revalidation on next check.

## Tiers

| Tier | Price | Key Required |
|------|-------|-------------|
| Core | Free | No |
| Pro | $29/user/mo | Yes |
| Team | $59/user/mo | Yes |
| Enterprise | Custom | Yes |

## Notes
- Core tier is free forever — no license check, no phone-home, no telemetry.
- Pro/Team validation uses a local cache (30-day expiry).
- Actual validation is handled by ezra-cloud (separate service).
