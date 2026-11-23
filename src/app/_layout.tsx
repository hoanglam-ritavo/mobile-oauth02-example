import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import React from "react";
import { StatusBar } from "expo-status-bar";
import {
  useColorScheme,
  ActivityIndicator,
  View,
  StyleSheet,
  Pressable,
  Text,
} from "react-native";

import { AuthProvider, useAuth } from "../context/auth-context";

function AppContent() {
  const { status, user, isLoading, logout } = useAuth();
  const colorScheme = useColorScheme();
  const authenticated = status === "authenticated" && user !== null;

  return (
    <View style={styles.root}>
      <View
        style={styles.root}
        accessibilityElementsHidden={isLoading}
        importantForAccessibility={isLoading ? "no-hide-descendants" : "auto"}
      >
        <Stack screenOptions={{ headerShown: false, animation: "none" }}>
          <Stack.Protected guard={authenticated}>
            <Stack.Screen name="index" />
          </Stack.Protected>
          <Stack.Protected guard={!authenticated}>
            <Stack.Screen name="login" />
          </Stack.Protected>
          <Stack.Screen name="redirect" />
        </Stack>
      </View>
      {authenticated && <StatusBar style={colorScheme === "dark" ? "light" : "dark"} />}
      {isLoading && (
        <View style={styles.loadingContainer} accessibilityViewIsModal>
          <ActivityIndicator size="large" color="#3b82f6" accessibilityLabel="Đang xử lý đăng nhập" />
          <Pressable onPress={logout} accessibilityRole="button">
            <Text style={styles.loadingAction}>Cancel / sign out</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <AuthProvider>
      <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
        <AppContent />
      </ThemeProvider>
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  loadingContainer: {
    ...StyleSheet.absoluteFill,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#09090b",
    zIndex: 99,
  },
  loadingAction: { color: "#ffffff", padding: 16 },
});
