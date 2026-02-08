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
// Uses .unref() to not keep Node.js process alive for tests
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
	}, 5 * 60 * 1000).unref();
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

function getAuthUrl(socketId: string): string | null {
	if (!initialized || !openidClient) {
		log.debug("OpenID: Cannot generate auth URL - not initialized");
		return null;
	}

	// Generate fresh PKCE values for this socket
	const codeVerifier = generators.codeVerifier();
	const codeChallenge = generators.codeChallenge(codeVerifier);
	const state = generators.state();

	// Store state for callback validation
	socketStates.set(socketId, {
		codeVerifier,
		state,
		createdAt: Date.now(),
	});

	log.debug(`OpenID: Generated auth URL for socket ${socketId}`);

	return openidClient.authorizationUrl({
		scope: "openid email profile",
		code_challenge: codeChallenge,
		code_challenge_method: "S256",
		state,
	});
}

async function handleCallback(socketId: string, params: string): Promise<CallbackResult | null> {
	if (!initialized || !openidClient) {
		log.warn("OpenID: Cannot handle callback - not initialized");
		return null;
	}

	const socketState = socketStates.get(socketId);

	if (!socketState) {
		log.warn(`OpenID: No state found for socket ${socketId}`);
		return null;
	}

	// Clean up state immediately (single use)
	socketStates.delete(socketId);

	try {
		const tokenSet = await openidClient.callback(
			Config.values.openid.baseURL,
			openidClient.callbackParams(params),
			{
				code_verifier: socketState.codeVerifier,
				state: socketState.state,
			}
		);

		log.debug(`OpenID: Token exchange successful for socket ${socketId}`);

		const userinfo = await openidClient.userinfo(tokenSet);
		log.debug(`OpenID: Retrieved userinfo, claims: [${Object.keys(userinfo).join(", ")}]`);

		const usernameClaim = Config.values.openid.usernameClaim;
		const extractedUsername = userinfo[usernameClaim];

		if (!extractedUsername || typeof extractedUsername !== "string") {
			log.warn(
				`OpenID: Username claim '${usernameClaim}' not found or invalid. ` +
					`Available claims: [${Object.keys(userinfo).join(", ")}]`
			);
			return null;
		}

		// Role-based authorization
		if (Config.values.openid.roleClaim !== "") {
			const availableRoles = (userinfo[Config.values.openid.roleClaim] as string[]) || [];
			const requiredRoles = Config.values.openid.requiredRoles;
			const userAuthorized = requiredRoles.every((role) => availableRoles.includes(role));

			if (!userAuthorized) {
				log.warn(
					`OpenID: User '${extractedUsername}' lacks required roles: ` +
						`has [${availableRoles.join(", ")}], needs [${requiredRoles.join(", ")}]`
				);
				return null;
			}
		}

		return {
			username: extractedUsername,
			idToken: tokenSet.id_token,
		};
	} catch (e) {
		if (e instanceof errors.OPError) {
			log.warn(
				`OpenID: Provider error - ${e.error} (${e.error_description || "no description"})`
			);
		} else if (e instanceof errors.RPError) {
			log.warn(`OpenID: Validation error - ${e.message}`);
		} else if (e instanceof Error && "code" in e) {
			log.warn(`OpenID: Provider unreachable - ${(e as NodeJS.ErrnoException).code}`);
		} else {
			log.warn(`OpenID: Authentication failed - ${String(e)}`);
		}

		return null;
	}
}

function buildLogoutUrl(idToken?: string): string | undefined {
	if (!Config.values.openid.logout) {
		return undefined;
	}

	if (!initialized || !issuer?.metadata?.end_session_endpoint) {
		return undefined;
	}

	const endSessionEndpoint = issuer.metadata.end_session_endpoint as string;

	if (idToken) {
		return `${endSessionEndpoint}?id_token_hint=${encodeURIComponent(idToken)}`;
	}

	return endSessionEndpoint;
}

function cleanup(socketId: string): void {
	if (socketStates.has(socketId)) {
		socketStates.delete(socketId);
		log.debug(`OpenID: Cleaned up state for socket ${socketId}`);
	}
}

// For testing only - resets module state
function _resetForTesting(): void {
	socketStates.clear();
	issuer = null;
	openidClient = null;
	initialized = false;
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
	_resetForTesting,
};
