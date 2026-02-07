import storage from "./localStorage";
import location from "./location";

type SignoutParams = {
	logoutUrl?: string;
};

export default class Auth {
	static signout(params: SignoutParams = {}) {
		const {logoutUrl} = params;

		storage.clear();

		if (logoutUrl) {
			location.replace(logoutUrl);
		} else {
			location.reload();
		}
	}
}
