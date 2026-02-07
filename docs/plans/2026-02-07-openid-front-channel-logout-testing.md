# OpenID Front-Channel Logout - Manual Testing Checklist

## Prerequisites
- OpenID provider configured (e.g., Keycloak, Authentik, Auth0)
- `openid.enable: true` in config
- `openid.logout: true` in config

## Test Cases

### 1. Normal logout with OpenID
1. Log in via OpenID
2. Click "Sign out" on current session
3. **Expected:** Redirected to OpenID provider's logout page
4. **Expected:** Logged out of The Lounge

### 2. Logout with logout disabled
1. Set `openid.logout: false`
2. Log in via OpenID
3. Click "Sign out"
4. **Expected:** Normal logout (page reload), no redirect to provider

### 3. Revoke other session
1. Log in via OpenID in two browsers
2. In browser A, revoke browser B's session
3. **Expected:** Browser B gets logged out, no redirect
4. **Expected:** Browser A stays logged in

### 4. Provider without end_session_endpoint
1. Use a provider that doesn't expose end_session_endpoint
2. Log in and sign out
3. **Expected:** Normal logout, no errors

### 5. Old session without idToken (upgrade scenario)
1. Have a session from before this feature
2. Sign out
3. **Expected:** Redirects to logout endpoint (without id_token_hint)
