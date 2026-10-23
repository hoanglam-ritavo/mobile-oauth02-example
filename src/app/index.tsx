import React, { useState } from 'react';
import {
  Platform, Pressable, ScrollView, StyleSheet, Text, View,
  useColorScheme, useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Fonts, HomeColors, type HomePalette } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';

const groupLabels = { EMPLOYEE: 'Employee', CUSTOMER: 'Customer', ENTERPRISE: 'Enterprise' };

function DetailRow({ label, value, colors, first = false, mono = false }: {
  label: string;
  value: string | null | undefined;
  colors: HomePalette;
  first?: boolean;
  mono?: boolean;
}) {
  return (
    <View style={[styles.detailRow, !first && styles.divider, { borderColor: colors.border }]}>
      <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>
      <Text selectable style={[styles.value, mono && styles.mono, { color: colors.text }]}>
        {value?.trim() || '—'}
      </Text>
    </View>
  );
}

export default function HomeScreen() {
  const { user, logout } = useAuth();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const scheme = useColorScheme();
  const colors = HomeColors[scheme === 'dark' ? 'dark' : 'light'];
  const { fontScale, width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const name = user?.name.trim() || 'Unnamed user';
  const initials = user?.name.trim().split(/\s+/).filter(Boolean)
    .slice(0, 2).map(part => Array.from(part)[0]).join('').toUpperCase() || '?';
  const card = { backgroundColor: colors.surface, borderColor: colors.border };

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: colors.background }]}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={[
        styles.scrollContent,
        // NativeTabs owns the bottom inset; iOS adjusts this root ScrollView automatically.
        Platform.OS === 'android' && {
          paddingTop: insets.top + 20,
          paddingLeft: insets.left + 20,
          paddingRight: insets.right + 20,
        },
      ]}>
      <View style={styles.content}>
        <View style={styles.header}>
          <Text accessibilityLabel="Rita Võ ID" style={[styles.logo, { color: colors.brand }]}>
            RITAVÕ<Text style={{ color: colors.text }}>.ID</Text>
          </Text>
          <Text style={[styles.label, { color: colors.textSecondary }]}>OAuth example</Text>
        </View>

        <View style={[styles.card, styles.profile, card,
          (fontScale >= 1.5 || width < 350) && styles.profileStacked]}>
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
            style={[styles.avatar, { backgroundColor: colors.accent }]}>
            <Text maxFontSizeMultiplier={1.3} style={[styles.initials, { color: colors.brand }]}>{initials}</Text>
          </View>
          <View style={styles.identity}>
            <Text accessibilityRole="header" style={[styles.name, { color: colors.text }]}>{name}</Text>
            <View style={[styles.badge, { backgroundColor: colors.accent }]}>
              <Text style={[styles.badgeText, { color: colors.brand }]}>
                {user ? groupLabels[user.groups] : '—'}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text accessibilityRole="header" style={[styles.sectionTitle, { color: colors.text }]}>
            Account information
          </Text>
          <View style={[styles.card, styles.details, card]}>
            <DetailRow first label="Employee ID" value={user?.employee_id} colors={colors} />
            <DetailRow label="Email" value={user?.email} colors={colors} />
            <DetailRow label="Phone" value={user?.phone_number} colors={colors} />
          </View>
        </View>

        <View style={[styles.card, card]}>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: detailsOpen }}
            accessibilityLabel="Integration details"
            onPress={() => setDetailsOpen(open => !open)}
            style={({ pressed }) => [styles.disclosure, pressed && { backgroundColor: colors.accent }]}>
            <Text style={[styles.sectionTitle, styles.disclosureTitle, { color: colors.text }]}>
              Integration details
            </Text>
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
              style={[styles.chevron, { borderColor: colors.textSecondary,
                transform: [{ rotate: detailsOpen ? '225deg' : '45deg' }] }]} />
          </Pressable>
          {detailsOpen && (
            <View style={[styles.integrationContent, { borderColor: colors.border }]}>
              <DetailRow first mono label="Local UUID" value={user?._id} colors={colors} />
              <DetailRow label="Group" value={user?.groups} colors={colors} />
              <DetailRow label="Developer access" value={user ? (user.is_developer ? 'Yes' : 'No') : null} colors={colors} />
            </View>
          )}
        </View>

        <Pressable accessibilityRole="button" onPress={logout}
          style={({ pressed }) => [styles.signOut, { borderColor: colors.border,
            backgroundColor: pressed ? colors.accent : colors.surface }]}>
          <Text style={[styles.sectionTitle, { color: colors.brand }]}>Sign out</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scrollContent: { padding: 20, alignItems: 'center' },
  content: { width: '100%', maxWidth: 560, gap: 24 },
  header: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  logo: { fontSize: 24, fontWeight: '900', letterSpacing: -0.8, flexShrink: 1 },
  card: { borderWidth: 1, borderRadius: 16, overflow: 'hidden' },
  profile: { padding: 20, flexDirection: 'row', alignItems: 'center', gap: 16 },
  profileStacked: { flexDirection: 'column', alignItems: 'stretch' },
  avatar: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  initials: { fontSize: 24, fontWeight: '700' },
  identity: { flexShrink: 1, gap: 8 },
  name: { fontSize: 22, fontWeight: '600' },
  badge: { alignSelf: 'flex-start', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, maxWidth: '100%' },
  badgeText: { fontSize: 13, fontWeight: '600' },
  section: { gap: 12 },
  sectionTitle: { fontSize: 16, fontWeight: '600' },
  details: { paddingHorizontal: 20 },
  detailRow: { paddingVertical: 16, gap: 6 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth },
  label: { fontSize: 14 },
  value: { fontSize: 16, lineHeight: 24 },
  mono: { fontFamily: Fonts.mono },
  disclosure: { minHeight: 64, padding: 20, flexDirection: 'row', alignItems: 'center', gap: 16 },
  disclosureTitle: { flex: 1 },
  chevron: { width: 8, height: 8, borderRightWidth: 2, borderBottomWidth: 2, marginRight: 3 },
  integrationContent: { marginHorizontal: 20, borderTopWidth: StyleSheet.hairlineWidth },
  signOut: { minHeight: 48, borderWidth: 1, borderRadius: 12, padding: 14, alignItems: 'center', justifyContent: 'center' },
});
