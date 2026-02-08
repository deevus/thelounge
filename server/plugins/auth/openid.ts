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
		log.error(
			`OpenID: Authentication failed - no username provided (check usernameClaim configuration)`
		);
		callback(false);
		return;
	}

	log.debug(`OpenID: Authenticating user '${user}', existing=${!!existingUser}`);

	// If no user is found, create it (unless they already exist on disk)
	if (!existingUser && !manager.getUsers().includes(user)) {
		log.info(`OpenID: Creating new user '${user}'`);
		manager.addUser(user, null, true);
	}

	callback(true);
}

function isOpenIDEnabled() {
	return !Config.values.public && Config.values.openid.enable;
}

// Types for callback result
export interface CallbackResult {
	username: string;
	idToken?: string;
}

// Stub implementations - will be filled in subsequent tasks
async function initialize(): Promise<boolean> {
	return false;
}

function getAuthUrl(_socketId: string): string | null {
	return null;
}

async function handleCallback(
	_socketId: string,
	_params: string
): Promise<CallbackResult | null> {
	return null;
}

function buildLogoutUrl(_idToken?: string): string | undefined {
	return undefined;
}

function cleanup(_socketId: string): void {
	// no-op stub
}

export default {
	moduleName: "openid",
	auth: openIDAuth,
	isEnabled: isOpenIDEnabled,
	initialize,
	getAuthUrl,
	handleCallback,
	buildLogoutUrl,
	cleanup,
};
