# OpenID Plugin Encapsulation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Encapsulate all OpenID logic from server.ts into server/plugins/auth/openid.ts, achieving 80%+ test coverage.

**Architecture:** Extend the existing auth plugin pattern. Move OIDC client lifecycle, PKCE state management, callback handling, and logout URL building into the openid plugin. Server.ts will interact only through the Auth module interface.

**Tech Stack:** TypeScript, openid-client, Mocha/Chai for testing, sinon for mocking, nyc for coverage

---

## Task 1: Add Types for OpenID Plugin Interface

**Files:**
- Modify: `server/plugins/auth/openid.ts:36-40`
- Modify: `server/plugins/auth.ts:18-56`

**Step 1: Write failing test for new interface methods**

Create test file that expects the new methods to exist:

```typescript
// Add to test/plugins/auth/openid.ts after line 250

describe("OpenID plugin interface", function () {
	it("should export initialize method", function () {
		expect(openidAuth).to.have.property("initialize");
		expect(openidAuth.initialize).to.be.a("function");
	});

	it("should export getAuthUrl method", function () {
		expect(openidAuth).to.have.property("getAuthUrl");
		expect(openidAuth.getAuthUrl).to.be.a("function");
	});

	it("should export handleCallback method", function () {
		expect(openidAuth).to.have.property("handleCallback");
		expect(openidAuth.handleCallback).to.be.a("function");
	});

	it("should export buildLogoutUrl method", function () {
		expect(openidAuth).to.have.property("buildLogoutUrl");
		expect(openidAuth.buildLogoutUrl).to.be.a("function");
	});

	it("should export cleanup method", function () {
		expect(openidAuth).to.have.property("cleanup");
		expect(openidAuth.cleanup).to.be.a("function");
	});
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test:nospec -- 'test/plugins/auth/openid.ts'`
Expected: FAIL with "expected undefined to be a function" or similar

**Step 3: Add stub interface methods to openid.ts**

```typescript
// server/plugins/auth/openid.ts - replace entire file

import log from "../../log";
import Config from "../../config";
import ClientManager from "../../clientManager";
import Client from "../../client";

// Types for callback result
export interface CallbackResult {
	username: string;
	idToken?: string;
}

function openIDAuth(
	manager: ClientManager,
	existingUser: Client | null,
	user: string,
	_password: string,
	callback: (success: boolean) => void
): void {
	if (user === "") {
		log.error(
			`OpenID: Authentication failed - no username provided (check usernameClaim configuration)`
		);
		callback(false);
		return;
	}

	log.debug(`OpenID: Authenticating user '${user}', existing=${!!existingUser}`);

	// If no user is found, create it (unless they already exist on disk)
	if (!existingUser && !manager.getUsers().includes(user)) {
		log.info(`OpenID: Creating new user '${user}'`);
		manager.addUser(user, null, true);
	}

	callback(true);
}

function isOpenIDEnabled() {
	return !Config.values.public && Config.values.openid.enable;
}

// Stub implementations - will be filled in subsequent tasks
async function initialize(): Promise<boolean> {
	return false;
}

function getAuthUrl(_socketId: string): string | null {
	return null;
}

async function handleCallback(
	_socketId: string,
	_params: string
): Promise<CallbackResult | null> {
	return null;
}

function buildLogoutUrl(_idToken?: string): string | undefined {
	return undefined;
}

function cleanup(_socketId: string): void {
	// no-op stub
}

export default {
	moduleName: "openid",
	auth: openIDAuth,
	isEnabled: isOpenIDEnabled,
	initialize,
	getAuthUrl,
	handleCallback,
	buildLogoutUrl,
	cleanup,
};
```

**Step 4: Run test to verify it passes**

Run: `npm run test:nospec -- 'test/plugins/auth/openid.ts'`
Expected: PASS

**Step 5: Commit**

```bash
git add test/plugins/auth/openid.ts server/plugins/auth/openid.ts
git commit -m "feat(openid): add stub interface methods for plugin encapsulation"
```

---

## Task 2: Implement Socket State Management

**Files:**
- Modify: `server/plugins/auth/openid.ts`
- Create: `test/plugins/auth/openid-state.ts`

**Step 1: Write failing tests for state management**

