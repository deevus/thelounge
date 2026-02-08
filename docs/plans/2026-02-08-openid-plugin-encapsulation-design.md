# OpenID Plugin Encapsulation Design

**Date:** 2026-02-08
**Issue:** #1 - Encapsulate OpenID logic into plugin module
**Status:** Approved

## Problem

OpenID-specific logic is inlined directly into `server/server.ts` instead of being encapsulated in a plugin like the existing auth plugins (LDAP, local).

### Current Violations

| File | Lines | Issue |
|------|-------|-------|
| server/server.ts | 68-79 | OpenID client/issuer variables at module level |
| server/server.ts | 116-139 | Direct OpenID issuer discovery and client setup |
| server/server.ts | 279-283 | OpenID data added to auth:start event |
| server/server.ts | 857-871 | OpenID logout URL building |
| server/server.ts | 1122-1199 | OpenID callback handling in performAuthentication |

### Security Issues in Current Implementation

1. **PKCE reuse** - `code_verifier` and `state` generated once at startup, reused for all auth attempts
2. **Race condition** - Global `pendingIdToken` can be overwritten by concurrent authentications

## Solution

Extend `server/plugins/auth/openid.ts` to encapsulate all OpenID logic, following the existing auth plugin pattern used by LDAP and local.

## Plugin Interface

```typescript
// server/plugins/auth/openid.ts
export default {
  moduleName: "openid",

  // Existing
  auth: openIDAuth,
  isEnabled: isOpenIDEnabled,

  // New
  initialize: (): Promise<boolean>,
  getAuthUrl: (socketId: string) => string | null,
  handleCallback: (socketId: string, params: string) => Promise<{
    username: string;
    idToken?: string;
  } | null>,
  buildLogoutUrl: (idToken?: string) => string | undefined,
  cleanup: (socketId: string) => void,
};
```

### Method Descriptions

| Method | Purpose |
|--------|---------|
| `initialize()` | Discover issuer, create OIDC client. Returns `false` on failure. |
| `getAuthUrl(socketId)` | Generate PKCE values, store in state map, return authorization URL. |
| `handleCallback(socketId, params)` | Exchange code for tokens, validate claims/roles, return username + idToken or null. |
| `buildLogoutUrl(idToken)` | Build end_session_endpoint URL with id_token_hint. |
| `cleanup(socketId)` | Remove socket from state map (called on disconnect). |

## Internal State Management

```typescript
interface SocketState {
  codeVerifier: string;
  state: string;
  createdAt: number;
}

const socketStates = new Map<string, SocketState>();
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// OIDC client - set once during initialize()
let issuer: Issuer | null = null;
let openidClient: BaseClient | null = null;
```

### State Lifecycle

1. `initialize()` - Sets `issuer` and `openidClient`
2. `getAuthUrl(socketId)` - Creates entry in `socketStates` with fresh PKCE values
3. `handleCallback(socketId)` - Reads and deletes entry from `socketStates`
4. `cleanup(socketId)` - Deletes entry if exists (disconnect handler)

### TTL Sweep

Using `setTimeout` self-scheduling pattern (matching `StorageCleaner`):

```typescript
function scheduleSweep() {
  setTimeout(() => {
    const now = Date.now();
    for (const [socketId, state] of socketStates) {
      if (now - state.createdAt > STATE_TTL_MS) {
        socketStates.delete(socketId);
      }
    }
    scheduleSweep();
  }, 5 * 60 * 1000);
}
```

## Auth Module Changes

`server/plugins/auth.ts` exposes OpenID methods when OpenID is the active plugin. The existing plugin loading mechanism handles this automatically:

```typescript
for (const name in plugin) {
  toExport[name] = plugin[name];
}
```

Add TypeScript types for optional OpenID methods to enable type checking.

## Server.ts Changes

### Removals

| Lines | What | Replacement |
|-------|------|-------------|
| 22 | `openid-client` import | (moved to plugin) |
| 68-79 | Module globals | Local `idToken` in `performAuthentication` |
| 116-139 | Inline initialization | `await Auth.initialize()` |
| 282 | `issuerURL` | `Auth.getAuthUrl?.(socket.id)` |
| 857-871 | Logout URL building | `Auth.buildLogoutUrl?.(idToken)` |
| 1122-1199 | Callback handling | `await Auth.handleCallback?.(socket.id, ...)` |

### Additions

Add to disconnect handler:

```typescript
socket.on("disconnect", function () {
  Auth.cleanup?.(socket.id);
  // existing code...
});
```

### idToken Flow

Declare local variable in `performAuthentication`:

```typescript
async function performAuthentication(...) {
  let idToken: string | undefined;  // local, not module-level

  // Set from handleCallback result:
  if (Config.values.openid.enable && "password" in data) {
    const result = await Auth.handleCallback?.(this.id, data.password as string);
    if (result) {
      data.user = result.username;
      idToken = result.idToken;
    } else {
      data.user = "";
      data.password = "";
    }
  }

  // Pass to updateSession:
  client.updateSession(token, getClientIp(socket), socket.request, idToken);
}
```

## Error Handling

Following existing auth plugin pattern:

- Plugin logs errors internally (like LDAP/local)
- Returns simple values: `null` = failure, `{ username, idToken }` = success
- `initialize()` returns `false` on failure, server continues with other auth methods

## File Changes

| File | Change |
|------|--------|
| `server/plugins/auth/openid.ts` | Expand from ~41 to ~150 lines with full OIDC lifecycle |
| `server/plugins/auth.ts` | Add TypeScript types for optional OpenID methods |
| `server/server.ts` | Remove OpenID imports/globals, delegate to Auth module |

No new files needed.

## Security Improvements

| Issue | Before | After |
|-------|--------|-------|
| PKCE values | Single global, reused for all | Per-socket, fresh each auth |
| pendingIdToken | Global with race condition | Local to function scope |
| State cleanup | None | Disconnect handler + TTL sweep |
