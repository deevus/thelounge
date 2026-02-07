# OpenID Authentication Error Handling

## Overview

Improve error handling in the OpenID authentication flow by adding detailed server-side logging for different error types. Follows TheLounge's existing idiom of detailed server logs with generic client messages.

## Error Categories

| Error Type         | Source                        | Log Message Pattern                                                |
| ------------------ | ----------------------------- | ------------------------------------------------------------------ |
| `OPError`          | Provider returned error       | `OpenID provider error: ${error} (${error_description})`           |
| `RPError`          | Token/state validation failed | `OpenID validation error: ${message}`                              |
| Network error      | Provider unreachable          | `OpenID provider unreachable: ${code}`                             |
| Role authorization | Missing required roles        | `OpenID user lacks required roles: has [${has}], needs [${needs}]` |

## Implementation

### Location

`server/server.ts` lines 1123-1126 (catch block) and lines 1118-1121 (role check)

### Code Structure

```typescript
} catch (e) {
    const clientInfo = `from ${colors.bold(getClientIp(socket))}`;

    if (e instanceof OPError) {
        log.warn(`OpenID provider error ${clientInfo}: ${e.error} (${e.error_description || "no description"})`);
    } else if (e instanceof RPError) {
        log.warn(`OpenID validation error ${clientInfo}: ${e.message}`);
    } else if (e instanceof Error && "code" in e) {
        log.warn(`OpenID provider unreachable ${clientInfo}: ${(e as NodeJS.ErrnoException).code}`);
    } else {
        log.warn(`OpenID authentication failed ${clientInfo}: ${String(e)}`);
    }

    data.user = "";
    data.password = "";
}
```

### Imports Required

```typescript
import {OPError, RPError} from "openid-client";
```

## Test Plan

Tests in `test/plugins/auth/openid.ts`:

1. **OPError logging** - Stub `openidClient.callback` to throw OPError, verify `log.warn` called with provider error message
2. **RPError logging** - Stub to throw RPError, verify validation error logged
3. **Network error logging** - Stub to throw Error with `code: 'ECONNREFUSED'`, verify unreachable message
4. **Generic error logging** - Stub to throw unknown error type, verify fallback message
5. **Role authorization logging** - Mock userinfo with missing roles, verify role mismatch logged

## Scope

- Server-side logging only
- No client-side changes
- No changes to `auth:failed` socket event
