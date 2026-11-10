# Pre-Activation Readiness Audit — Network Security

## 1. Endpoint classification

| Destination | Type | Classification |
|---|---|---|
| `http://localhost:3001/v1` (FreeLLMAPI) | Local loopback | Local |
| `https://api.openai.com/v1` | Public HTTPS | Public |
| `https://api.groq.com/openai/v1` | Public HTTPS | Public |
| `https://api.together.xyz/v1` | Public HTTPS | Public (disabled) |
| `http://localhost:11434/v1` (Ollama) | Local loopback | Local (disabled) |
| `https://api.conway.tech` | Public HTTPS | Public (registration, credits) |
| `127.0.0.1:8787` (console) | Local loopback | Local |

## 2. Redirect protection

- P-6 validator rejects non-loopback plaintext HTTP.
- OpenAI transport created with `redirect: "error"` — a provider cannot bounce a request to another
  origin with the credential attached.
- Credential-bearing URLs are rejected by the validator.

## 3. API key protection

- Credentials are resolved from `process.env` at call time, never from disk.
- Config file stores no credential material (verified by preflight `credential.not_in_config`).
- Audit trail redacts secret-shaped fields.

## 4. SSRF assessment

- Endpoint overrides (`conwayApiUrl`, `ollamaBaseUrl`) are not validated against a private-IP
  blocklist. An operator could point Conway at an internal service. This is an operator-controlled
  configuration, not an untrusted input, but it is a gap if the config is ever attacker-controlled.
- **Recommendation:** add a URL validation step for operator-set endpoints (P-6 style).

## 5. LAN exposure

- Console binds `127.0.0.1` only; port 3001 is in `FORBIDDEN_PORTS`.
- `allowExternalExposure = false`.
- FreeLLMAPI's binding is a separate project's concern (not modified in this mission).

## 6. Verdict

No critical network security issues. One medium recommendation: validate operator-set endpoint URLs
against SSRF. External service bindings were not modified.
