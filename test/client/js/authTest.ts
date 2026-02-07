import {expect} from "chai";
import sinon from "ts-sinon";
import Auth from "../../../client/js/auth";
import localStorage from "../../../client/js/localStorage";
import location from "../../../client/js/location";

describe("Auth", function () {
	describe(".signout", function () {
		let localStorageClearStub: sinon.SinonStub<[], void>;
		let locationReloadStub: sinon.SinonStub<[], void>;
		let locationReplaceStub: sinon.SinonStub<[string], void>;

		beforeEach(function () {
			localStorageClearStub = sinon.stub(localStorage, "clear");
			locationReloadStub = sinon.stub(location, "reload");
			locationReplaceStub = sinon.stub(location, "replace");
		});

		afterEach(function () {
			localStorageClearStub.restore();
			locationReloadStub.restore();
			locationReplaceStub.restore();
		});

		it("should empty the local storage", function () {
			Auth.signout();
			// @ts-expect-error ts-migrate(2339) FIXME: Property 'calledOnce' does not exist on type '() =... Remove this comment to see the full error message
			expect(localStorage.clear.calledOnce).to.be.true;
		});

		it("should reload the page when no logoutUrl provided", function () {
			Auth.signout();
			// @ts-expect-error ts-migrate(2339) FIXME: Property 'calledOnce' does not exist on type '{ ()... Remove this comment to see the full error message
			expect(location.reload.calledOnce).to.be.true;
			expect(locationReplaceStub.called).to.be.false;
		});

		it("should redirect to logoutUrl when provided", function () {
			const logoutUrl = "https://auth.example.com/logout";
			Auth.signout({logoutUrl});
			expect(locationReplaceStub.calledOnce).to.be.true;
			expect(locationReplaceStub.calledWith(logoutUrl)).to.be.true;
			expect(locationReloadStub.called).to.be.false;
		});

		it("should clear storage before redirecting to logoutUrl", function () {
			Auth.signout({logoutUrl: "https://auth.example.com/logout"});
			// @ts-expect-error ts-migrate(2339) FIXME: Property 'calledOnce' does not exist on type '() =... Remove this comment to see the full error message
			expect(localStorage.clear.calledOnce).to.be.true;
			expect(localStorageClearStub.calledBefore(locationReplaceStub)).to.be.true;
		});
	});
});