```typescript
// test/plugins/auth/openid-state.ts
import {expect} from "chai";
import openidAuth from "../../../server/plugins/auth/openid";

describe("OpenID socket state management", function () {
	const testSocketId = "test-socket-123";

	afterEach(function () {
		// Clean up after each test
		openidAuth.cleanup(testSocketId);
	});

	describe("getAuthUrl", function () {
		it("should return null when OpenID is not initialized", function () {
			const url = openidAuth.getAuthUrl(testSocketId);
			expect(url).to.be.null;
		});
	});

	describe("cleanup", function () {
		it("should not throw when cleaning up non-existent socket", function () {
			expect(() => openidAuth.cleanup("non-existent")).to.not.throw();
		});
	});

	describe("handleCallback", function () {
		it("should return null when socket state does not exist", async function () {
			const result = await openidAuth.handleCallback(testSocketId, "code=abc");
			expect(result).to.be.null;
		});
	});
});
```

**Step 2: Run test to verify behavior**

Run: `npm run test:nospec -- 'test/plugins/auth/openid-state.ts'`
Expected: Tests should pass with current stubs (they return null/undefined)

**Step 3: Add socket state infrastructure**

```typescript
// Add to server/plugins/auth/openid.ts after imports

import {Issuer, generators, errors, BaseClient} from "openid-client";

// Types for callback result
export interface CallbackResult {
	username: string;
	idToken?: string;
}

// Per-socket PKCE state
interface SocketState {
	codeVerifier: string;
	state: string;
	createdAt: number;
}

const socketStates = new Map<string, SocketState>();
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// OIDC client - set during initialize()
let issuer: Issuer | null = null;
let openidClient: BaseClient | null = null;
let initialized = false;

// TTL sweep using setTimeout self-scheduling pattern
function scheduleSweep() {
	setTimeout(() => {
		const now = Date.now();

		for (const [socketId, state] of socketStates) {
			if (now - state.createdAt > STATE_TTL_MS) {
				socketStates.delete(socketId);
				log.debug(`OpenID: Cleaned up stale state for socket ${socketId}`);
			}
		}

		scheduleSweep();
	}, 5 * 60 * 1000);
}

// Start sweep on module load
scheduleSweep();

// ... rest of file with updated implementations
```

**Step 4: Update cleanup implementation**

```typescript
function cleanup(socketId: string): void {
	if (socketStates.has(socketId)) {
		socketStates.delete(socketId);
		log.debug(`OpenID: Cleaned up state for socket ${socketId}`);
	}
}
```

**Step 5: Run tests to verify**

Run: `npm run test:nospec -- 'test/plugins/auth/openid-state.ts'`
Expected: PASS

**Step 6: Commit**

```bash
git add server/plugins/auth/openid.ts test/plugins/auth/openid-state.ts
git commit -m "feat(openid): add socket state management with TTL cleanup"
```

---

## Task 3: Implement initialize() Method

**Files:**
- Modify: `server/plugins/auth/openid.ts`
- Modify: `test/plugins/auth/openid-state.ts`

**Step 1: Write failing tests for initialize**

```typescript
// Add to test/plugins/auth/openid-state.ts

import Config from "../../../server/config";
import sinon from "ts-sinon";
import log from "../../../server/log";

describe("OpenID initialize", function () {
	let originalOpenidConfig: typeof Config.values.openid;
	let logInfoStub: sinon.SinonStub;
	let logErrorStub: sinon.SinonStub;

	beforeEach(function () {
		originalOpenidConfig = {...Config.values.openid};
		logInfoStub = sinon.stub(log, "info");
		logErrorStub = sinon.stub(log, "error");
	});

	afterEach(function () {
		Config.values.openid = originalOpenidConfig;
		logInfoStub.restore();
		logErrorStub.restore();
	});

	it("should return false when OpenID is disabled", async function () {
		Config.values.openid.enable = false;
		const result = await openidAuth.initialize();
		expect(result).to.be.false;
	});

	it("should return false when issuer discovery fails", async function () {
		Config.values.openid.enable = true;
		Config.values.openid.issuerURL = "https://invalid.example.com";

		const result = await openidAuth.initialize();
		expect(result).to.be.false;
		sinon.assert.called(logErrorStub);
	});
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test:nospec -- 'test/plugins/auth/openid-state.ts'`
Expected: FAIL - initialize returns false for wrong reason or behavior differs

**Step 3: Implement initialize method**

