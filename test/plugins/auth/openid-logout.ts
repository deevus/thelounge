import {expect} from "chai";
import type {UserConfig} from "../../../server/client";

describe("OpenID front-channel logout", function () {
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
});
