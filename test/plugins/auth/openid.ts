import log from "../../../server/log";
import openidAuth from "../../../server/plugins/auth/openid";
import Config from "../../../server/config";
import {expect} from "chai";
import TestUtil from "../../util";
import ClientManager from "../../../server/clientManager";
import Client from "../../../server/client";
import sinon from "ts-sinon";

describe("OpenID authentication plugin", function () {
	// Increase timeout due to unpredictable I/O on CI services
	this.timeout(TestUtil.isRunningOnCI() ? 25000 : 5000);
	this.slow(300);

	let logInfoStub: sinon.SinonStub<string[], void>;

	before(function () {
		logInfoStub = sinon.stub(log, "info");
	});

	after(function () {
		logInfoStub.restore();
	});

	beforeEach(function () {
		Config.values.public = false;
		Config.values.openid.enable = true;
	});

	afterEach(function () {
		Config.values.public = true;
		Config.values.openid.enable = false;
	});

	describe("OpenID authentication availability", function () {
		it("returns true when openid.enable is true and public is false", function () {
			Config.values.openid.enable = true;
			Config.values.public = false;
			expect(openidAuth.isEnabled()).to.equal(true);
		});

		it("returns false when openid.enable is false", function () {
			Config.values.openid.enable = false;
			Config.values.public = false;
			expect(openidAuth.isEnabled()).to.equal(false);
		});

		it("returns false when public is true", function () {
			Config.values.openid.enable = true;
			Config.values.public = true;
			expect(openidAuth.isEnabled()).to.equal(false);
		});
	});

	describe("OpenID authentication flow", function () {
		it("should succeed when user is provided", function (done) {
			const manager = {} as ClientManager;
			const existingUser = {} as Client;

			openidAuth.auth(manager, existingUser, "johndoe", "", function (valid) {
				expect(valid).to.equal(true);
				done();
			});
		});

		it("should fail when user is empty string", function (done) {
			const manager = {} as ClientManager;
			const existingUser = {} as Client;
			let error = "";

			const errorLogStub = sinon
				.stub(log, "error")
				.callsFake(TestUtil.sanitizeLog((str) => (error += str)));

			openidAuth.auth(manager, existingUser, "", "", function (valid) {
				expect(valid).to.equal(false);
				expect(error).to.equal("Authentication failed\n");
				errorLogStub.restore();
				done();
			});
		});

		it("should create new user when existingUser is null", function (done) {
			const addUserStub = sinon.stub();
			const manager = {
				addUser: addUserStub,
			} as unknown as ClientManager;

			openidAuth.auth(manager, null as unknown as Client, "newuser", "", function (valid) {
				expect(valid).to.equal(true);
				expect(addUserStub.calledOnce).to.equal(true);
				expect(addUserStub.calledWith("newuser", null, true)).to.equal(true);
				done();
			});
		});

		it("should not create user when existingUser exists", function (done) {
			const addUserStub = sinon.stub();
			const manager = {
				addUser: addUserStub,
			} as unknown as ClientManager;
			const existingUser = {} as Client;

			openidAuth.auth(manager, existingUser, "existinguser", "", function (valid) {
				expect(valid).to.equal(true);
				expect(addUserStub.called).to.equal(false);
				done();
			});
		});
	});
});
