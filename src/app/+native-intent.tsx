import { RITA_CALLBACK_URI } from "../constants/config";

// Native Linking receives the original URL. Keep callback fields out of router state.
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  if (path === RITA_CALLBACK_URI || path.startsWith(RITA_CALLBACK_URI + "?") ||
      path === "/redirect" || path.startsWith("/redirect?")) return "/";
  return path;
}