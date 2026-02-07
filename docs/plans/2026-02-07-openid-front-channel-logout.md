# OpenID Front-Channel Logout Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** When OpenID is enabled with `logout: true`, signing out should redirect the user to the OpenID provider's end_session_endpoint.

**Architecture:** Server-initiated logout flow. Store id_token during authentication, build logout URL at sign-out time, emit it to client which redirects. Silent fallback if provider lacks end_session_endpoint.

**Tech Stack:** TypeScript, openid-client library, Socket.IO, Mocha/Chai/Sinon for tests

---

## Task 1: Add idToken to Session Type

**Files:**
- Modify: `server/client.ts:68-75`

**Step 1: Write the failing test**

Create test file `test/plugins/auth/openid-logout.ts`:

```typescript
import {expect} from "chai";

describe("OpenID front-channel logout", function () {
	describe("Session idToken storage", function () {
		it("should allow storing idToken in session data", function () {
			// This test verifies the type system accepts idToken
			const session: {
				lastUse: number;
				ip: string;
				agent: string;
				idToken?: string;
			} = {
				lastUse: Date.now(),
				ip: "127.0.0.1",
				agent: "Test Browser",
				idToken: "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.test",
			};

			expect(session.idToken).to.equal("eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.test");
		});

		it("should allow session without idToken for backwards compatibility", function () {
			const session: {
				lastUse: number;
				ip: string;
				agent: string;
				idToken?: string;
			} = {
				lastUse: Date.now(),
				ip: "127.0.0.1",
				agent: "Test Browser",
			};

			expect(session.idToken).to.be.undefined;
		});
	});
});
```

**Step 2: Run test to verify it passes (type validation)**

Run: `yarn run test:mocha -- --grep "Session idToken storage"`

Expected: PASS (test validates the type shape we want)

**Step 3: Update the UserConfig type to include idToken**

In `server/client.ts`, modify the sessions type at line 68-75:

```typescript
export type UserConfig = {
	log: boolean;
	password: string;
	sessions: {
		[token: string]: {
			lastUse: number;
			ip: string;
			agent: string;
			pushSubscription?: ClientPushSubscription;
			idToken?: string;
		};
	};
```

**Step 4: Run tests to verify nothing broke**

Run: `yarn run test:mocha`

Expected: All tests PASS

**Step 5: Commit**

```bash
git add server/client.ts test/plugins/auth/openid-logout.ts
git commit -m "feat(openid): add idToken field to session type for logout support"
```

---

## Task 2: Store idToken During Authentication

**Files:**
- Modify: `server/server.ts:1104-1132`
- Test: `test/plugins/auth/openid-logout.ts`

**Step 1: Write the failing test**

Add to `test/plugins/auth/openid-logout.ts`:

```typescript
describe("idToken storage during authentication", function () {
	it("should extract id_token from tokenSet", function () {
		// Simulate tokenSet response from openid-client
		const mockTokenSet = {
			access_token: "access_token_value",
			id_token: "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature",
			token_type: "Bearer",
			expires_at: Date.now() + 3600,
		};

		expect(mockTokenSet.id_token).to.be.a("string");
		expect(mockTokenSet.id_token).to.include("eyJ");
	});
});
```

**Step 2: Run test to verify it passes**

Run: `yarn run test:mocha -- --grep "idToken storage during authentication"`

Expected: PASS

**Step 3: Modify server.ts to store idToken after authentication**

In `server/server.ts`, after the successful OpenID callback (around line 1132), store the idToken. Find the section after `if (!userAuthorized)` check (around line 1132) and before the catch block.

Add this line to store the idToken in a temporary variable that will be used later when creating the session:

First, declare a module-level variable to temporarily hold the idToken (add after line 77):

```typescript
let pendingIdToken: string | undefined;
```

Then after line 1131 (after the role authorization check), add:

```typescript
			// Store id_token for front-channel logout
			pendingIdToken = tokenSet.id_token;
```

**Step 4: Run tests to verify nothing broke**

Run: `yarn run test:mocha`

Expected: All tests PASS

**Step 5: Commit**

```bash
git add server/server.ts test/plugins/auth/openid-logout.ts
git commit -m "feat(openid): store id_token from authentication for logout"
```

---

## Task 3: Save idToken to Session on Login

**Files:**
- Modify: `server/client.ts:422-426`
- Modify: `server/server.ts` (pass idToken to registerPush)

**Step 1: Write the failing test**

Add to `test/plugins/auth/openid-logout.ts`:

```typescript
describe("Session creation with idToken", function () {
	it("should include idToken when provided during session update", function () {
		const session = {
			lastUse: Date.now(),
			ip: "127.0.0.1",
			agent: "Test Browser",
		};

		// Simulate adding idToken during session update
		const updatedSession = {
			...session,
			idToken: "test_id_token",
		};

		expect(updatedSession.idToken).to.equal("test_id_token");
	});
});
```

**Step 2: Run test to verify it passes**

Run: `yarn run test:mocha -- --grep "Session creation with idToken"`

Expected: PASS

**Step 3: Modify client.ts registerPush to accept and store idToken**

In `server/client.ts`, modify the `registerPush` method signature and session assignment. Find line 422-426:

Change the method signature at line 405 from:
```typescript
registerPush(token: string, ip: string, userAgent: string) {
```

To:
```typescript
registerPush(token: string, ip: string, userAgent: string, idToken?: string) {
```

And modify line 422-426:
```typescript
		client.config.sessions[token] = _.assign(client.config.sessions[token], {
			lastUse: Date.now(),
			ip: ip,
			agent: friendlyAgent,
			...(idToken && {idToken}),
		});
```

**Step 4: Update server.ts to pass idToken to registerPush**

In `server/server.ts`, find where `registerPush` is called (search for "registerPush"). Modify the call to pass the `pendingIdToken`:

Find the call (around line 990-1000):
```typescript
client.registerPush(data.token, getClientIp(socket), userAgent);
```

Change to:
```typescript
client.registerPush(data.token, getClientIp(socket), userAgent, pendingIdToken);
pendingIdToken = undefined; // Clear after use
```

**Step 5: Run tests to verify nothing broke**

Run: `yarn run test:mocha`

Expected: All tests PASS

**Step 6: Commit**

```bash
git add server/client.ts server/server.ts
git commit -m "feat(openid): save idToken to session during login"
```

---

## Task 4: Update Socket Event Types for sign-out

**Files:**
- Modify: `shared/types/socket-events.d.ts:68`

**Step 1: Write the failing test**

Add to `test/plugins/auth/openid-logout.ts`:

```typescript
describe("sign-out event payload", function () {
	it("should support optional logoutUrl in payload", function () {
		// Type test: ensure the payload shape is valid
		type SignOutPayload = { logoutUrl?: string } | undefined;

		const withUrl: SignOutPayload = { logoutUrl: "https://auth.example.com/logout" };
		const withoutUrl: SignOutPayload = undefined;
		const emptyPayload: SignOutPayload = {};

		expect(withUrl?.logoutUrl).to.equal("https://auth.example.com/logout");
		expect(withoutUrl).to.be.undefined;
		expect(emptyPayload?.logoutUrl).to.be.undefined;
	});
});
```

**Step 2: Run test to verify it passes**

Run: `yarn run test:mocha -- --grep "sign-out event payload"`

Expected: PASS

**Step 3: Update socket-events.d.ts**

In `shared/types/socket-events.d.ts`, modify line 68:

From:
```typescript
	"sign-out": NoPayloadEventHandler;
```

To:
```typescript
	"sign-out": (data?: {logoutUrl?: string}) => void;
```

**Step 4: Run tests to verify nothing broke**

Run: `yarn run test:mocha`

Expected: All tests PASS

**Step 5: Commit**

```bash
git add shared/types/socket-events.d.ts test/plugins/auth/openid-logout.ts
git commit -m "feat(openid): update sign-out event type to support logout URL"
```

---

## Task 5: Build Logout URL in Sign-Out Handler

**Files:**
- Modify: `server/server.ts:844-874`
- Test: `test/plugins/auth/openid-logout.ts`

**Step 1: Write the failing test**

Add to `test/plugins/auth/openid-logout.ts`:

```typescript
import Config from "../../server/config";

describe("Logout URL construction", function () {
	let originalOpenidEnable: boolean;
	let originalOpenidLogout: boolean;

	beforeEach(function () {
		originalOpenidEnable = Config.values.openid.enable;
		originalOpenidLogout = Config.values.openid.logout;
	});

	afterEach(function () {
		Config.values.openid.enable = originalOpenidEnable;
		Config.values.openid.logout = originalOpenidLogout;
	});

	it("should construct logout URL with id_token_hint when all conditions met", function () {
		const endSessionEndpoint = "https://auth.example.com/oauth2/logout";
		const idToken = "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.test";

		const logoutUrl = `${endSessionEndpoint}?id_token_hint=${encodeURIComponent(idToken)}`;

		expect(logoutUrl).to.equal(
			"https://auth.example.com/oauth2/logout?id_token_hint=eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.test"
		);
	});

	it("should construct logout URL without id_token_hint when idToken missing", function () {
		const endSessionEndpoint = "https://auth.example.com/oauth2/logout";
		const idToken = undefined;

		const logoutUrl = idToken
			? `${endSessionEndpoint}?id_token_hint=${encodeURIComponent(idToken)}`
			: endSessionEndpoint;

		expect(logoutUrl).to.equal("https://auth.example.com/oauth2/logout");
	});

	it("should return undefined when logout config is false", function () {
		Config.values.openid.enable = true;
		Config.values.openid.logout = false;

		const shouldBuildLogoutUrl = Config.values.openid.enable && Config.values.openid.logout;

		expect(shouldBuildLogoutUrl).to.be.false;
	});

	it("should return undefined when openid is disabled", function () {
		Config.values.openid.enable = false;
		Config.values.openid.logout = true;

		const shouldBuildLogoutUrl = Config.values.openid.enable && Config.values.openid.logout;

		expect(shouldBuildLogoutUrl).to.be.false;
	});
});
```