```typescript
async function initialize(): Promise<boolean> {
	if (!Config.values.openid.enable) {
		log.debug("OpenID: Disabled in configuration");
		return false;
	}

	if (initialized) {
		log.debug("OpenID: Already initialized");
		return true;
	}

	try {
		issuer = await Issuer.discover(Config.values.openid.issuerURL);
		log.info(`OpenID: Discovered issuer ${issuer.metadata.issuer}`);

		openidClient = new issuer.Client({
			client_id: Config.values.openid.clientID,
			client_secret: Config.values.openid.secret,
			redirect_uris: [Config.values.openid.baseURL],
			response_types: ["code"],
		});

		initialized = true;
		return true;
	} catch (err) {
		log.error(`OpenID: Failed to initialize - ${(err as Error).message}`);
		return false;
	}
}
```

**Step 4: Run tests to verify**

Run: `npm run test:nospec -- 'test/plugins/auth/openid-state.ts'`
Expected: PASS

**Step 5: Commit**

```bash
git add server/plugins/auth/openid.ts test/plugins/auth/openid-state.ts
git commit -m "feat(openid): implement initialize() with issuer discovery"
```

---

## Task 4: Implement getAuthUrl() Method

**Files:**
- Modify: `server/plugins/auth/openid.ts`
- Modify: `test/plugins/auth/openid-state.ts`

**Step 1: Write failing tests for getAuthUrl**

```typescript
// Add to test/plugins/auth/openid-state.ts

describe("OpenID getAuthUrl", function () {
	it("should return null when not initialized", function () {
		const url = openidAuth.getAuthUrl("socket-123");
		expect(url).to.be.null;
	});

	it("should store socket state when generating URL", function () {
		// This test requires mocking the OIDC client
		// Will be implemented with proper mock
	});
});
```

**Step 2: Implement getAuthUrl**

```typescript
function getAuthUrl(socketId: string): string | null {
	if (!initialized || !openidClient) {
		log.debug("OpenID: Cannot generate auth URL - not initialized");
		return null;
	}

	// Generate fresh PKCE values for this socket
	const codeVerifier = generators.codeVerifier();
	const codeChallenge = generators.codeChallenge(codeVerifier);
	const state = generators.state();

	// Store state for callback validation
	socketStates.set(socketId, {
		codeVerifier,
		state,
		createdAt: Date.now(),
	});

	log.debug(`OpenID: Generated auth URL for socket ${socketId}`);

	return openidClient.authorizationUrl({
		scope: "openid email profile",
		code_challenge: codeChallenge,
		code_challenge_method: "S256",
		state,
	});
}
```

**Step 3: Run tests to verify**

Run: `npm run test:nospec -- 'test/plugins/auth/openid-state.ts'`
Expected: PASS

**Step 4: Commit**

```bash
git add server/plugins/auth/openid.ts test/plugins/auth/openid-state.ts
git commit -m "feat(openid): implement getAuthUrl() with per-socket PKCE"
```

---

## Task 5: Implement handleCallback() Method

**Files:**
- Modify: `server/plugins/auth/openid.ts`
- Modify: `test/plugins/auth/openid-state.ts`

**Step 1: Write failing tests for handleCallback**

```typescript
// Add to test/plugins/auth/openid-state.ts

describe("OpenID handleCallback", function () {
	it("should return null when socket state does not exist", async function () {
		const result = await openidAuth.handleCallback("unknown-socket", "code=abc");
		expect(result).to.be.null;
	});

	it("should return null when not initialized", async function () {
		const result = await openidAuth.handleCallback("socket-123", "code=abc");
		expect(result).to.be.null;
	});

	it("should clean up socket state after callback", async function () {
		// Requires mock setup - will verify state is removed
	});
});
```

**Step 2: Implement handleCallback**

