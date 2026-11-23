import { isRunningInExpoGo } from "expo";
import * as Crypto from "expo-crypto";
import * as Linking from "expo-linking";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { getAuthConfig } from "../constants/config";
import { AuthSession } from "./auth-session";
import { createBackendApi } from "./backend-service";
import { base64Url, randomHex } from "./oauth-flow";
import { createSessionStorage } from "./session-storage";

export function createNativeAuthSession() {
  const config = getAuthConfig(Platform.OS === "android" && isRunningInExpoGo());
  return new AuthSession({
    config,
    backend: createBackendApi(config),
    storage: createSessionStorage(SecureStore),
    verifier: () => randomHex(Crypto.getRandomBytes(32)),
    challenge: async verifier => base64Url(await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256, verifier, { encoding: Crypto.CryptoEncoding.BASE64 },
    )),
    links: {
      open: Linking.openURL,
      initial: Linking.getInitialURL,
      subscribe(receive) {
        const subscription = Linking.addEventListener("url", ({ url }) => receive(url));
        return () => subscription.remove();
      },
    },
  });
}