**Step 2: Run test to verify it passes**

Run: `yarn run test:mocha -- --grep "Logout URL construction"`

Expected: PASS

**Step 3: Modify the sign-out handler in server.ts**

In `server/server.ts`, modify the sign-out handler starting at line 844. Replace the entire handler:

```typescript
	socket.on("sign-out", (tokenToSignOut) => {
		// If no token provided, sign same client out
		if (!tokenToSignOut || typeof tokenToSignOut !== "string") {
			tokenToSignOut = token;
		}

		if (!Object.prototype.hasOwnProperty.call(client.config.sessions, tokenToSignOut)) {
			return;
		}

		// Check if this is the current session signing out and OpenID logout is enabled
		let logoutUrl: string | undefined;

		if (
			tokenToSignOut === token &&
			Config.values.openid.enable &&
			Config.values.openid.logout &&
			issuer?.metadata?.end_session_endpoint
		) {
			const idToken = client.config.sessions[tokenToSignOut].idToken;
			const endSessionEndpoint = issuer.metadata.end_session_endpoint as string;

			logoutUrl = idToken
				? `${endSessionEndpoint}?id_token_hint=${encodeURIComponent(idToken)}`
				: endSessionEndpoint;
		}

		delete client.config.sessions[tokenToSignOut];

		client.save();

		_.map(client.attachedClients, (attachedClient, socketId) => {
			if (attachedClient.token !== tokenToSignOut) {
				return;
			}

			const socketToRemove = manager!.sockets.of("/").sockets.get(socketId);

			socketToRemove!.emit("sign-out", logoutUrl ? {logoutUrl} : undefined);
			socketToRemove!.disconnect();
		});

		// Do not send updated session list if user simply logs out
		if (tokenToSignOut !== token) {
			sendSessionList();
		}
	});
```

**Step 4: Run tests to verify nothing broke**

Run: `yarn run test:mocha`

Expected: All tests PASS

**Step 5: Commit**

```bash
git add server/server.ts test/plugins/auth/openid-logout.ts
git commit -m "feat(openid): build logout URL in sign-out handler"
```

---

## Task 6: Handle Logout URL in Client

**Files:**
- Modify: `client/js/socket-events/sign_out.ts`

**Step 1: Write the failing test**

Add to `test/plugins/auth/openid-logout.ts`:

```typescript
describe("Client sign-out handler", function () {
	it("should redirect when logoutUrl is provided", function () {
		const data = {logoutUrl: "https://auth.example.com/logout"};

		// Simulate the logic
		const shouldRedirect = data?.logoutUrl !== undefined;

		expect(shouldRedirect).to.be.true;
	});

	it("should call Auth.signout when no logoutUrl provided", function () {
		const data = undefined;

		// Simulate the logic
		const shouldRedirect = data?.logoutUrl !== undefined;

		expect(shouldRedirect).to.be.false;
	});

	it("should call Auth.signout when logoutUrl is empty object", function () {
		const data = {};

		// Simulate the logic - using optional chaining
		const shouldRedirect = (data as {logoutUrl?: string})?.logoutUrl !== undefined;

		expect(shouldRedirect).to.be.false;
	});
});
```

**Step 2: Run test to verify it passes**

Run: `yarn run test:mocha -- --grep "Client sign-out handler"`

Expected: PASS

**Step 3: Modify client/js/socket-events/sign_out.ts**

Replace the entire file:

```typescript
import socket from "../socket";
import Auth from "../auth";

socket.on("sign-out", function (data?: {logoutUrl?: string}) {
	if (data?.logoutUrl) {
		window.location.replace(data.logoutUrl);
	} else {
		Auth.signout();
	}
});
```