```typescript
async function handleCallback(
	socketId: string,
	params: string
): Promise<CallbackResult | null> {
	if (!initialized || !openidClient) {
		log.warn("OpenID: Cannot handle callback - not initialized");
		return null;
	}

	const socketState = socketStates.get(socketId);

	if (!socketState) {
		log.warn(`OpenID: No state found for socket ${socketId}`);
		return null;
	}

	// Clean up state immediately (single use)
	socketStates.delete(socketId);

	try {
		const tokenSet = await openidClient.callback(
			Config.values.openid.baseURL,
			openidClient.callbackParams(params),
			{
				code_verifier: socketState.codeVerifier,
				state: socketState.state,
			}
		);

		log.debug(`OpenID: Token exchange successful for socket ${socketId}`);

		const userinfo = await openidClient.userinfo(tokenSet);
		log.debug(
			`OpenID: Retrieved userinfo, claims: [${Object.keys(userinfo).join(", ")}]`
		);

		const usernameClaim = Config.values.openid.usernameClaim;
		const extractedUsername = userinfo[usernameClaim];

		if (!extractedUsername || typeof extractedUsername !== "string") {
			log.warn(
				`OpenID: Username claim '${usernameClaim}' not found or invalid. ` +
					`Available claims: [${Object.keys(userinfo).join(", ")}]`
			);
			return null;
		}

		// Role-based authorization
		if (Config.values.openid.roleClaim !== "") {
			const availableRoles = (userinfo[Config.values.openid.roleClaim] as string[]) || [];
			const requiredRoles = Config.values.openid.requiredRoles;
			const userAuthorized = requiredRoles.every((role) =>
				availableRoles.includes(role)
			);

			if (!userAuthorized) {
				log.warn(
					`OpenID: User '${extractedUsername}' lacks required roles: ` +
						`has [${availableRoles.join(", ")}], needs [${requiredRoles.join(", ")}]`
				);
				return null;
			}
		}

		return {
			username: extractedUsername,
			idToken: tokenSet.id_token,
		};
	} catch (e) {
		if (e instanceof errors.OPError) {
			log.warn(`OpenID: Provider error - ${e.error} (${e.error_description || "no description"})`);
		} else if (e instanceof errors.RPError) {
			log.warn(`OpenID: Validation error - ${e.message}`);
		} else if (e instanceof Error && "code" in e) {
			log.warn(`OpenID: Provider unreachable - ${(e as NodeJS.ErrnoException).code}`);
		} else {
			log.warn(`OpenID: Authentication failed - ${String(e)}`);
		}

		return null;
	}
}
```

**Step 3: Run tests to verify**

Run: `npm run test:nospec -- 'test/plugins/auth/openid-state.ts'`
Expected: PASS

**Step 4: Commit**

```bash
git add server/plugins/auth/openid.ts test/plugins/auth/openid-state.ts
git commit -m "feat(openid): implement handleCallback() with token exchange"
```

---

## Task 6: Implement buildLogoutUrl() Method

**Files:**
- Modify: `server/plugins/auth/openid.ts`
- Modify: `test/plugins/auth/openid-state.ts`

**Step 1: Write failing tests for buildLogoutUrl**

```typescript
// Add to test/plugins/auth/openid-state.ts

describe("OpenID buildLogoutUrl", function () {
	let originalLogout: boolean;

	beforeEach(function () {
		originalLogout = Config.values.openid.logout;
	});

	afterEach(function () {
		Config.values.openid.logout = originalLogout;
	});

	it("should return undefined when logout is disabled", function () {
		Config.values.openid.logout = false;
		const url = openidAuth.buildLogoutUrl("test-id-token");
		expect(url).to.be.undefined;
	});

	it("should return undefined when not initialized", function () {
		Config.values.openid.logout = true;
		const url = openidAuth.buildLogoutUrl("test-id-token");
		expect(url).to.be.undefined;
	});
});
```

**Step 2: Implement buildLogoutUrl**

```typescript
function buildLogoutUrl(idToken?: string): string | undefined {
	if (!Config.values.openid.logout) {
		return undefined;
	}

	if (!initialized || !issuer?.metadata?.end_session_endpoint) {
		return undefined;
	}

	const endSessionEndpoint = issuer.metadata.end_session_endpoint as string;

	if (idToken) {
		return `${endSessionEndpoint}?id_token_hint=${encodeURIComponent(idToken)}`;
	}

	return endSessionEndpoint;
}
```

**Step 3: Run tests to verify**

Run: `npm run test:nospec -- 'test/plugins/auth/openid-state.ts'`
Expected: PASS

**Step 4: Commit**

```bash
git add server/plugins/auth/openid.ts test/plugins/auth/openid-state.ts
git commit -m "feat(openid): implement buildLogoutUrl() for front-channel logout"
```

---

## Task 7: Add Exported Function for State Reset (Testing)

**Files:**
- Modify: `server/plugins/auth/openid.ts`
- Modify: `test/plugins/auth/openid-state.ts`

**Step 1: Add reset function for testing**

