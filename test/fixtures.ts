import { readAuthConfig } from "../src/constants/config";
import { parseProfile, positionCategories } from "../src/services/auth-service";
export const config = readAuthConfig({
  EXPO_PUBLIC_RITA_BASE_URL: "https://id.example.invalid",
  EXPO_PUBLIC_APP_BACKEND_BASE_URL: "https://app.example.invalid",
  EXPO_PUBLIC_OAUTH_CLIENT_ID: "mobile-client",
});

console.log("config : ", config);
export const wireProfile = {
  sub: "12345678-1234-4123-8123-123456789012",
  name: "Test",
  email: "test@example.invalid",
  employee_id: null,
  phone_number: null,
  is_developer: false,
  groups: "EMPLOYEE",
  avatar: null,
  position: {
    text: null,
    parser: {
      ...Object.fromEntries(positionCategories.map((key) => [key, ""])),
      others: [],
    },
  },
};
export const user = parseProfile(wireProfile);
export const expiry = "2030-01-01T00:00:00.000Z";