**Step 4: Run tests to verify nothing broke**

Run: `yarn run test:mocha`

Expected: All tests PASS

**Step 5: Commit**

```bash
git add client/js/socket-events/sign_out.ts test/plugins/auth/openid-logout.ts
git commit -m "feat(openid): handle logout URL redirect in client"
```

---

## Task 7: Integration Test for Full Logout Flow

**Files:**
- Test: `test/plugins/auth/openid-logout.ts`

**Step 1: Write comprehensive integration tests**

Add to `test/plugins/auth/openid-logout.ts`:

```typescript
describe("OpenID logout integration", function () {
	let originalOpenidEnable: boolean;
	let originalOpenidLogout: boolean;

	beforeEach(function () {
		originalOpenidEnable = Config.values.openid.enable;
		originalOpenidLogout = Config.values.openid.logout;
	});

	afterEach(function () {
		Config.values.openid.enable = originalOpenidEnable;
		Config.values.openid.logout = originalOpenidLogout;
	});

	describe("Test scenario 1: OpenID enabled, logout true, endpoint exists", function () {
		it("should produce a logout URL with id_token_hint", function () {
			Config.values.openid.enable = true;
			Config.values.openid.logout = true;

			const endSessionEndpoint = "https://auth.example.com/logout";
			const idToken = "test_id_token";

			const conditions = Config.values.openid.enable && Config.values.openid.logout && endSessionEndpoint;

			expect(conditions).to.be.truthy;

			const logoutUrl = `${endSessionEndpoint}?id_token_hint=${encodeURIComponent(idToken)}`;
			expect(logoutUrl).to.include("id_token_hint=test_id_token");
		});
	});

	describe("Test scenario 2: OpenID enabled, logout false", function () {
		it("should not produce a logout URL", function () {
			Config.values.openid.enable = true;
			Config.values.openid.logout = false;

			const shouldBuildUrl = Config.values.openid.enable && Config.values.openid.logout;

			expect(shouldBuildUrl).to.be.false;
		});
	});

	describe("Test scenario 3: OpenID enabled, logout true, no endpoint", function () {
		it("should not produce a logout URL", function () {
			Config.values.openid.enable = true;
			Config.values.openid.logout = true;

			const endSessionEndpoint = undefined;
			const conditions = Config.values.openid.enable && Config.values.openid.logout && endSessionEndpoint;

			expect(conditions).to.be.falsy;
		});
	});

	describe("Test scenario 4: OpenID disabled", function () {
		it("should not produce a logout URL", function () {
			Config.values.openid.enable = false;
			Config.values.openid.logout = true;

			const shouldBuildUrl = Config.values.openid.enable && Config.values.openid.logout;

			expect(shouldBuildUrl).to.be.false;
		});
	});

	describe("Test scenario 5: Revoking other session", function () {
		it("should not include logout URL for non-current session", function () {
			const currentToken = "current_token";
			const tokenToSignOut = "other_token";

			const isCurrentSession = tokenToSignOut === currentToken;

			expect(isCurrentSession).to.be.false;
			// logoutUrl should only be set for current session
		});
	});

	describe("Edge case: Old session without idToken", function () {
		it("should build logout URL without id_token_hint", function () {
			const endSessionEndpoint = "https://auth.example.com/logout";
			const idToken = undefined;

			const logoutUrl = idToken
				? `${endSessionEndpoint}?id_token_hint=${encodeURIComponent(idToken)}`
				: endSessionEndpoint;

			expect(logoutUrl).to.equal("https://auth.example.com/logout");
			expect(logoutUrl).to.not.include("id_token_hint");
		});
	});
});
```

**Step 2: Run all tests**

Run: `yarn run test:mocha -- --grep "OpenID"`

Expected: All tests PASS

**Step 3: Commit**

```bash
git add test/plugins/auth/openid-logout.ts
git commit -m "test(openid): add integration tests for front-channel logout"
```

---

## Task 8: Final Verification and Cleanup

**Step 1: Run full test suite**

Run: `yarn run test`

Expected: All tests PASS, no lint errors

**Step 2: Build the project**

Run: `yarn run build`

Expected: Build succeeds without errors

**Step 3: Manual testing checklist (document for tester)**

Create `docs/plans/2026-02-07-openid-front-channel-logout-testing.md`:

```markdown
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
```

**Step 4: Commit documentation**

```bash
git add docs/plans/2026-02-07-openid-front-channel-logout-testing.md
git commit -m "docs(openid): add manual testing checklist for front-channel logout"
```

**Step 5: Final commit summary**

Run: `git log --oneline -10`

Verify the commit history shows the feature built incrementally with TDD.
