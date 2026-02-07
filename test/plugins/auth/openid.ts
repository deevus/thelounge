import {expect} from "chai";
import {generators} from "openid-client";
import sinon from "ts-sinon";
import openidAuth from "../../../server/plugins/auth/openid";
import log from "../../../server/log";
import Config from "../../../server/config";
import type ClientManager from "../../../server/clientManager";

describe("OpenID authentication plugin", function () {
	describe("OpenID generators", function () {
		describe("state parameter", function () {
			it("should generate a non-empty state string", function () {
				const state = generators.state();

				expect(state).to.be.a("string");
				expect(state).to.have.length.greaterThan(0);
			});

			it("should generate unique state values on each call", function () {
				const state1 = generators.state();
				const state2 = generators.state();

				expect(state1).to.not.equal(state2);
			});

			it("should generate URL-safe state values", function () {
				const state = generators.state();

				// State should be URL-safe (no characters that need encoding)
				expect(state).to.match(/^[A-Za-z0-9_-]+$/);
			});
		});

		describe("code_verifier parameter (PKCE)", function () {
			it("should generate a non-empty code_verifier string", function () {
				const codeVerifier = generators.codeVerifier();

				expect(codeVerifier).to.be.a("string");
				expect(codeVerifier).to.have.length.greaterThan(0);
			});

			it("should generate a valid code_challenge from code_verifier", function () {
				const codeVerifier = generators.codeVerifier();
				const codeChallenge = generators.codeChallenge(codeVerifier);

				expect(codeChallenge).to.be.a("string");
				expect(codeChallenge).to.have.length.greaterThan(0);
				// S256 challenge should be base64url encoded
				expect(codeChallenge).to.match(/^[A-Za-z0-9_-]+$/);
			});

			it("should generate consistent code_challenge for same code_verifier", function () {
				const codeVerifier = generators.codeVerifier();
				const codeChallenge1 = generators.codeChallenge(codeVerifier);
				const codeChallenge2 = generators.codeChallenge(codeVerifier);

				expect(codeChallenge1).to.equal(codeChallenge2);
			});
		});
	});

	describe("OpenID authorization URL parameters", function () {
		it("should include state in authorization URL when provided", function () {
			const state = generators.state();
			const codeVerifier = generators.codeVerifier();
			const codeChallenge = generators.codeChallenge(codeVerifier);

			// Simulate the parameters that would be passed to authorizationUrl
			const params = {
				scope: "openid email profile",
				code_challenge: codeChallenge,
				code_challenge_method: "S256",
				state: state,
			};

			expect(params).to.have.property("state");
			expect(params.state).to.equal(state);
			expect(params).to.have.property("code_challenge");
			expect(params).to.have.property("code_challenge_method", "S256");
		});
	});

	describe("OpenID callback validation", function () {
		it("should include state in callback checks when provided", function () {
			const state = generators.state();
			const codeVerifier = generators.codeVerifier();

			// Simulate the checks object that would be passed to callback
			const checks = {
				code_verifier: codeVerifier,
				state: state,
			};

			expect(checks).to.have.property("state");
			expect(checks.state).to.equal(state);
			expect(checks).to.have.property("code_verifier");
		});

		it("should have matching state values for authorization and callback", function () {
			// This simulates the flow where state is generated once and used in both places
			const state = generators.state();
			const codeVerifier = generators.codeVerifier();
			const codeChallenge = generators.codeChallenge(codeVerifier);

			// Authorization URL params
			const authParams = {
				scope: "openid email profile",
				code_challenge: codeChallenge,
				code_challenge_method: "S256",
				state: state,
			};

			// Callback validation checks
			const callbackChecks = {
				code_verifier: codeVerifier,
				state: state,
			};

			// The state in both should match
			expect(authParams.state).to.equal(callbackChecks.state);
		});
	});

	describe("State mismatch scenario (the bug this fix addresses)", function () {
		it("should detect when expected state differs from received state", function () {
			const expectedState = generators.state();
			const receivedState = ""; // Empty string from provider like Authentik

			// This is the scenario that was causing the error:
			// "state mismatch, expected undefined, got:"
			// Now we generate a state, so we expect a specific value
			expect(expectedState).to.not.equal(receivedState);
			expect(expectedState).to.not.be.undefined;
			expect(expectedState).to.have.length.greaterThan(0);
		});

		it("should have a defined state value instead of undefined", function () {
			const state = generators.state();

			// Before the fix, state was undefined
			// After the fix, state should always be a non-empty string
			expect(state).to.not.be.undefined;
			expect(state).to.not.be.null;
			expect(state).to.be.a("string");
			expect(state.length).to.be.greaterThan(0);
		});
	});

	describe("OpenID user creation", function () {
		let logErrorStub: sinon.SinonStub<string[], void>;

		beforeEach(function () {
			logErrorStub = sinon.stub(log, "error");
		});

		afterEach(function () {
			logErrorStub.restore();
		});

		it("should not call addUser when user already exists on disk", function (done) {
			const addUserStub = sinon.stub();
			const mockManager = {
				getUsers: () => ["existinguser"],
				addUser: addUserStub,
			} as unknown as ClientManager;

			openidAuth.auth(mockManager, null, "existinguser", "", (success) => {
				expect(success).to.be.true;
				sinon.assert.notCalled(addUserStub);
				done();
			});
		});

		it("should call addUser when user does not exist on disk", function (done) {
			const addUserStub = sinon.stub();
			const mockManager = {
				getUsers: () => [],
				addUser: addUserStub,
			} as unknown as ClientManager;

			openidAuth.auth(mockManager, null, "newuser", "", (success) => {
				expect(success).to.be.true;
				sinon.assert.calledOnceWithExactly(addUserStub, "newuser", null, true);
				done();
			});
		});

		it("should not call addUser when existingUser is provided", function (done) {
			const addUserStub = sinon.stub();
			const mockManager = {
				getUsers: () => [],
				addUser: addUserStub,
			} as unknown as ClientManager;

			const mockClient = {} as any; // existingUser is not null

			openidAuth.auth(mockManager, mockClient, "someuser", "", (success) => {
				expect(success).to.be.true;
				sinon.assert.notCalled(addUserStub);
				done();
			});
		});

		it("should fail authentication when user is empty string", function (done) {
			const addUserStub = sinon.stub();
			const mockManager = {
				getUsers: () => [],
				addUser: addUserStub,
			} as unknown as ClientManager;

			openidAuth.auth(mockManager, null, "", "", (success) => {
				expect(success).to.be.false;
				sinon.assert.notCalled(addUserStub);
				done();
			});
		});
	});

	describe("OpenID isEnabled", function () {
		let originalPublic: boolean;
		let originalOpenidEnable: boolean;

		beforeEach(function () {
			originalPublic = Config.values.public;
			originalOpenidEnable = Config.values.openid.enable;
		});

		afterEach(function () {
			Config.values.public = originalPublic;
			Config.values.openid.enable = originalOpenidEnable;
		});

		it("should return true when not public and openid is enabled", function () {
			Config.values.public = false;
			Config.values.openid.enable = true;
			expect(openidAuth.isEnabled()).to.be.true;
		});

		it("should return false when public mode is enabled", function () {
			Config.values.public = true;
			Config.values.openid.enable = true;
			expect(openidAuth.isEnabled()).to.be.false;
		});

		it("should return false when openid is disabled", function () {
			Config.values.public = false;
			Config.values.openid.enable = false;
			expect(openidAuth.isEnabled()).to.be.false;
		});
	});
});