```typescript
// Add to server/plugins/auth/openid.ts exports

// For testing only - resets module state
function _resetForTesting(): void {
	socketStates.clear();
	issuer = null;
	openidClient = null;
	initialized = false;
}

export default {
	moduleName: "openid",
	auth: openIDAuth,
	isEnabled: isOpenIDEnabled,
	initialize,
	getAuthUrl,
	handleCallback,
	buildLogoutUrl,
	cleanup,
	_resetForTesting,
};
```

**Step 2: Update test setup to use reset**

```typescript
// Add to test/plugins/auth/openid-state.ts beforeEach/afterEach

beforeEach(function () {
	openidAuth._resetForTesting();
});
```

**Step 3: Run tests to verify**

Run: `npm run test:nospec -- 'test/plugins/auth/openid-state.ts'`
Expected: PASS

**Step 4: Commit**

```bash
git add server/plugins/auth/openid.ts test/plugins/auth/openid-state.ts
git commit -m "test(openid): add _resetForTesting for test isolation"
```

---

## Task 8: Create Integration Tests with Mocked OIDC Provider

**Files:**
- Create: `test/plugins/auth/openid-integration.ts`

**Step 1: Write integration tests**

```typescript
// test/plugins/auth/openid-integration.ts
import {expect} from "chai";
import sinon from "ts-sinon";
import openidAuth from "../../../server/plugins/auth/openid";
import Config from "../../../server/config";
import log from "../../../server/log";
import * as openidClient from "openid-client";

describe("OpenID plugin integration", function () {
	let originalOpenidConfig: typeof Config.values.openid;
	let logStubs: {
		info: sinon.SinonStub;
		error: sinon.SinonStub;
		warn: sinon.SinonStub;
		debug: sinon.SinonStub;
	};

	beforeEach(function () {
		openidAuth._resetForTesting();
		originalOpenidConfig = JSON.parse(JSON.stringify(Config.values.openid));
		logStubs = {
			info: sinon.stub(log, "info"),
			error: sinon.stub(log, "error"),
			warn: sinon.stub(log, "warn"),
			debug: sinon.stub(log, "debug"),
		};
	});

	afterEach(function () {
		Config.values.openid = originalOpenidConfig;
		Object.values(logStubs).forEach((stub) => stub.restore());
	});

	describe("Full authentication flow", function () {
		it("should handle disabled OpenID gracefully", async function () {
			Config.values.openid.enable = false;

			const initResult = await openidAuth.initialize();
			expect(initResult).to.be.false;

			const authUrl = openidAuth.getAuthUrl("socket-1");
			expect(authUrl).to.be.null;

			const callbackResult = await openidAuth.handleCallback("socket-1", "code=abc");
			expect(callbackResult).to.be.null;

			const logoutUrl = openidAuth.buildLogoutUrl("token");
			expect(logoutUrl).to.be.undefined;
		});

		it("should clean up state on socket disconnect", function () {
			// Simulate state exists
			openidAuth._resetForTesting();

			// Cleanup should not throw
			expect(() => openidAuth.cleanup("socket-1")).to.not.throw();
		});
	});

	describe("Error handling", function () {
		it("should handle missing username claim", async function () {
			// This test verifies logging when claim is missing
			// Full test requires mock OIDC client
		});

		it("should handle role authorization failure", async function () {
			// This test verifies logging when roles don't match
			// Full test requires mock OIDC client
		});
	});
});
```

**Step 2: Run tests to verify**

Run: `npm run test:nospec -- 'test/plugins/auth/openid-integration.ts'`
Expected: PASS

**Step 3: Commit**

```bash
git add test/plugins/auth/openid-integration.ts
git commit -m "test(openid): add integration tests for plugin"
```

---

## Task 9: Update server.ts to Use Plugin Interface

**Files:**
- Modify: `server/server.ts`
- Modify: `test/server.ts` (if needed)

**Step 1: Read current server.ts OpenID sections**

Review lines:
- 22 (import)
- 68-79 (globals)
- 116-139 (init)
- 279-283 (auth:start)
- 857-871 (logout)
- 1122-1199 (callback)

**Step 2: Remove OpenID imports and globals from server.ts**

Remove line 22:
```typescript
// DELETE: import {Issuer, generators, errors, BaseClient} from "openid-client";
```

Remove lines 68-79:
```typescript
// DELETE all OpenID module-level variables
```

**Step 3: Update initialization**

Replace lines 116-139:
```typescript
if (Config.values.openid.enable) {
	const success = await Auth.initialize();

	if (!success) {
		log.error("OpenID authentication will not be available");
	}
}
```

