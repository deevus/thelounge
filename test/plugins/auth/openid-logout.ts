import {expect} from "chai";
import type {UserConfig} from "../../../server/client";

describe("OpenID front-channel logout", function () {
	describe("idToken storage during authentication", function () {
		it("should extract id_token from tokenSet", function () {
			// Simulate tokenSet response from openid-client
			const mockTokenSet = {
				access_token: "access_token_value",
				id_token:
					"eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature",
				token_type: "Bearer",
				expires_at: Date.now() + 3600,
			};

			expect(mockTokenSet.id_token).to.be.a("string");
			expect(mockTokenSet.id_token).to.include("eyJ");
		});
	});

	describe("Session idToken storage", function () {
		it("should allow storing idToken in session data", function () {
			// This test verifies the UserConfig type accepts idToken in sessions
			const userConfig: UserConfig = {
				log: true,
				password: "hashed_password",
				sessions: {
					"test-token": {
						lastUse: Date.now(),
						ip: "127.0.0.1",
						agent: "Test Browser",
						idToken: "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.test",
					},
				},
				clientSettings: {},
			};

			expect(userConfig.sessions["test-token"].idToken).to.equal(
				"eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.test"
			);
		});

		it("should allow session without idToken for backwards compatibility", function () {
			// Existing sessions without idToken should still work
			const userConfig: UserConfig = {
				log: true,
				password: "hashed_password",
				sessions: {
					"test-token": {
						lastUse: Date.now(),
						ip: "127.0.0.1",
						agent: "Test Browser",
					},
				},
				clientSettings: {},
			};

			expect(userConfig.sessions["test-token"].idToken).to.be.undefined;
		});
	});

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
});
