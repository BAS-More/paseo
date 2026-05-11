# Change Management Process

**Effective:** 2026-05-11
**Owner:** Platform team
**Review cadence:** Quarterly

## Code changes

All code changes follow this process:

1. **Branch**: Create feature branch from `main`
2. **Develop**: Implement with tests (TDD preferred)
3. **Pre-commit checks**: Lefthook enforces oxlint, oxfmt, tsgo typecheck
4. **Pull request**: Open PR against `main` with description of changes
5. **CI gates**: All must pass before merge:
   - `npm audit --prod --audit-level high`
   - Format check (oxfmt)
   - Lint check (oxlint)
   - Type check (tsgo across all 8 workspaces)
   - Server tests (vitest on ubuntu-latest)
   - Windows server tests
6. **Review**: Required before merge for changes touching auth, security, or shared modules
7. **Merge**: Squash merge to `main`

## Deployment

Automated via `.github/workflows/deploy-docker.yml`:

1. **Audit**: `npm audit --prod --audit-level high`
2. **Build**: Docker multi-stage build, push to GHCR
3. **Deploy**: SSH pull + `docker compose up -d`
4. **Smoke test**: `curl /health/live` with 5 retries
5. **Rollback**: Automatic revert to previous image on smoke failure

## Rollback procedure

- Automatic: CI smoke test failure triggers rollback
- Manual: `docker compose down && docker tag $PREVIOUS_IMAGE paseo-daemon:latest && docker compose up -d`

## Emergency changes

For critical security patches:

1. Create hotfix branch from `main`
2. Implement fix with test
3. Fast-track review (1 reviewer minimum)
4. Deploy immediately after merge
5. Post-incident review within 48 hours
