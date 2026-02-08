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
