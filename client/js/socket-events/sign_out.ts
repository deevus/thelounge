import socket from "../socket";
import Auth from "../auth";

socket.on("sign-out", function (data?: {logoutUrl?: string}) {
	Auth.signout({logoutUrl: data?.logoutUrl});
});
