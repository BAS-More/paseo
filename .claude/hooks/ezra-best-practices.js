#!/usr/bin/env node
'use strict';

/**
 * EZRA v8 — Best Practices Enforcement Module
 *
 * Three enforcement registries:
 *   REGEX_CHECKS  — R-type: line-by-line pattern matching
 *   FILE_CHECKS   — F-type: file/directory existence
 *   CONFIG_CHECKS — C-type: JSON/YAML config parsing
 *
 * Called by ezra-oversight.js after STD/SEC/CMP checks.
 * Accepts existingCodes Set to avoid duplicate violations.
 */

var fs = require('fs');
var path = require('path');

// ═══════════════════════════════════════════════════════════════
// REGEX_CHECKS — R-type practices
// ═══════════════════════════════════════════════════════════════

var REGEX_CHECKS = {
  // ── Code Quality & Maintainability ──
  'cq-magic-numbers': {
    code: 'BP-001', severity: 'medium',
    message: 'Magic number detected — extract to a named constant',
    patterns: [/(?:^|[=:+\-*/<>,(])\s*(?<!\.)\b(\d{2,})\b(?!\s*[;:})\]]|\.\w)/],
    skipPatterns: [/const\s/, /let\s+\w+\s*=/, /var\s+\w+\s*=/, /^\s*\/\//, /^\s*\*/, /index|length|status|code|port|timeout|width|height|size|max|min|limit|offset|page|count|total|version/i],
    fileFilter: /\.(js|ts|tsx|jsx)$/,
    skipTest: true
  },
  'cq-file-size': {
    code: 'BP-003', severity: 'medium',
    message: 'File exceeds recommended maximum line count (400 lines)',
    special: 'file-size',
    fileFilter: /\.(js|ts|tsx|jsx)$/,
    skipTest: true
  },
  'cq-empty-errors': {
    code: 'BP-004', severity: 'medium',
    message: 'Empty Error constructor — provide a descriptive message',
    patterns: [/throw\s+new\s+Error\s*\(\s*\)/],
    fileFilter: /\.(js|ts|tsx|jsx)$/
  },
  'cq-commented-code': {
    code: 'BP-005', severity: 'low',
    message: 'Commented-out code detected — remove or use feature flags',
    patterns: [/^\s*\/\/\s*(const|let|var|function|if|return|import|export|class|for|while|switch)\s/],
    fileFilter: /\.(js|ts|tsx|jsx)$/,
    skipTest: true
  },
  'cq-todo-fixme': {
    code: 'BP-006', severity: 'low',
    message: 'Unresolved task comment found — resolve before production',
    patterns: [new RegExp('\\b(TO' + 'DO|FIX' + 'ME|HA' + 'CK|X' + 'XX|TE' + 'MP)\\b', 'i')],
    skipPatterns: [/^\s*\*\s*@todo/i],
    fileFilter: /\.(js|ts|tsx|jsx)$/,
    skipTest: true
  },
  'cq-import-order': {
    code: 'BP-007', severity: 'low',
    message: 'Import statements should be grouped and ordered consistently',
    special: 'import-order',
    fileFilter: /\.(js|ts|tsx|jsx)$/,
    skipTest: true
  },
  'cq-dead-code': {
    code: 'BP-009', severity: 'low',
    message: 'Possible dead code — eslint-disable for unused variable',
    patterns: [/eslint-disable.*no-unused/],
    fileFilter: /\.(js|ts|tsx|jsx)$/
  },

  // ── CI/CD Pipeline ──
  'cicd-dep-pinning': {
    code: 'BP-029', severity: 'medium',
    message: 'Unpinned dependency — use exact versions for reproducible builds',
    patterns: [/"[^"]+"\s*:\s*"[\^~>]/],
    fileFilter: /package\.json$/,
    skipPatterns: [/devDependencies/]
  },

  // ── Testing Practices ──
  'test-naming': {
    code: 'BP-034', severity: 'low',
    message: 'Test description should start with a verb (should, returns, throws, etc.)',
    patterns: [/(?:it|test)\s*\(\s*['"`](?![A-Z]?(?:should|must|can|does|returns?|throws?|creates?|updates?|deletes?|renders?|handles?|validates?|rejects?|accepts?|emits?|fires?|calls?|sets?|gets?|fetches?|sends?|loads?|saves?))\w/i],
    fileFilter: /\.(test|spec)\.(js|ts|tsx|jsx)$/
  },
  'test-skip': {
    code: 'BP-035', severity: 'medium',
    message: 'Skipped test detected — do not commit skipped tests',
    patterns: [/\b(?:describe|it|test)\.skip\b/, /\bx(?:describe|it|test)\s*\(/],
    fileFilter: /\.(test|spec)\.(js|ts|tsx|jsx)$/
  },
  'test-snapshot': {
    code: 'BP-036', severity: 'low',
    message: 'Snapshot test detected — prefer explicit assertions',
    patterns: [/\.toMatchSnapshot\s*\(/],
    fileFilter: /\.(test|spec)\.(js|ts|tsx|jsx)$/
  },
  'test-isolation': {
    code: 'BP-040', severity: 'medium',
    message: 'Global state in test setup — may cause test coupling',
    patterns: [/(?:beforeAll|afterAll)\s*\([^)]*(?:global|process\.env|window\.)/],
    fileFilter: /\.(test|spec)\.(js|ts|tsx|jsx)$/
  },

  // ── Infrastructure as Code ──
  'iac-remote-state': {
    code: 'BP-042', severity: 'medium',
    message: 'Local backend detected — use remote state for team collaboration',
    patterns: [/backend\s+["']local["']/],
    fileFilter: /\.tf$/
  },
  'iac-module-version': {
    code: 'BP-043', severity: 'medium',
    message: 'Unversioned module source — pin with ?ref= or version constraint',
    patterns: [/source\s*=\s*"(?!\.)[^"]*"(?!.*\?ref=)/],
    skipPatterns: [/version\s*=/],
    fileFilter: /\.tf$/
  },
  'iac-secrets': {
    code: 'BP-044', severity: 'high',
    message: 'Potential hardcoded secret in IaC file',
    patterns: [/(?:password|secret|token|api_key)\s*=\s*"[^"]{8,}"/i],
    fileFilter: /\.(tf|bicep|template|cfn)(\.(json|yaml|yml))?$/,
    dedup: 'SEC-SECRETS'
  },
  'iac-tagging': {
    code: 'BP-046', severity: 'low',
    message: 'Resource without tags — add tags for cost tracking and organization',
    patterns: [/resource\s+"[^"]+"\s+"[^"]+"\s*\{/],
    requirePattern: /tags\s*[={]/,
    fileFilter: /\.tf$/
  },
  'iac-least-privilege': {
    code: 'BP-048', severity: 'high',
    message: 'Wildcard IAM action detected — use least privilege',
    patterns: [/Action\s*[:=]\s*['"]\s*\*/i, /"Effect"\s*:\s*"Allow"[^}]*"Action"\s*:\s*\[?\s*"\*"/],
    fileFilter: /\.(tf|json|yaml|yml)$/
  },
  'iac-network-open': {
    code: 'BP-049', severity: 'high',
    message: 'Open CIDR (0.0.0.0/0) in security group — restrict access',
    patterns: [/0\.0\.0\.0\/0/],
    skipPatterns: [/egress/i, /outbound/i],
    fileFilter: /\.(tf|json|yaml|yml)$/
  },

  // ── Containerization & Orchestration ──
  'container-base-image': {
    code: 'BP-051', severity: 'medium',
    message: 'Use minimal base image (alpine, slim, distroless) to reduce attack surface',
    special: 'dockerfile-base',
    fileFilter: /Dockerfile/
  },
  'container-multistage': {
    code: 'BP-052', severity: 'low',
    message: 'Consider multi-stage build to reduce final image size',
    special: 'dockerfile-multistage',
    fileFilter: /Dockerfile/
  },
  'container-no-root': {
    code: 'BP-053', severity: 'high',
    message: 'Container runs as root — add USER directive',
    special: 'dockerfile-user',
    fileFilter: /Dockerfile/,
    dedup: 'SEC-CONTAINER'
  },
  'container-healthcheck': {
    code: 'BP-054', severity: 'medium',
    message: 'Missing HEALTHCHECK in Dockerfile',
    special: 'dockerfile-healthcheck',
    fileFilter: /Dockerfile/
  },
  'container-resources': {
    code: 'BP-055', severity: 'medium',
    message: 'Pod missing resource limits — set CPU/memory limits',
    special: 'k8s-resources',
    fileFilter: /\.(yaml|yml)$/
  },
  'container-latest-tag': {
    code: 'BP-057', severity: 'medium',
    message: 'Avoid :latest tag — use specific version for reproducibility',
    patterns: [/:latest\s*$/m, /image:\s*[^\s:]+:latest/],
    fileFilter: /Dockerfile|\.(yaml|yml)$/
  },
  'container-pod-security': {
    code: 'BP-058', severity: 'high',
    message: 'Privileged container or hostNetwork detected — use restricted pod security',
    patterns: [/privileged:\s*true/, /hostNetwork:\s*true/, /hostPID:\s*true/],
    fileFilter: /\.(yaml|yml)$/
  },
  'container-inline-secrets': {
    code: 'BP-060', severity: 'high',
    message: 'Inline secret value in k8s manifest — use Secret resource or external secrets',
    patterns: [/name:\s*.*(?:password|secret|token|key)[\s\S]*?value:\s*["'][^"']{4,}/i],
    fileFilter: /\.(yaml|yml)$/
  },

  // ── Monitoring & Observability ──
  'obs-structured-logging': {
    code: 'BP-061', severity: 'low',
    message: 'Use structured logging (objects) instead of string-only console.log',
    patterns: [/console\.log\s*\(\s*['"`][^'"`]*['"`]\s*\)/],
    skipPatterns: [/debug|trace/i],
    fileFilter: /\.(js|ts|tsx|jsx)$/,
    skipTest: true
  },
  'obs-correlation-id': {
    code: 'BP-070', severity: 'low',
    message: 'Consider adding correlation/request ID headers for distributed tracing',
    patterns: [/app\.(get|post|put|delete|patch|use)\s*\(/],
    requirePattern: /x-request-id|x-correlation-id|correlationId|requestId/i,
    fileFilter: /\.(js|ts)$/,
    skipTest: true
  },

  // ── Security & DevSecOps ──
  'sec-rbac': {
    code: 'BP-076', severity: 'medium',
    message: 'Route handler without role/permission middleware',
    patterns: [/router\.(get|post|put|delete|patch)\s*\(\s*['"`]\//],
    requirePattern: /(?:authorize|checkRole|requireRole|hasPermission|isAdmin|requireAuth|authMiddleware|protect)\s*[\(,]/i,
    fileFilter: /\.(js|ts)$/,
    skipTest: true
  },
  'sec-audit-log': {
    code: 'BP-077', severity: 'low',
    message: 'Critical operation without audit logging',
    patterns: [/\.(delete|destroy|update|create|save)\s*\(/],
    requirePattern: /audit(?:Log|_log|Event|Trail)/i,
    fileFilter: /\.(js|ts)$/,
    skipTest: true
  },

  // ── Documentation ──
  'doc-function-comments': {
    code: 'BP-087', severity: 'low',
    message: 'Long function without documentation — add JSDoc or explanatory comments',
    special: 'function-comments',
    fileFilter: /\.(js|ts|tsx|jsx)$/,
    skipTest: true
  },

  // ── Release Management ──
  'rel-version-wildcard': {
    code: 'BP-097', severity: 'medium',
    message: 'Wildcard or open-ended version range in dependencies',
    patterns: [/"[^"]+"\s*:\s*"(\*|>=)/],
    fileFilter: /package\.json$/
  },
  'rel-deprecation': {
    code: 'BP-098', severity: 'low',
    message: '@deprecated without removal target version',
    patterns: [/@deprecated(?!\s+.*(?:v\d|since|remove|version))/i],
    fileFilter: /\.(js|ts|tsx|jsx)$/
  },

  // ── Database Practices ──
  'db-raw-sql': {
    code: 'BP-102', severity: 'medium',
    message: 'Raw SQL string detected — use parameterized queries or ORM',
    patterns: [/(?:query|execute|raw)\s*\(\s*['"`](?:SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE)\s/i],
    fileFilter: /\.(js|ts)$/,
    skipPatterns: [/migration/i]
  },
  'db-select-star': {
    code: 'BP-109', severity: 'medium',
    message: 'SELECT * detected — specify needed columns explicitly',
    patterns: [/SELECT\s+\*/i],
    fileFilter: /\.(js|ts)$/,
    skipPatterns: [/migration/i, /\.sql$/]
  },
  'db-hard-delete': {
    code: 'BP-110', severity: 'low',
    message: 'Hard DELETE detected — consider soft deletes for critical data',
    patterns: [/DELETE\s+FROM/i],
    fileFilter: /\.(js|ts)$/,
    skipPatterns: [/migration/i]
  },

  // ── API Design ──
  'api-rate-limit': {
    code: 'BP-113', severity: 'medium',
    message: 'API endpoint without rate limiting middleware',
    patterns: [/app\.(get|post|put|delete|patch)\s*\(\s*['"`]\/api\//],
    requirePattern: /rateLimit|throttle|rateLimiter/i,
    fileFilter: /\.(js|ts)$/,
    skipTest: true
  },

  // ── Performance ──
  'perf-image-opt': {
    code: 'BP-124', severity: 'low',
    message: 'Image without loading attribute — add lazy loading',
    patterns: [/<img\s(?![^>]*loading\s*=)/i],
    fileFilter: /\.(jsx|tsx|html)$/
  },
  'perf-memory-leak': {
    code: 'BP-129', severity: 'medium',
    message: 'addEventListener without matching removeEventListener — potential memory leak',
    patterns: [/addEventListener\s*\(/],
    requirePattern: /removeEventListener\s*\(/,
    fileFilter: /\.(js|ts|tsx|jsx)$/,
    skipTest: true
  },

  // ── Agent Engineering ──
  'agent-retry-guard': {
    code: 'BP-152', severity: 'medium',
    message: 'Retry loop without max-retry guard — add maximum attempt limit',
    patterns: [/retry|retries|attempt/i],
    requirePattern: /max(?:Retries|Attempts|_retries|_attempts)|retryLimit|MAX_RETRY/,
    fileFilter: /\.(js|ts)$/,
    skipTest: true
  },
  'agent-output-schema': {
    code: 'BP-153', severity: 'medium',
    message: 'Agent output without schema validation — use zod/pydantic/JSON schema',
    patterns: [/(?:agent|llm|model)(?:Response|Output|Result)/i],
    requirePattern: /(?:z\.|zod\.|schema\.parse|validate|pydantic|jsonschema)/i,
    fileFilter: /\.(js|ts)$/,
    skipTest: true
  },

  // ── Security (additional) ──
  'sec-api-auth': {
    code: 'BP-075', severity: 'high',
    message: 'API route without authentication middleware',
    patterns: [/app\.(get|post|put|delete|patch)\s*\(\s*['"`]\/api\//],
    requirePattern: /(?:auth|authenticate|requireAuth|isAuthenticated|protect|verifyToken|jwt|session)\s*[\(,]/i,
    fileFilter: /\.(js|ts)$/,
    skipTest: true,
    dedup: 'SEC-AUTH'
  },
  'sec-headers': {
    code: 'BP-079', severity: 'medium',
    message: 'Missing security headers middleware (helmet/security headers)',
    patterns: [/app\.(use|listen)\s*\(/],
    requirePattern: /helmet|securityHeaders|x-content-type|x-frame-options/i,
    fileFilter: /\.(js|ts)$/,
    skipTest: true,
    dedup: 'SEC-HSTS'
  },
  'sec-csp': {
    code: 'BP-080', severity: 'medium',
    message: 'Missing Content Security Policy configuration',
    patterns: [/app\.(use|listen)\s*\(/],
    requirePattern: /contentSecurityPolicy|content-security-policy|csp/i,
    fileFilter: /\.(js|ts)$/,
    skipTest: true,
    dedup: 'SEC-CSP'
  },

  // ── Database (additional) ──
  'db-connection-pool': {
    code: 'BP-103', severity: 'medium',
    message: 'Database connection without pooling — use connection pool for performance',
    patterns: [/(?:createConnection|new\s+Client|connect\s*\()/i],
    requirePattern: /pool|Pool|connectionLimit|poolSize|max:\s*\d/i,
    fileFilter: /\.(js|ts)$/,
    skipTest: true
  },
  'db-boundary-validation': {
    code: 'BP-107', severity: 'medium',
    message: 'Route handler without input validation at boundary',
    patterns: [/router\.(post|put|patch)\s*\(\s*['"`]\//],
    requirePattern: /(?:zod|joi|yup|validate|schema|celebrate|express-validator)/i,
    fileFilter: /\.(js|ts)$/,
    skipTest: true
  },

  // ── API Design (additional) ──
  'api-error-responses': {
    code: 'BP-112', severity: 'low',
    message: 'Inconsistent error response — use structured error shape { error, message, code }',
    patterns: [/res\.status\s*\(\s*[45]\d{2}\s*\)\s*\.(?:json|send)\s*\(/],
    skipPatterns: [/error:|message:/],
    fileFilter: /\.(js|ts)$/
  },
  'api-pagination': {
    code: 'BP-114', severity: 'low',
    message: 'List endpoint without pagination — add page/limit/cursor parameters',
    patterns: [/\.(?:find|findAll|findMany|select)\s*\([^)]*\)\s*(?:\.then|;|\))/],
    requirePattern: /(?:limit|offset|page|cursor|skip|take|paginate)/i,
    fileFilter: /\.(js|ts)$/,
    skipTest: true
  },
  'api-versioning': {
    code: 'BP-115', severity: 'low',
    message: 'API route without version prefix (/v1/, /v2/)',
    patterns: [/app\.(get|post|put|delete|patch)\s*\(\s*['"`]\/api\/(?!v\d)/],
    fileFilter: /\.(js|ts)$/,
    skipTest: true
  },
  'api-input-validation': {
    code: 'BP-116', severity: 'medium',
    message: 'API endpoint without input validation middleware',
    patterns: [/app\.(post|put|patch)\s*\(\s*['"`]\/api\//],
    requirePattern: /(?:validate|zod|joi|yup|celebrate|express-validator|schema)/i,
    fileFilter: /\.(js|ts)$/,
    skipTest: true
  },
  'api-cors': {
    code: 'BP-118', severity: 'medium',
    message: 'Overly permissive CORS — avoid origin: * in production',
    patterns: [/origin:\s*['"`]\*['"`]|origin:\s*true/],
    fileFilter: /\.(js|ts)$/,
    dedup: 'SEC-CORS'
  },
  'api-idempotency': {
    code: 'BP-120', severity: 'low',
    message: 'POST/PUT mutation without idempotency key handling',
    patterns: [/app\.(post|put)\s*\(\s*['"`]\/api\//],
    requirePattern: /idempoten|x-idempotency|idempotencyKey/i,
    fileFilter: /\.(js|ts)$/,
    skipTest: true
  },

  // ── Performance (additional) ──
  'perf-lazy-loading': {
    code: 'BP-122', severity: 'low',
    message: 'Consider lazy loading for code splitting — use React.lazy/dynamic/import()',
    patterns: [/import\s+\{[^}]{200,}\}\s+from/],
    fileFilter: /\.(jsx|tsx)$/,
    skipTest: true
  },
  'perf-caching': {
    code: 'BP-123', severity: 'low',
    message: 'API response without caching headers — add Cache-Control or stale-while-revalidate',
    patterns: [/res\.(?:json|send)\s*\(/],
    requirePattern: /cache-control|stale-while-revalidate|setHeader.*cache|etag/i,
    fileFilter: /\.(js|ts)$/,
    skipTest: true
  },
  'perf-db-query': {
    code: 'BP-128', severity: 'medium',
    message: 'Potential N+1 query — await inside loop iterating over records',
    patterns: [/\.(?:map|forEach)\s*\(\s*(?:async\s*)?\(?[^)]*\)?\s*=>\s*\{[\s\S]*?await\s+.*\.find/],
    fileFilter: /\.(js|ts)$/,
    skipTest: true
  },

  // ── Agent Engineering (additional) ──
  'agent-supervisor': {
    code: 'BP-142', severity: 'medium',
    message: 'Agent orchestration without triage/routing logic',
    patterns: [/(?:orchestrat|dispatch|multi.?agent|agent.?pool)/i],
    requirePattern: /(?:triage|route|classify|dispatch|supervisor)/i,
    fileFilter: /\.(js|ts)$/,
    skipTest: true
  },
  'agent-handoff': {
    code: 'BP-143', severity: 'medium',
    message: 'Multi-agent flow without explicit handoff/return control',
    patterns: [/(?:handoff|hand.?off|delegate|transfer).*agent/i],
    requirePattern: /(?:return|callback|onComplete|result|response)/i,
    fileFilter: /\.(js|ts)$/,
    skipTest: true
  },
  'agent-two-phase': {
    code: 'BP-145', severity: 'medium',
    message: 'High-stakes tool call without plan-validate-execute pattern',
    patterns: [/(?:tool.?call|execute.?tool|run.?tool|invoke.?tool)/i],
    requirePattern: /(?:validate|confirm|approve|plan|preview|dry.?run)/i,
    fileFilter: /\.(js|ts)$/,
    skipTest: true
  },
  'agent-idempotency': {
    code: 'BP-146', severity: 'medium',
    message: 'Agent tool call (DB write, deploy) without idempotency key',
    patterns: [/(?:agent|tool).*(?:write|deploy|create|update|delete)/i],
    requirePattern: /idempoten|dedup|requestId|operationId/i,
    fileFilter: /\.(js|ts)$/,
    skipTest: true
  },
  'agent-human-loop': {
    code: 'BP-149', severity: 'medium',
    message: 'Destructive agent action without human confirmation gate',
    patterns: [/(?:agent|tool).*(?:delete|destroy|drop|remove|force)/i],
    requirePattern: /(?:confirm|approve|human|review|prompt|ask)/i,
    fileFilter: /\.(js|ts)$/,
    skipTest: true
  },
  'agent-context-monitoring': {
    code: 'BP-151', severity: 'low',
    message: 'Agent prompt without context window monitoring',
    patterns: [/(?:prompt|messages|context).*(?:length|size|tokens|count)/i],
    requirePattern: /(?:maxTokens|contextLimit|truncat|summariz|compress)/i,
    fileFilter: /\.(js|ts)$/,
    skipTest: true
  },
  'api-rest-conventions': {
    code: 'BP-111', severity: 'low',
    message: 'Non-RESTful route pattern — use standard HTTP methods and resource naming',
    patterns: [/app\.(get|post)\s*\(\s*['"`]\/api\/.*(?:get|fetch|delete|update|create|remove)[A-Z]/],
    fileFilter: /\.(js|ts)$/,
    skipTest: true
  },
  'agent-plan-act-reflect': {
    code: 'BP-141', severity: 'medium',
    message: 'Agent prompt without structured plan/act/reflect phases',
    patterns: [/(?:system.?prompt|agent.?prompt|instruction)/i],
    requirePattern: /(?:plan|act|reflect|reason|think|step)/i,
    fileFilter: /\.(js|ts)$/,
    skipTest: true
  }
};

// ═══════════════════════════════════════════════════════════════
// FILE_CHECKS — F-type practices
// ═══════════════════════════════════════════════════════════════

var FILE_CHECKS = {
  'vc-gitignore': {
    code: 'BP-015', severity: 'low',
    message: '.gitignore missing or incomplete (should include node_modules, dist, .env)',
    paths: ['.gitignore'],
    contentCheck: /node_modules/
  },
  'vc-lfs': {
    code: 'BP-014', severity: 'low',
    message: 'No .gitattributes for Git LFS — large files may bloat repository',
    paths: ['.gitattributes']
  },
  'cicd-pipeline': {
    code: 'BP-022', severity: 'medium',
    message: 'No CI/CD pipeline configuration found',
    paths: ['.github/workflows', '.gitlab-ci.yml', 'Jenkinsfile', '.circleci', 'azure-pipelines.yml'],
    anyOf: true
  },
  'cicd-env-parity': {
    code: 'BP-027', severity: 'low',
    message: 'No .env.example — document required environment variables',
    paths: ['.env.example', '.env.template', '.env.sample'],
    anyOf: true
  },
  'test-integration': {
    code: 'BP-032', severity: 'low',
    message: 'No integration test directory found',
    paths: ['tests/integration', '__tests__/integration', 'test/integration', 'src/__tests__/integration'],
    anyOf: true
  },
  'test-e2e': {
    code: 'BP-033', severity: 'low',
    message: 'No E2E test directory found (e2e, cypress, playwright)',
    paths: ['e2e', 'cypress', 'playwright', 'tests/e2e'],
    anyOf: true
  },
  'test-benchmark': {
    code: 'BP-037', severity: 'low',
    message: 'No performance benchmarks directory found',
    paths: ['benchmarks', 'bench', 'perf'],
    anyOf: true
  },
  'test-contract': {
    code: 'BP-039', severity: 'low',
    message: 'No contract test directory found',
    paths: ['pact', 'contracts', 'tests/contract'],
    anyOf: true
  },
  'iac-directory': {
    code: 'BP-041', severity: 'low',
    message: 'No Infrastructure as Code directory found',
    paths: ['terraform', 'infrastructure', 'cdk', 'pulumi', 'infra', 'iac'],
    anyOf: true
  },
  'container-network-policy': {
    code: 'BP-059', severity: 'medium',
    message: 'No Kubernetes NetworkPolicy manifests found',
    paths: ['k8s/network-policy.yaml', 'k8s/network-policy.yml', 'kubernetes/network-policy.yaml'],
    anyOf: true
  },
  'obs-slo': {
    code: 'BP-065', severity: 'low',
    message: 'No SLI/SLO definitions found — define service level objectives',
    paths: ['slo.yaml', 'slo.yml', 'docs/slo.md', 'docs/sli-slo.md'],
    anyOf: true
  },
  'obs-dashboards': {
    code: 'BP-068', severity: 'low',
    message: 'No dashboard-as-code definitions found',
    paths: ['grafana/dashboards', 'dashboards'],
    anyOf: true
  },
  'doc-readme': {
    code: 'BP-081', severity: 'medium',
    message: 'No README.md found at project root',
    paths: ['README.md']
  },
  'doc-openapi': {
    code: 'BP-082', severity: 'low',
    message: 'No API documentation (OpenAPI/Swagger) found',
    paths: ['openapi.yaml', 'openapi.yml', 'openapi.json', 'swagger.json', 'swagger.yaml', 'docs/api'],
    anyOf: true
  },
  'doc-adr': {
    code: 'BP-083', severity: 'low',
    message: 'No Architecture Decision Records directory found',
    paths: ['docs/adr', 'adr', 'docs/decisions'],
    anyOf: true
  },
  'doc-runbooks': {
    code: 'BP-084', severity: 'low',
    message: 'No operations runbooks found',
    paths: ['runbooks', 'docs/runbooks'],
    anyOf: true
  },
  'doc-contributing': {
    code: 'BP-085', severity: 'low',
    message: 'No CONTRIBUTING.md or onboarding documentation found',
    paths: ['CONTRIBUTING.md', 'docs/onboarding.md', 'docs/getting-started.md'],
    anyOf: true
  },
  'doc-changelog': {
    code: 'BP-086', severity: 'low',
    message: 'No CHANGELOG.md found',
    paths: ['CHANGELOG.md']
  },
  'doc-deployment': {
    code: 'BP-088', severity: 'low',
    message: 'No deployment documentation found',
    paths: ['docs/deployment.md', 'DEPLOYMENT.md', 'docs/deploy.md'],
    anyOf: true
  },
  'doc-postmortems': {
    code: 'BP-089', severity: 'low',
    message: 'No incident postmortem templates found',
    paths: ['docs/postmortems', 'postmortems'],
    anyOf: true
  },
  'rel-rollback': {
    code: 'BP-095', severity: 'low',
    message: 'No rollback procedures documented',
    paths: ['docs/rollback.md', 'scripts/rollback.sh', 'scripts/rollback.js'],
    anyOf: true
  },
  'rel-releases': {
    code: 'BP-096', severity: 'low',
    message: 'No release notes directory found',
    paths: ['RELEASES.md', 'docs/releases'],
    anyOf: true
  },
  'db-migrations': {
    code: 'BP-101', severity: 'medium',
    message: 'No database migration directory found',
    paths: ['migrations', 'prisma/migrations', 'db/migrations', 'drizzle'],
    anyOf: true
  },
  'db-schema-docs': {
    code: 'BP-106', severity: 'low',
    message: 'No database schema documentation found',
    paths: ['docs/schema.md', 'DATABASE.md', 'docs/database.md', 'prisma/schema.prisma'],
    anyOf: true
  },
  'incident-playbook': {
    code: 'BP-131', severity: 'low',
    message: 'No incident response playbook found',
    paths: ['docs/incident-response.md', 'docs/incident-playbook.md', 'runbooks/incident.md'],
    anyOf: true
  },
  'incident-severity': {
    code: 'BP-133', severity: 'low',
    message: 'No severity classification document found',
    paths: ['docs/severity.md', 'docs/severity-levels.md'],
    anyOf: true
  },
  'incident-escalation': {
    code: 'BP-137', severity: 'low',
    message: 'No escalation procedures document found',
    paths: ['docs/escalation.md', 'docs/escalation-policy.md'],
    anyOf: true
  },
  'agent-golden-dataset': {
    code: 'BP-147', severity: 'low',
    message: 'No golden dataset/evals directory for agent evaluation',
    paths: ['tests/golden', 'evals', 'tests/evals', 'golden'],
    anyOf: true
  },
  'incident-remediation': {
    code: 'BP-140', severity: 'low',
    message: 'No automated remediation scripts found',
    paths: ['scripts/remediation', 'remediation'],
    anyOf: true
  },
  'doc-api-versioning': {
    code: 'BP-090', severity: 'low',
    message: 'No API versioning documentation found',
    paths: ['docs/api-versioning.md', 'docs/api-versioning', 'docs/api/versioning.md'],
    anyOf: true
  },
  'api-documentation': {
    code: 'BP-119', severity: 'low',
    message: 'No API documentation found (reuses BP-082 check)',
    paths: ['openapi.yaml', 'openapi.yml', 'openapi.json', 'swagger.json', 'swagger.yaml', 'docs/api'],
    anyOf: true
  },
  'inc-comm-templates': {
    code: 'BP-134', severity: 'low',
    message: 'No incident communication templates found',
    paths: ['docs/templates/incident.md', 'docs/templates/incident', 'docs/incident-templates'],
    anyOf: true
  },
  'inc-postmortem': {
    code: 'BP-135', severity: 'low',
    message: 'No post-incident review templates found',
    paths: ['docs/postmortems', 'postmortems', 'docs/post-incident'],
    anyOf: true
  }
};

// ═══════════════════════════════════════════════════════════════
// CONFIG_CHECKS — C-type practices
// ═══════════════════════════════════════════════════════════════

var CONFIG_CHECKS = {
  'cq-tsconfig-strict': {
    code: 'BP-010', severity: 'medium',
    message: 'TypeScript strict mode not enabled in tsconfig.json',
    file: 'tsconfig.json',
    check: function(content) {
      try {
        var clean = content.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
        var cfg = JSON.parse(clean);
        return !(cfg.compilerOptions && cfg.compilerOptions.strict === true);
      } catch (e) { _log('best-practices', 'warn', 'tsconfig.json parse failed: ' + e.message); return false; }
    },
    dedup: 'STD-TSSTRICT'
  },
  'cicd-lockfile': {
    code: 'BP-021', severity: 'medium',
    message: 'No lock file found — builds may not be reproducible',
    file: null,
    check: function(content, cwd) {
      var lockFiles = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb'];
      for (var i = 0; i < lockFiles.length; i++) {
        try { if (fs.statSync(path.join(cwd, lockFiles[i])).isFile()) return false; } catch (e) { /* continue */ }
      }
      return true;
    }
  },
  'cicd-pkg-version': {
    code: 'BP-024', severity: 'low',
    message: 'package.json missing "version" field',
    file: 'package.json',
    check: function(content) {
      try {
        var pkg = JSON.parse(content);
        return !pkg.version;
      } catch (e) { _log('best-practices', 'warn', 'package.json parse failed in cicd-pkg-version: ' + e.message); return false; }
    }
  },
  'rel-semver': {
    code: 'BP-091', severity: 'low',
    message: 'package.json version does not follow semantic versioning',
    file: 'package.json',
    check: function(content) {
      try {
        var pkg = JSON.parse(content);
        if (!pkg.version) return false;
        return !/^\d+\.\d+\.\d+(-[\w.]+)?(\+[\w.]+)?$/.test(pkg.version);
      } catch (e) { _log('best-practices', 'warn', 'package.json parse failed in rel-semver: ' + e.message); return false; }
    }
  },
  'test-coverage-threshold': {
    code: 'BP-031', severity: 'low',
    message: 'No test coverage threshold configured',
    file: null,
    check: function(content, cwd) {
      var configs = ['jest.config.js', 'jest.config.ts', 'vitest.config.ts', 'vitest.config.js'];
      for (var i = 0; i < configs.length; i++) {
        try {
          var c = fs.readFileSync(path.join(cwd, configs[i]), 'utf8');
          if (/coverageThreshold|coverage\s*:\s*\{/.test(c)) return false;
        } catch (e) { /* continue */ }
      }
      return true;
    }
  },
  'ci-test-gates': {
    code: 'BP-023', severity: 'medium',
    message: 'CI pipeline without automated testing gate',
    file: null,
    check: function(content, cwd) {
      var ciFiles = ['.github/workflows', '.gitlab-ci.yml', 'Jenkinsfile'];
      for (var i = 0; i < ciFiles.length; i++) {
        try {
          var p = path.join(cwd, ciFiles[i]);
          var stat = fs.statSync(p);
          if (stat.isDirectory()) {
            var files = fs.readdirSync(p).filter(function(f) { return /\.ya?ml$/.test(f); });
            for (var j = 0; j < files.length; j++) {
              var c = fs.readFileSync(path.join(p, files[j]), 'utf8');
              if (/test|jest|vitest|mocha|pytest|cargo test/i.test(c)) return false;
            }
          } else {
            var c2 = fs.readFileSync(p, 'utf8');
            if (/test|jest|vitest|mocha|pytest/i.test(c2)) return false;
          }
        } catch (e) { /* continue */ }
      }
      return true;
    }
  },
  'ci-build-cache': {
    code: 'BP-028', severity: 'low',
    message: 'CI pipeline without build cache configuration',
    file: null,
    check: function(content, cwd) {
      var ciDir = path.join(cwd, '.github', 'workflows');
      try {
        var files = fs.readdirSync(ciDir).filter(function(f) { return /\.ya?ml$/.test(f); });
        for (var i = 0; i < files.length; i++) {
          var c = fs.readFileSync(path.join(ciDir, files[i]), 'utf8');
          if (/cache|actions\/cache/i.test(c)) return false;
        }
      } catch (e) { /* no CI dir */ }
      return true;
    }
  },
  'ci-pipeline-security': {
    code: 'BP-030', severity: 'medium',
    message: 'CI pipeline without security scanning step',
    file: null,
    check: function(content, cwd) {
      var ciDir = path.join(cwd, '.github', 'workflows');
      try {
        var files = fs.readdirSync(ciDir).filter(function(f) { return /\.ya?ml$/.test(f); });
        for (var i = 0; i < files.length; i++) {
          var c = fs.readFileSync(path.join(ciDir, files[i]), 'utf8');
          if (/snyk|trivy|semgrep|codeql|sonarqube|grype|npm audit/i.test(c)) return false;
        }
      } catch (e) { /* no CI dir */ }
      return true;
    }
  },
  'test-mutation': {
    code: 'BP-038', severity: 'low',
    message: 'No mutation testing configured (stryker)',
    file: 'package.json',
    check: function(content) {
      try {
        var pkg = JSON.parse(content);
        var deps = Object.assign({}, pkg.devDependencies || {}, pkg.dependencies || {});
        return !deps['@stryker-mutator/core'] && !deps['stryker'];
      } catch (e) { _log('best-practices', 'warn', 'package.json parse failed in test-mutation: ' + e.message); return false; }
    }
  },
  'cont-image-scanning': {
    code: 'BP-056', severity: 'medium',
    message: 'No container image scanning in CI pipeline',
    file: null,
    check: function(content, cwd) {
      var ciDir = path.join(cwd, '.github', 'workflows');
      try {
        var files = fs.readdirSync(ciDir).filter(function(f) { return /\.ya?ml$/.test(f); });
        for (var i = 0; i < files.length; i++) {
          var c = fs.readFileSync(path.join(ciDir, files[i]), 'utf8');
          if (/trivy|snyk.container|grype|docker.scan|aqua/i.test(c)) return false;
        }
      } catch (e) { /* no CI dir */ }
      return true;
    }
  },
  'obs-distributed-tracing': {
    code: 'BP-062', severity: 'low',
    message: 'No distributed tracing library found',
    file: 'package.json',
    check: function(content) {
      try {
        var pkg = JSON.parse(content);
        var deps = Object.assign({}, pkg.devDependencies || {}, pkg.dependencies || {});
        var tracingPkgs = ['@opentelemetry/sdk-node', '@opentelemetry/api', 'dd-trace', 'jaeger-client'];
        for (var i = 0; i < tracingPkgs.length; i++) {
          if (deps[tracingPkgs[i]]) return false;
        }
        return true;
      } catch (e) { return false; }
    }
  },
  'obs-metrics': {
    code: 'BP-063', severity: 'low',
    message: 'No metrics collection library found',
    file: 'package.json',
    check: function(content) {
      try {
        var pkg = JSON.parse(content);
        var deps = Object.assign({}, pkg.devDependencies || {}, pkg.dependencies || {});
        var metricsPkgs = ['prom-client', 'hot-shots', 'datadog-metrics', '@opentelemetry/sdk-metrics'];
        for (var i = 0; i < metricsPkgs.length; i++) {
          if (deps[metricsPkgs[i]]) return false;
        }
        return true;
      } catch (e) { return false; }
    }
  },
  'obs-error-tracking': {
    code: 'BP-066', severity: 'low',
    message: 'No error tracking service configured',
    file: 'package.json',
    check: function(content) {
      try {
        var pkg = JSON.parse(content);
        var deps = Object.assign({}, pkg.devDependencies || {}, pkg.dependencies || {});
        var errorPkgs = ['@sentry/node', '@sentry/nextjs', 'bugsnag', '@bugsnag/node', 'rollbar', '@rollbar/node'];
        for (var i = 0; i < errorPkgs.length; i++) {
          if (deps[errorPkgs[i]]) return false;
        }
        return true;
      } catch (e) { return false; }
    }
  },
  'sec-sast-pipeline': {
    code: 'BP-072', severity: 'medium',
    message: 'No SAST tool configured in CI pipeline',
    file: null,
    check: function(content, cwd) {
      var ciDir = path.join(cwd, '.github', 'workflows');
      try {
        var files = fs.readdirSync(ciDir).filter(function(f) { return /\.ya?ml$/.test(f); });
        for (var i = 0; i < files.length; i++) {
          var c = fs.readFileSync(path.join(ciDir, files[i]), 'utf8');
          if (/semgrep|sonarqube|codeql|snyk code|checkmarx|fortify/i.test(c)) return false;
        }
      } catch (e) { /* no CI dir */ }
      return true;
    }
  },
  'sec-dast': {
    code: 'BP-073', severity: 'low',
    message: 'No DAST tool configured in CI pipeline',
    file: null,
    check: function(content, cwd) {
      var ciDir = path.join(cwd, '.github', 'workflows');
      try {
        var files = fs.readdirSync(ciDir).filter(function(f) { return /\.ya?ml$/.test(f); });
        for (var i = 0; i < files.length; i++) {
          var c = fs.readFileSync(path.join(ciDir, files[i]), 'utf8');
          if (/zap|zaproxy|burp|nuclei|dast/i.test(c)) return false;
        }
      } catch (e) { /* no CI dir */ }
      return true;
    }
  },
  'rel-changelog-auto': {
    code: 'BP-092', severity: 'low',
    message: 'No changelog automation configured',
    file: 'package.json',
    check: function(content) {
      try {
        var pkg = JSON.parse(content);
        var deps = Object.assign({}, pkg.devDependencies || {}, pkg.dependencies || {});
        return !deps['standard-version'] && !deps['semantic-release'] && !deps['@changesets/cli'] && !deps['conventional-changelog-cli'];
      } catch (e) { return false; }
    }
  },
  'rel-feature-flags': {
    code: 'BP-093', severity: 'low',
    message: 'No feature flag library configured',
    file: 'package.json',
    check: function(content) {
      try {
        var pkg = JSON.parse(content);
        var deps = Object.assign({}, pkg.devDependencies || {}, pkg.dependencies || {});
        return !deps['launchdarkly-node-server-sdk'] && !deps['unleash-client'] && !deps['flagsmith'] && !deps['@growthbook/growthbook'];
      } catch (e) { return false; }
    }
  },
  'api-compression': {
    code: 'BP-117', severity: 'low',
    message: 'No response compression middleware configured',
    file: 'package.json',
    check: function(content) {
      try {
        var pkg = JSON.parse(content);
        var deps = Object.assign({}, pkg.devDependencies || {}, pkg.dependencies || {});
        return !deps['compression'] && !deps['shrink-ray-current'];
      } catch (e) { return false; }
    }
  },
  'perf-code-splitting': {
    code: 'BP-125', severity: 'low',
    message: 'No code splitting configuration found in bundler config',
    file: null,
    check: function(content, cwd) {
      var configs = ['webpack.config.js', 'webpack.config.ts', 'vite.config.js', 'vite.config.ts', 'next.config.js', 'next.config.mjs'];
      for (var i = 0; i < configs.length; i++) {
        try {
          var c = fs.readFileSync(path.join(cwd, configs[i]), 'utf8');
          if (/splitChunks|manualChunks|dynamic|code.?split/i.test(c)) return false;
        } catch (e) { /* continue */ }
      }
      // Next.js auto-splits, so if next.config exists it passes
      try { fs.statSync(path.join(cwd, 'next.config.js')); return false; } catch (e) { /* continue */ }
      try { fs.statSync(path.join(cwd, 'next.config.mjs')); return false; } catch (e) { /* continue */ }
      try { fs.statSync(path.join(cwd, 'next.config.ts')); return false; } catch (e) { /* continue */ }
      return true;
    }
  },
  'perf-minification': {
    code: 'BP-126', severity: 'low',
    message: 'Build not configured for production minification',
    file: 'package.json',
    check: function(content) {
      try {
        var pkg = JSON.parse(content);
        var scripts = pkg.scripts || {};
        var build = scripts.build || '';
        return !(/production|--mode prod|NODE_ENV.*prod|next build|vite build|tsc.*&&/i.test(build));
      } catch (e) { return false; }
    }
  },
  'perf-budgets': {
    code: 'BP-130', severity: 'low',
    message: 'No performance budget configuration found',
    file: 'package.json',
    check: function(content) {
      try {
        var pkg = JSON.parse(content);
        var deps = Object.assign({}, pkg.devDependencies || {}, pkg.dependencies || {});
        return !deps['@lhci/cli'] && !deps['lighthouse-ci'] && !deps['bundlesize'] && !deps['size-limit'];
      } catch (e) { return false; }
    }
  },
  'agent-observability': {
    code: 'BP-154', severity: 'low',
    message: 'No agent observability/tracing configured',
    file: 'package.json',
    check: function(content) {
      try {
        var pkg = JSON.parse(content);
        var deps = Object.assign({}, pkg.devDependencies || {}, pkg.dependencies || {});
        return !deps['langsmith'] && !deps['agentops'] && !deps['@opentelemetry/sdk-node'] && !deps['@langchain/core'];
      } catch (e) { return false; }
    }
  },
  'sec-dep-vuln': {
    code: 'BP-071', severity: 'medium',
    message: 'No dependency vulnerability scanning in CI pipeline',
    file: null,
    check: function(content, cwd) {
      var ciDir = path.join(cwd, '.github', 'workflows');
      try {
        var files = fs.readdirSync(ciDir).filter(function(f) { return /\.ya?ml$/.test(f); });
        for (var i = 0; i < files.length; i++) {
          var c = fs.readFileSync(path.join(ciDir, files[i]), 'utf8');
          if (/npm audit|snyk|trivy|grype|dependabot|renovate/i.test(c)) return false;
        }
      } catch (e) { /* no CI dir */ }
      // Also check for .github/dependabot.yml
      try { fs.statSync(path.join(cwd, '.github', 'dependabot.yml')); return false; } catch (e) { /* continue */ }
      return true;
    }
  },
  'perf-bundle-size': {
    code: 'BP-121', severity: 'low',
    message: 'No bundle size limit configuration found',
    file: null,
    check: function(content, cwd) {
      var configs = ['webpack.config.js', 'webpack.config.ts', 'vite.config.js', 'vite.config.ts'];
      for (var i = 0; i < configs.length; i++) {
        try {
          var c = fs.readFileSync(path.join(cwd, configs[i]), 'utf8');
          if (/maxAssetSize|maxEntrypointSize|chunkSizeWarningLimit/i.test(c)) return false;
        } catch (e) { /* continue */ }
      }
      // Check package.json for bundlesize/size-limit
      try {
        var pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
        var deps = Object.assign({}, pkg.devDependencies || {}, pkg.dependencies || {});
        if (deps['bundlesize'] || deps['size-limit'] || deps['@size-limit/preset-app']) return false;
      } catch (e) { /* continue */ }
      return true;
    }
  }
};

// ═══════════════════════════════════════════════════════════════
// Special Check Handlers
// ═══════════════════════════════════════════════════════════════

function checkFileSize(content) {
  var lines = content.split('\n');
  return lines.length > 400;
}

function checkImportOrder(content) {
  var lines = content.split('\n');
  var imports = [];
  var lastImportLine = -1;
  var hasNonImportBetween = false;

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (/^import\s/.test(line) || /^const\s+\w+\s*=\s*require\(/.test(line)) {
      if (lastImportLine >= 0 && i - lastImportLine > 2) {
        hasNonImportBetween = true;
      }
      lastImportLine = i;
      imports.push(i);
    }
  }
  return hasNonImportBetween && imports.length > 3;
}

function checkDockerfileBase(content) {
  var lines = content.split('\n');
  var fromLines = [];
  for (var i = 0; i < lines.length; i++) {
    if (/^\s*FROM\s/i.test(lines[i])) fromLines.push(lines[i]);
  }
  if (fromLines.length === 0) return false;
  var lastFrom = fromLines[fromLines.length - 1];
  return !/alpine|slim|distroless|scratch|busybox/i.test(lastFrom);
}

function checkDockerfileMultistage(content) {
  var fromCount = 0;
  var lines = content.split('\n');
  for (var i = 0; i < lines.length; i++) {
    if (/^\s*FROM\s/i.test(lines[i])) fromCount++;
  }
  return fromCount < 2;
}

function checkDockerfileUser(content) {
  return !/^\s*USER\s/m.test(content);
}

function checkDockerfileHealthcheck(content) {
  return !/^\s*HEALTHCHECK\s/m.test(content);
}

function checkK8sResources(content) {
  if (!/kind:\s*(?:Deployment|Pod|StatefulSet|DaemonSet)/i.test(content)) return false;
  return !/resources:\s*\n\s*limits:/m.test(content);
}

function checkFunctionComments(content) {
  var lines = content.split('\n');
  var funcStart = -1;
  var braceDepth = 0;
  var hasComment = false;
  var violations = [];

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (/^\s*(?:function\s+\w+|(?:const|let|var)\s+\w+\s*=\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>))/.test(line)) {
      if (i > 0 && /^\s*(?:\/\/|\/\*|\*)/.test(lines[i - 1])) {
        hasComment = true;
      }
      funcStart = i;
      braceDepth = 0;
    }
    if (funcStart >= 0) {
      for (var j = 0; j < line.length; j++) {
        if (line[j] === '{') braceDepth++;
        if (line[j] === '}') braceDepth--;
      }
      if (braceDepth <= 0 && i > funcStart) {
        var funcLength = i - funcStart + 1;
        if (funcLength > 30 && !hasComment) {
          violations.push(funcStart + 1);
        }
        funcStart = -1;
        hasComment = false;
      }
    }
  }
  return violations.length > 0 ? violations : false;
}

var SPECIAL_HANDLERS = {
  'file-size': checkFileSize,
  'import-order': checkImportOrder,
  'dockerfile-base': checkDockerfileBase,
  'dockerfile-multistage': checkDockerfileMultistage,
  'dockerfile-user': checkDockerfileUser,
  'dockerfile-healthcheck': checkDockerfileHealthcheck,
  'k8s-resources': checkK8sResources,
  'function-comments': checkFunctionComments
};

// ═══════════════════════════════════════════════════════════════
// Practice Enablement Check
// ═══════════════════════════════════════════════════════════════

function isPracticeEnabled(practiceId, bpSettings) {
  if (!bpSettings || bpSettings.enabled === false) return false;
  var rules = bpSettings.rules || {};
  var rule = rules[practiceId];
  if (rule && rule.enabled === false) return false;
  // Default: enabled unless explicitly disabled
  return true;
}

// ═══════════════════════════════════════════════════════════════
// Run Checks
// ═══════════════════════════════════════════════════════════════

/**
 * Run regex-based checks against file content.
 * @param {string} content - File content
 * @param {string} filePath - File path
 * @param {object} bpSettings - Best practices settings
 * @param {Set} [existingCodes] - Codes already fired by STD/SEC/CMP
 * @returns {Array} violations
 */
function runRegexChecks(content, filePath, bpSettings, existingCodes) {
  var violations = [];
  existingCodes = existingCodes || new Set();
  var lines = content.split('\n');
  var ids = Object.keys(REGEX_CHECKS);

  for (var ri = 0; ri < ids.length; ri++) {
    var id = ids[ri];
    var check = REGEX_CHECKS[id];

    if (!isPracticeEnabled(id, bpSettings)) continue;
    if (check.dedup && existingCodes.has(check.dedup)) continue;
    if (check.fileFilter && !check.fileFilter.test(filePath)) continue;
    if (check.skipTest && /\.(test|spec)\.(js|ts|tsx|jsx)$/.test(filePath)) continue;

    // Special handlers
    if (check.special) {
      var handler = SPECIAL_HANDLERS[check.special];
      if (handler) {
        var result = handler(content);
        if (result === true) {
          violations.push({ code: check.code, severity: check.severity, message: check.message, line: 1 });
        } else if (Array.isArray(result)) {
          for (var vi = 0; vi < result.length; vi++) {
            violations.push({ code: check.code, severity: check.severity, message: check.message, line: result[vi] });
          }
        }
      }
      continue;
    }

    // requirePattern: file-level check — flag if patterns match but requirePattern doesn't
    if (check.requirePattern) {
      var hasTarget = false;
      for (var pi = 0; pi < check.patterns.length; pi++) {
        if (check.patterns[pi].test(content)) { hasTarget = true; break; }
      }
      if (hasTarget && !check.requirePattern.test(content)) {
        violations.push({ code: check.code, severity: check.severity, message: check.message, line: 1 });
      }
      continue;
    }

    // Standard line-by-line check
    for (var li = 0; li < lines.length; li++) {
      var line = lines[li];
      var matched = false;
      for (var pi2 = 0; pi2 < check.patterns.length; pi2++) {
        if (check.patterns[pi2].test(line)) { matched = true; break; }
      }
      if (!matched) continue;

      // Check skip patterns
      if (check.skipPatterns) {
        var skipped = false;
        for (var si = 0; si < check.skipPatterns.length; si++) {
          if (check.skipPatterns[si].test(line)) { skipped = true; break; }
        }
        if (skipped) continue;
      }

      violations.push({ code: check.code, severity: check.severity, message: check.message, line: li + 1 });
      break; // One violation per check per file
    }
  }

  return violations;
}

/**
 * Run file existence checks.
 * @param {string} cwd - Project root directory
 * @param {object} bpSettings - Best practices settings
 * @returns {Array} violations
 */
function runFileChecks(cwd, bpSettings) {
  var violations = [];
  var ids = Object.keys(FILE_CHECKS);

  for (var fi = 0; fi < ids.length; fi++) {
    var id = ids[fi];
    var check = FILE_CHECKS[id];

    if (!isPracticeEnabled(id, bpSettings)) continue;

    var found = false;
    for (var pi = 0; pi < check.paths.length; pi++) {
      var fullPath = path.join(cwd, check.paths[pi]);
      try {
        var stat = fs.statSync(fullPath);
        if (stat.isFile() || stat.isDirectory()) {
          // Content check if required
          if (check.contentCheck && stat.isFile()) {
            var fileContent = fs.readFileSync(fullPath, 'utf8');
            if (check.contentCheck.test(fileContent)) {
              found = true;
              break;
            }
          } else {
            found = true;
            break;
          }
        }
      } catch (e) { /* not found */ }
    }

    if (!found) {
      if (check.anyOf || check.paths.length === 1) {
        violations.push({ code: check.code, severity: check.severity, message: check.message, line: 0 });
      }
    }
  }

  return violations;
}

/**
 * Run config file checks.
 * @param {string} cwd - Project root directory
 * @param {object} bpSettings - Best practices settings
 * @param {Set} [existingCodes] - Codes already fired
 * @returns {Array} violations
 */
function runConfigChecks(cwd, bpSettings, existingCodes) {
  var violations = [];
  existingCodes = existingCodes || new Set();
  var ids = Object.keys(CONFIG_CHECKS);

  for (var ci = 0; ci < ids.length; ci++) {
    var id = ids[ci];
    var check = CONFIG_CHECKS[id];

    if (!isPracticeEnabled(id, bpSettings)) continue;
    if (check.dedup && existingCodes.has(check.dedup)) continue;

    var content = '';
    if (check.file) {
      try {
        content = fs.readFileSync(path.join(cwd, check.file), 'utf8');
      } catch (e) { continue; } // File doesn't exist, skip
    }

    try {
      if (check.check(content, cwd)) {
        violations.push({ code: check.code, severity: check.severity, message: check.message, line: 0 });
      }
    } catch (e) { /* check failed, skip */ }
  }

  return violations;
}

/**
 * Main entry point — run all applicable checks.
 * @param {string} content - File content being written
 * @param {string} filePath - Target file path
 * @param {string} cwd - Project root directory
 * @param {object} bpSettings - Best practices settings
 * @param {object} [context] - { existingViolationCodes: Set }
 * @returns {Array} violations
 */
function runChecks(content, filePath, cwd, bpSettings, context) {
  if (!bpSettings || bpSettings.enabled === false) return [];

  var existingCodes = (context && context.existingViolationCodes) || new Set();
  var violations = [];

  // Always run regex checks on the file being written
  var regexResults = runRegexChecks(content, filePath, bpSettings, existingCodes);
  for (var i = 0; i < regexResults.length; i++) violations.push(regexResults[i]);

  // File checks only on project config changes (not every file write)
  // Config checks only when writing the specific config file
  // These are run separately by oversight on init/scan

  return violations;
}

// ═══════════════════════════════════════════════════════════════
// Exports
// ═══════════════════════════════════════════════════════════════

module.exports = {
  runChecks: runChecks,
  runRegexChecks: runRegexChecks,
  runFileChecks: runFileChecks,
  runConfigChecks: runConfigChecks,
  isPracticeEnabled: isPracticeEnabled,
  REGEX_CHECKS: REGEX_CHECKS,
  FILE_CHECKS: FILE_CHECKS,
  CONFIG_CHECKS: CONFIG_CHECKS
};
