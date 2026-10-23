import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from "expo-router/react-navigation";
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

import { AnimatedSplashOverlay } from "@/components/animated-icon";
import AppTabs from "@/components/app-tabs";
import { AuthProvider, useAuth } from "../context/auth-context";
import LoginScreen from "./login";

function AppContent() {
  const { user, isLoading, logout } = useAuth();
  const colorScheme = useColorScheme();

  if (isLoading) {
    return (
      <>
        <AnimatedSplashOverlay />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#3b82f6" />
          <Pressable onPress={logout} accessibilityRole="button">
            <Text style={{ color: '#ffffff', padding: 16 }}>Cancel / sign out</Text>
          </Pressable>
        </View>
      </>
    );
  }

  if (!user) {
    return <LoginScreen />;
  }

  return (
    <>
      <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
      <AppTabs />
    </>
  );
}

export default function TabLayout() {
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
  loadingContainer: {
    ...StyleSheet.absoluteFill,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#09090b",
    zIndex: 99,
  },
});
