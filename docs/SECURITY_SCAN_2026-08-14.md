# Security scan evidence — 2026-08-14

## Scope

The official OWASP ZAP stable container scanned an isolated local instance with
test-only data. Both a passive baseline and an unauthenticated active scan were
run. These checks do not replace an authenticated penetration test or production
monitoring.

## Result after hardening

- 28 URLs observed.
- 62 passive rules passed.
- 0 failed rules.
- No vulnerable JavaScript libraries, missing CSP, unsafe inline CSP sources,
  missing HSTS, missing site-isolation headers, mixed content, sensitive URL
  data, debug output, or dangerous JavaScript functions were reported.
- Dynamic pages and JSON are intentionally `no-store`; only public icons and
  other non-sensitive static PWA assets are cacheable.

Reports are stored outside Git in the audit evidence folder:
`audit-beri-segodnya-2026-08-14/security/zap-baseline-after.*`.

The active scan observed 29 URLs and passed 139 active/passive rules with zero
failed rules. This included reflected and persistent XSS, SQL/NoSQL injection,
path traversal, remote file inclusion, SSRF, XXE, command/code/template
injection, request splitting, open redirect, hidden files, `.env`/Git leakage,
Log4Shell, Spring4Shell, and access-control bypass probes. Its reports are
`zap-full-local-after.*` in the same evidence folder.

The active scanner reported two expected environment/architecture warnings:
plain HTTP on the isolated loopback-only test target, and the form-token
heuristic documented below. Production is HTTPS with HSTS.

The container's browser-driven DOM-XSS rule (40026) could not attach its browser
extension and terminated the first ZAP daemon. It was disabled for the successful
repeat run; all other full-scan rules ran. DOM behavior remains separately
covered by real-browser role flows, CSP without inline execution, source sink
checks, and query/body non-reflection tests. This limitation must remain visible
rather than being represented as a passed ZAP rule.

## Reviewed residual alerts

### 10202 — absence of anti-CSRF tokens

ZAP recognizes the semantic HTML forms but does not model the JavaScript request
contract. Every state-changing API request requires the non-simple
`X-BS-Request: 1` header and rejects a cross-site `Origin` or
`Sec-Fetch-Site`. A cross-origin HTML form cannot set that header. Isolated smoke
tests prove that a missing confirmation header and an attacker origin both
receive `403`. The session cookie is also `HttpOnly`, `Secure`, and
`SameSite=Strict`.

### 10031 — user-controllable HTML attribute

The reported values (`service_question`, `bakery`, and `2-3`) are fixed values
of static `<option>` elements, not reflected input. Smoke tests submit a unique
HTML injection marker in both a query parameter and a request body and verify
that it is absent from the response. Dynamic text is HTML-escaped, and CSP does
not permit inline scripts.

The follow-up active scan passed this rule and all server-side reflected and
persistent XSS rules.

### 10049 — caching classifications

This is expected policy rather than a vulnerability. HTML, JSON, configuration,
and private uploads are not stored in shared caches. Immutable caching is used
only for public icons and other non-sensitive assets.

### 10109 and 10111 — modern application and authentication request

These alerts identify the application architecture and login form. ZAP marks
them informational and provides no remediation.

## Live verification after deployment

Release `7b84cb5` was deployed after a separate Node 18 staging-gate. On live:

- strict CSP, HSTS, COEP, COOP, CORP, Origin-Agent-Cluster, no-store, noindex,
  frame deny and nosniff were confirmed over HTTPS;
- manifest, service worker, offline page, icons and Digital Asset Links return
  `200`, while admin and partner protected API return `401` without a role session;
- a missing confirmation header and a foreign Origin return `403` with distinct
  human-safe codes;
- legal configuration is deliberately absent, so a booking attempt returns
  `503 LEGAL_NOT_READY` without changing business data;
- the previously published preview/admin/three partner credentials were rotated,
  nine old sessions were revoked, old values now return `401`, and new values
  passed login/logout acceptance without being printed or committed;
- pre-deploy and post-deploy backups passed SHA-256 checks and temporary restore
  rehearsals; the live backup script produced `0600` files and a `0700` uploads
  directory with an integrity manifest;
- authenticated client/admin/partner UI was checked on the actual live runtime at
  desktop and mobile sizes; no new error-log entries appeared.

## Pilot boundary

The technical controls now support an internal rehearsal under Basic Auth with
test data. A real-person closed pilot remains blocked until legal/operator
configuration is approved; the server intentionally prevents PII collection in
the meantime. Public launch still requires a dedicated external authenticated
penetration test, vulnerability monitoring, retention/incident contacts, and a
review of infrastructure access keys. The current cross-project root key and
enabled root/password SSH must not be represented as least-privilege access.