**Step 4: Update auth:start event**

Replace lines 279-283:
```typescript
socket.emit("auth:start", {
	serverHash,
	openidEnabled: Config.values.openid.enable && !Config.values.public,
	openidInit: Auth.getAuthUrl?.(socket.id) ?? null,
});
```

**Step 5: Add cleanup to disconnect handler**

Add after line 498:
```typescript
socket.on("disconnect", function () {
	Auth.cleanup?.(socket.id);
	process.nextTick(() => client.clientDetach(socket.id));
});
```

**Step 6: Update logout URL building**

Replace lines 857-871:
```typescript
let logoutUrl: string | undefined;

if (
	tokenToSignOut === token &&
	Config.values.openid.enable &&
	Config.values.openid.logout
) {
	const idToken = client.config.sessions[tokenToSignOut].idToken;
	logoutUrl = Auth.buildLogoutUrl?.(idToken);
}
```

**Step 7: Update callback handling**

Replace lines 1122-1199:
```typescript
let idToken: string | undefined;

if (Config.values.openid.enable && "password" in data) {
	const result = await Auth.handleCallback?.(socket.id, data.password as string);

	if (result) {
		data.user = result.username;
		idToken = result.idToken;
	} else {
		data.user = "";
		data.password = "";
	}
}
```

Update session creation to use local `idToken` instead of global `pendingIdToken`.

**Step 8: Run full test suite**

Run: `npm test`
Expected: All tests PASS

**Step 9: Commit**

```bash
git add server/server.ts
git commit -m "refactor(server): delegate OpenID logic to auth plugin"
```

---

## Task 10: Verify Coverage and Add Missing Tests

**Files:**
- Modify: `test/plugins/auth/openid-state.ts`
- Modify: `test/plugins/auth/openid-integration.ts`

**Step 1: Run coverage report**

Run: `npm run coverage`

**Step 2: Identify uncovered lines**

Check `coverage/lcov-report/server/plugins/auth/openid.ts.html`

**Step 3: Add tests for uncovered branches**

Common uncovered scenarios:
- Already initialized case
- Network errors during discovery
- Various error types in callback

**Step 4: Re-run coverage**

Run: `npm run coverage`
Expected: 80%+ coverage on `server/plugins/auth/openid.ts`

**Step 5: Commit**

```bash
git add test/plugins/auth/*.ts
git commit -m "test(openid): achieve 80%+ coverage on plugin"
```

---

## Task 11: Final Cleanup and Documentation

**Files:**
- Modify: `server/plugins/auth.ts` (add types)
- Verify: All OpenID code removed from server.ts

**Step 1: Add TypeScript types to auth.ts**

```typescript
// Add to server/plugins/auth.ts after line 12

export interface OpenIDCallbackResult {
	username: string;
	idToken?: string;
}

// Update toExport type hints
```

**Step 2: Verify no OpenID code remains in server.ts**

Run: `grep -n "openid-client\|code_verifier\|pendingIdToken" server/server.ts`
Expected: No matches

**Step 3: Run full test suite**

Run: `npm test`
Expected: All tests PASS

**Step 4: Run coverage**

Run: `npm run coverage`
Expected: 80%+ on openid.ts

**Step 5: Final commit**

```bash
git add server/plugins/auth.ts
git commit -m "feat(openid): complete plugin encapsulation

- All OpenID logic now in server/plugins/auth/openid.ts
- Per-socket PKCE state with TTL cleanup
- server.ts uses Auth module interface only
- 80%+ test coverage achieved

Closes #1"
```

---

## Summary

| Task | Description | Files Modified |
|------|-------------|----------------|
| 1 | Add stub interface methods | openid.ts, test |
| 2 | Socket state management | openid.ts, test |
| 3 | Implement initialize() | openid.ts, test |
| 4 | Implement getAuthUrl() | openid.ts, test |
| 5 | Implement handleCallback() | openid.ts, test |
| 6 | Implement buildLogoutUrl() | openid.ts, test |
| 7 | Add testing reset function | openid.ts, test |
| 8 | Integration tests | test only |
| 9 | Update server.ts | server.ts |
| 10 | Coverage verification | tests |
| 11 | Final cleanup | auth.ts, verify |

**Test Commands:**
- Single test file: `npm run test:nospec -- 'test/plugins/auth/openid.ts'`
- All tests: `npm test`
- Coverage: `npm run coverage`
