# OpenID Front-Channel Logout Design

## Overview

When OpenID is enabled and the `logout` config option is true, pressing "Sign out" should also log the user out of the OpenID provider by redirecting to its `end_session_endpoint`.

## Design Decisions

| Decision             | Choice                | Rationale                                                  |
| -------------------- | --------------------- | ---------------------------------------------------------- |
| Flow direction       | Server-initiated      | Server controls session cleanup, can include id_token_hint |
| id_token storage     | Store in session data | Required for id_token_hint, already server-side and secure |
| Missing endpoint     | Silent fallback       | Don't bother user if provider lacks support                |
| Session revocation   | Current session only  | "Revoke" just invalidates token, matches user expectations |
| Post-logout redirect | None                  | Avoids redirect loop; user stays on provider's logout page |

## Data Flow

### Authentication (store id_token)

```
User → OpenID provider → callback with code
Server exchanges code → receives { access_token, id_token, ... }
Server stores id_token in client.config.sessions[token].idToken
```

### Logout

```
User clicks "Sign out" (current session only)
Client emits "sign-out" → Server
Server:
  1. Checks if OpenID enabled && config.logout === true
  2. Checks if end_session_endpoint exists in issuer.metadata
  3. Builds logout URL with id_token_hint from stored session
  4. Deletes session, disconnects socket
  5. Emits "sign-out" with { logoutUrl } to client
Client:
  If logoutUrl present → window.location.replace(logoutUrl)
  Else → normal Auth.signout() (clear storage, reload)
```

User ends up on the OpenID provider's "logged out" page. No redirect back to The Lounge.

## Code Changes

### server/server.ts

**Authentication (~line 300-400):**

- After `openidClient.callback()` returns tokens, extract `id_token`
- Store in session: `client.config.sessions[token].idToken = tokenSet.id_token`

**Sign-out handler (line 844):**

- Check `Config.values.openid.enable && Config.values.openid.logout`
- Check `issuer.metadata.end_session_endpoint` exists
- Retrieve `idToken` from `client.config.sessions[tokenToSignOut]`
- Build logout URL: `end_session_endpoint?id_token_hint=<idToken>`
- Emit `sign-out` with `{ logoutUrl }` instead of plain `sign-out`

### shared/types/socket-events.d.ts

Update sign-out event signature:

```typescript
"sign-out": (data?: { logoutUrl?: string }) => void;
```

### shared/types/config.ts

Add idToken to session type:

```typescript
interface Session {
  // ... existing fields
  idToken?: string;
}
```

### client/js/socket-events/sign_out.ts

Handle optional logoutUrl:

```typescript
socket.on("sign-out", function (data?: {logoutUrl?: string}) {
  if (data?.logoutUrl) {
    window.location.replace(data.logoutUrl);
  } else {
    Auth.signout();
  }
});
```

## Files Not Changing

- `client/components/Session.vue` — server handles the logic
- `defaults/config.js` — `logout: true` already exists
- `server/plugins/auth/openid.ts` — auth module unchanged

## Test Scenarios

1. OpenID enabled, logout: true, endpoint exists → redirects to provider
2. OpenID enabled, logout: false → normal logout
3. OpenID enabled, logout: true, no endpoint → normal logout (silent fallback)
4. OpenID disabled → normal logout
5. Revoking other session → no redirect, just invalidates

## Edge Cases

- `idToken` is optional — old sessions without it still work (no id_token_hint sent)
- Missing `end_session_endpoint` — silent fallback to normal logout
- OpenID disabled or `logout: false` — normal logout, no redirect
