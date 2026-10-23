import React from 'react';
import { StyleSheet, View, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useAuth } from '../context/auth-context';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/constants/theme';

export default function LoginScreen() {
  const { login, logout, retry, status, supported, configured, isLoading, error } = useAuth();
  const theme = useTheme();

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.heroSection}>
          <View style={[styles.logoContainer, { backgroundColor: '#3b82f6' }]}>
            <ThemedText type="subtitle" style={styles.logoText}>R</ThemedText>
          </View>
          
          <ThemedText type="title" style={styles.title}>
            Rita ID
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.subtitle}>
            Single Sign-On Identity & Access
          </ThemedText>
        </View>

        <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText type="smallBold" style={styles.cardTitle}>
            Secure Mobile Sign-In
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.cardDesc}>
            Authenticate securely using your organization email via Rita ID SSO Provider.
          </ThemedText>

          {error && (
            <View style={styles.errorContainer}>
              <ThemedText type="code" style={styles.errorText}>
                {error}
              </ThemedText>
            </View>
          )}

          <Pressable
            onPress={status === 'unverified' ? retry : status === 'error' && configured ? logout : login}
            disabled={isLoading || !supported || !configured}
            style={({ pressed }) => [
              styles.loginButton,
              { backgroundColor: '#2563eb' },
              pressed && styles.pressed,
              isLoading && styles.disabled,
            ]}
          >
            {isLoading ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <ThemedText style={styles.loginButtonText}>
                {status === 'unverified' ? 'Retry session verification' : status === 'error' && configured ? 'Retry sign-out' : 'Sign In with Rita ID'}
              </ThemedText>
            )}
          </Pressable>
          {status === 'unverified' && (
            <Pressable onPress={logout} disabled={isLoading}>
              <ThemedText type="small">Sign out on this device</ThemedText>
            </Pressable>
          )}
        </View>

        <View style={styles.footer}>
          <ThemedText type="code" themeColor="textSecondary" style={styles.footerText}>
            Rita ID SSO Identity System © 2026 RITA VO
          </ThemedText>
        </View>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  safeArea: {
    flex: 1,
    width: '100%',
    maxWidth: 400,
    paddingHorizontal: Spacing.four,
    justifyContent: 'space-between',
    paddingVertical: Spacing.six,
  },
  heroSection: {
    alignItems: 'center',
    marginTop: Spacing.six,
    gap: Spacing.two,
  },
  logoContainer: {
    width: 64,
    height: 64,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.two,
    shadowColor: '#2563eb',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  logoText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 32,
  },
  title: {
    fontSize: 36,
    fontWeight: '800',
    textAlign: 'center',
  },
  subtitle: {
    textAlign: 'center',
  },
  card: {
    padding: Spacing.five,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    gap: Spacing.four,
  },
  cardTitle: {
    fontSize: 18,
    textAlign: 'center',
  },
  cardDesc: {
    textAlign: 'center',
    lineHeight: 20,
  },
  loginButton: {
    paddingVertical: Spacing.three,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    height: 48,
  },
  loginButtonText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 16,
  },
  errorContainer: {
    padding: Spacing.three,
    borderRadius: 12,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.2)',
  },
  errorText: {
    color: '#ef4444',
    textAlign: 'center',
  },
  footer: {
    alignItems: 'center',
    marginBottom: Spacing.two,
  },
  footerText: {
    fontSize: 10,
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.8,
  },
  disabled: {
    opacity: 0.6,
  },
});
