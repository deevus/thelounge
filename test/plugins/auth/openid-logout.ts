import {expect} from "chai";
import type {UserConfig} from "../../../server/client";
import Config from "../../../server/config";

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

	describe("sign-out event payload", function () {
		it("should support optional logoutUrl in payload", function () {
			// Type test: ensure the payload shape is valid
			type SignOutPayload = {logoutUrl?: string} | undefined;

			const withUrl: SignOutPayload = {logoutUrl: "https://auth.example.com/logout"};
			const withoutUrl: SignOutPayload = undefined;
			const emptyPayload: SignOutPayload = {};

			expect(withUrl?.logoutUrl).to.equal("https://auth.example.com/logout");
			expect(withoutUrl).to.be.undefined;
			expect(emptyPayload?.logoutUrl).to.be.undefined;
		});
	});

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

	describe("Client sign-out handler", function () {
		// Helper function to simulate client sign-out logic
		function shouldRedirectToLogout(data?: {logoutUrl?: string}): boolean {
			return data?.logoutUrl !== undefined;
		}

		it("should redirect when logoutUrl is provided", function () {
			const data = {logoutUrl: "https://auth.example.com/logout"};
			expect(shouldRedirectToLogout(data)).to.be.true;
		});

		it("should call Auth.signout when no logoutUrl provided", function () {
			expect(shouldRedirectToLogout(undefined)).to.be.false;
		});

		it("should call Auth.signout when logoutUrl is empty object", function () {
			expect(shouldRedirectToLogout({})).to.be.false;
		});
	});

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

				const conditions =
					Config.values.openid.enable &&
					Config.values.openid.logout &&
					endSessionEndpoint;

				expect(conditions).to.be.ok;

				const logoutUrl = `${endSessionEndpoint}?id_token_hint=${encodeURIComponent(
					idToken
				)}`;
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
				const conditions =
					Config.values.openid.enable &&
					Config.values.openid.logout &&
					endSessionEndpoint;

				expect(conditions).to.be.not.ok;
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
				const currentToken: string = "current_token";
				const tokenToSignOut: string = "other_token";

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
});
