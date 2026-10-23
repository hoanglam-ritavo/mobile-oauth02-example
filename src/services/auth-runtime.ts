import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import { getAuthConfig } from "../constants/config";
import { createAuthApi } from "./auth-service";
import { createBackendApi } from "./backend-service";
import { AuthSession } from "./auth-session";
import { base64Url, randomHex } from "./oauth-flow";
import { createSessionStorage } from "./session-storage";

export function createNativeAuthSession() {
  const config = getAuthConfig();

  console.log("config : ", config);
  return new AuthSession({
    config,
    api: createAuthApi(config),
    backend: createBackendApi(config),
    storage: createSessionStorage(SecureStore),
    random: () => randomHex(Crypto.getRandomBytes(32)),
    challenge: async (verifier) =>
      base64Url(
        await Crypto.digestStringAsync(
          Crypto.CryptoDigestAlgorithm.SHA256,
          verifier,
          { encoding: Crypto.CryptoEncoding.BASE64 },
        ),
      ),
    browser: (url, redirect) => WebBrowser.openAuthSessionAsync(url, redirect),
  });
}
