import {expect} from "chai";
import sinon from "ts-sinon";
import * as openidClient from "openid-client";
import openidAuth from "../../../server/plugins/auth/openid";
import Config from "../../../server/config";
import log from "../../../server/log";

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
		sinon.restore();
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
			openidAuth._resetForTesting();
			expect(() => openidAuth.cleanup("socket-1")).to.not.throw();
		});
	});

	describe("With mocked OIDC client", function () {
		let issuerStub: sinon.SinonStub;
		let mockClient: {
			authorizationUrl: sinon.SinonStub;
			callback: sinon.SinonStub;
			callbackParams: sinon.SinonStub;
			userinfo: sinon.SinonStub;
		};

		beforeEach(function () {
			mockClient = {
				authorizationUrl: sinon.stub().returns("https://auth.example.com/authorize?code=test"),
				callback: sinon.stub(),
				callbackParams: sinon.stub().returns({code: "test-code", state: "test-state"}),
				userinfo: sinon.stub(),
			};

			const MockIssuer = {
				metadata: {
					issuer: "https://auth.example.com",
					end_session_endpoint: "https://auth.example.com/logout",
				},
				Client: sinon.stub().returns(mockClient),
			};

			issuerStub = sinon.stub(openidClient.Issuer, "discover").resolves(MockIssuer as any);
		});

		it("should initialize successfully with valid issuer", async function () {
			Config.values.openid.enable = true;

			const result = await openidAuth.initialize();

			expect(result).to.be.true;
			sinon.assert.calledOnce(issuerStub);
		});

		it("should return true on second initialize call (already initialized)", async function () {
			Config.values.openid.enable = true;

			await openidAuth.initialize();
			const secondResult = await openidAuth.initialize();

			expect(secondResult).to.be.true;
			sinon.assert.calledOnce(issuerStub); // Only called once
		});

		it("should generate auth URL after initialization", async function () {
			Config.values.openid.enable = true;
			await openidAuth.initialize();

			const url = openidAuth.getAuthUrl("socket-123");

			expect(url).to.equal("https://auth.example.com/authorize?code=test");
			sinon.assert.calledOnce(mockClient.authorizationUrl);
		});

		it("should build logout URL with id_token_hint", async function () {
			Config.values.openid.enable = true;
			Config.values.openid.logout = true;
			await openidAuth.initialize();

			const url = openidAuth.buildLogoutUrl("my-id-token");

			expect(url).to.equal("https://auth.example.com/logout?id_token_hint=my-id-token");
		});

		it("should build logout URL without id_token_hint", async function () {
			Config.values.openid.enable = true;
			Config.values.openid.logout = true;
			await openidAuth.initialize();

			const url = openidAuth.buildLogoutUrl();

			expect(url).to.equal("https://auth.example.com/logout");
		});

		it("should handle successful callback", async function () {
			Config.values.openid.enable = true;
			Config.values.openid.usernameClaim = "preferred_username";
			Config.values.openid.roleClaim = "";
			await openidAuth.initialize();

			// Set up socket state by calling getAuthUrl first
			openidAuth.getAuthUrl("socket-123");

			mockClient.callback.resolves({id_token: "test-id-token"});
			mockClient.userinfo.resolves({preferred_username: "testuser", email: "test@example.com"});

			const result = await openidAuth.handleCallback("socket-123", "code=abc&state=xyz");

			expect(result).to.not.be.null;
			expect(result?.username).to.equal("testuser");
			expect(result?.idToken).to.equal("test-id-token");
		});

		it("should return null when username claim is missing", async function () {
			Config.values.openid.enable = true;
			Config.values.openid.usernameClaim = "preferred_username";
			await openidAuth.initialize();

			openidAuth.getAuthUrl("socket-123");

			mockClient.callback.resolves({id_token: "test-id-token"});
			mockClient.userinfo.resolves({email: "test@example.com"}); // No preferred_username

			const result = await openidAuth.handleCallback("socket-123", "code=abc&state=xyz");

			expect(result).to.be.null;
			sinon.assert.called(logStubs.warn);
		});

		it("should return null when role authorization fails", async function () {
			Config.values.openid.enable = true;
			Config.values.openid.usernameClaim = "preferred_username";
			Config.values.openid.roleClaim = "roles";
			Config.values.openid.requiredRoles = ["admin"];
			await openidAuth.initialize();

			openidAuth.getAuthUrl("socket-123");

			mockClient.callback.resolves({id_token: "test-id-token"});
			mockClient.userinfo.resolves({
				preferred_username: "testuser",
				roles: ["user"], // Missing 'admin' role
			});

			const result = await openidAuth.handleCallback("socket-123", "code=abc&state=xyz");

			expect(result).to.be.null;
			sinon.assert.called(logStubs.warn);
		});

		it("should pass role authorization when user has required roles", async function () {
			Config.values.openid.enable = true;
			Config.values.openid.usernameClaim = "preferred_username";
			Config.values.openid.roleClaim = "roles";
			Config.values.openid.requiredRoles = ["admin", "user"];
			await openidAuth.initialize();

			openidAuth.getAuthUrl("socket-123");

			mockClient.callback.resolves({id_token: "test-id-token"});
			mockClient.userinfo.resolves({
				preferred_username: "testuser",
				roles: ["admin", "user", "moderator"],
			});

			const result = await openidAuth.handleCallback("socket-123", "code=abc&state=xyz");

			expect(result).to.not.be.null;
			expect(result?.username).to.equal("testuser");
		});

		it("should handle OPError from provider", async function () {
			Config.values.openid.enable = true;
			await openidAuth.initialize();

			openidAuth.getAuthUrl("socket-123");

			const opError = new openidClient.errors.OPError({error: "invalid_grant"});
			mockClient.callback.rejects(opError);

			const result = await openidAuth.handleCallback("socket-123", "code=abc&state=xyz");

			expect(result).to.be.null;
			sinon.assert.called(logStubs.warn);
		});

		it("should handle RPError from validation", async function () {
			Config.values.openid.enable = true;
			await openidAuth.initialize();

			openidAuth.getAuthUrl("socket-123");

			const rpError = new openidClient.errors.RPError("state mismatch");
			mockClient.callback.rejects(rpError);

			const result = await openidAuth.handleCallback("socket-123", "code=abc&state=xyz");

			expect(result).to.be.null;
			sinon.assert.called(logStubs.warn);
		});

		it("should handle network error with code property", async function () {
			Config.values.openid.enable = true;
			await openidAuth.initialize();

			openidAuth.getAuthUrl("socket-123");

			const networkError = new Error("Connection failed") as NodeJS.ErrnoException;
			networkError.code = "ECONNREFUSED";
			mockClient.callback.rejects(networkError);

			const result = await openidAuth.handleCallback("socket-123", "code=abc&state=xyz");

			expect(result).to.be.null;
			sinon.assert.called(logStubs.warn);
		});

		it("should handle generic error in callback", async function () {
			Config.values.openid.enable = true;
			await openidAuth.initialize();

			openidAuth.getAuthUrl("socket-123");

			const genericError = new Error("Unknown error");
			mockClient.callback.rejects(genericError);

			const result = await openidAuth.handleCallback("socket-123", "code=abc&state=xyz");

			expect(result).to.be.null;
			sinon.assert.called(logStubs.warn);
		});

		it("should return null when username claim is not a string", async function () {
			Config.values.openid.enable = true;
			Config.values.openid.usernameClaim = "preferred_username";
			await openidAuth.initialize();

			openidAuth.getAuthUrl("socket-123");

			mockClient.callback.resolves({id_token: "test-id-token"});
			mockClient.userinfo.resolves({preferred_username: 12345}); // Not a string

			const result = await openidAuth.handleCallback("socket-123", "code=abc&state=xyz");

			expect(result).to.be.null;
			sinon.assert.called(logStubs.warn);
		});

		it("should handle empty roles array gracefully", async function () {
			Config.values.openid.enable = true;
			Config.values.openid.usernameClaim = "preferred_username";
			Config.values.openid.roleClaim = "roles";
			Config.values.openid.requiredRoles = ["admin"];
			await openidAuth.initialize();

			openidAuth.getAuthUrl("socket-123");

			mockClient.callback.resolves({id_token: "test-id-token"});
			mockClient.userinfo.resolves({
				preferred_username: "testuser",
				// roles not present - should default to empty array
			});

			const result = await openidAuth.handleCallback("socket-123", "code=abc&state=xyz");

			expect(result).to.be.null;
			sinon.assert.called(logStubs.warn);
		});
	});

	describe("isEnabled", function () {
		let originalPublic: boolean;

		beforeEach(function () {
			originalPublic = Config.values.public;
		});

		afterEach(function () {
			Config.values.public = originalPublic;
		});

		it("should return false when public mode is enabled", function () {
			Config.values.public = true;
			Config.values.openid.enable = true;
			expect(openidAuth.isEnabled()).to.be.false;
		});

		it("should return false when OpenID is disabled", function () {
			Config.values.public = false;
			Config.values.openid.enable = false;
			expect(openidAuth.isEnabled()).to.be.false;
		});

		it("should return true when not public and OpenID is enabled", function () {
			Config.values.public = false;
			Config.values.openid.enable = true;
			expect(openidAuth.isEnabled()).to.be.true;
		});
	});
});
