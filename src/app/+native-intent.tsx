import { RITA_CALLBACK_URI } from "../constants/config";

// Native Linking receives the original URL. Keep callback fields out of router state.
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  const [entry] = path.split(/[?#]/, 1);
  if (entry === RITA_CALLBACK_URI || entry === "/redirect" || entry === "/--/redirect" ||
      /^exp:\/\/[^/]+\/--\/redirect$/.test(entry)) return "/";
  return path;
}
