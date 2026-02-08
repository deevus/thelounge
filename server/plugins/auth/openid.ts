import log from "../../log";
import Config from "../../config";
import ClientManager from "../../clientManager";
import Client from "../../client";
import {Issuer, generators, errors, BaseClient} from "openid-client";

// Per-socket PKCE state
interface SocketState {
	codeVerifier: string;
	state: string;
	createdAt: number;
}

const socketStates = new Map<string, SocketState>();
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// OIDC client - set during initialize()
let issuer: Issuer | null = null;
let openidClient: BaseClient | null = null;
let initialized = false;

// TTL sweep using setTimeout self-scheduling pattern
function scheduleSweep() {
	setTimeout(() => {
		const now = Date.now();

		for (const [socketId, state] of socketStates) {
			if (now - state.createdAt > STATE_TTL_MS) {
				socketStates.delete(socketId);
				log.debug(`OpenID: Cleaned up stale state for socket ${socketId}`);
			}
		}

		scheduleSweep();
	}, 5 * 60 * 1000);
}

// Start sweep on module load
scheduleSweep();

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

async function initialize(): Promise<boolean> {
	if (!Config.values.openid.enable) {
		log.debug("OpenID: Disabled in configuration");
		return false;
	}

	if (initialized) {
		log.debug("OpenID: Already initialized");
		return true;
	}

	try {
		issuer = await Issuer.discover(Config.values.openid.issuerURL);
		log.info(`OpenID: Discovered issuer ${issuer.metadata.issuer}`);

		openidClient = new issuer.Client({
			client_id: Config.values.openid.clientID,
			client_secret: Config.values.openid.secret,
			redirect_uris: [Config.values.openid.baseURL],
			response_types: ["code"],
		});

		initialized = true;
		return true;
	} catch (err) {
		log.error(`OpenID: Failed to initialize - ${(err as Error).message}`);
		return false;
	}
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

function cleanup(socketId: string): void {
	if (socketStates.has(socketId)) {
		socketStates.delete(socketId);
		log.debug(`OpenID: Cleaned up state for socket ${socketId}`);
	}
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
