import log from "../../log";
import Config from "../../config";
import ClientManager from "../../clientManager";
import Client from "../../client";

function openIDAuth(
	manager: ClientManager,
	existingUser: Client | null,
	user: string,
	_password: string,
	callback: (success: boolean) => void
): void {
	if (user === "") {
		log.error(`Authentication failed`);
		callback(false);
		return;
	}

	// If no user is found, create it
	if (!existingUser) {
		manager.addUser(user, null, true);
	}

	callback(true);
}

function isOpenIDEnabled() {
	return !Config.values.public && Config.values.openid.enable;
}

export default {
	moduleName: "openid",
	auth: openIDAuth,
	isEnabled: isOpenIDEnabled,
};
