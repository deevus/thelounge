import socket from "../socket";
import Auth from "../auth";

socket.on("sign-out", function (data?: {logoutUrl?: string}) {
	if (data?.logoutUrl) {
		window.location.replace(data.logoutUrl);
	} else {
		Auth.signout();
	}
});
