# Semena OpenCode architecture

## Decision

Use OpenCode as the agent harness and keep OpenClaw outside the employee
production path.

OpenClaw can dispatch OpenCode through ACP, but its documented security model is
one trusted operator per gateway. It is not a tenant boundary for company users.
Adding it would create another privileged control plane without solving employee
identity or workspace isolation.

## Target flow

```text
Employee Windows account
  -> OpenCode Desktop / local OpenCode server
  -> one-time enrollment with Open WebUI email/password over TLS
  -> per-user API key
  -> TLS gateway with per-user API-key authentication on 10.1.50.101
  -> Ollama on 127.0.0.1:11434
  -> gemma4:12b (Gemma 4 12B, 16384-token context)
```

OpenCode runs on the employee computer so its file and shell tools operate on
that employee's workspace. The model gateway authenticates each user separately,
can revoke a single key, and prevents direct employee access to Ollama.

## Security boundary

- One key per employee; no shared OpenCode server password.
- Open WebUI is the identity source; passwords are verified during enrollment
  and are never stored by the Semena gateway.
- Ollama is bound to the server and must not be the employee-facing endpoint.
- OpenCode permissions allow read/edit/write/search/shell tools in the active
  project workspace and ask before accessing external directories.
- OpenClaw is reserved for a separately isolated administrator gateway if ACP
  dispatch is needed later.
