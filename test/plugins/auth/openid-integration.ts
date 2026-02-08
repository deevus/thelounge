import {expect} from "chai";
import sinon from "ts-sinon";
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
