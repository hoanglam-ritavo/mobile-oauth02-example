import { NativeTabs } from 'expo-router/unstable-native-tabs';
import React from 'react';
import { useColorScheme } from 'react-native';

import { HomeColors } from '@/constants/theme';

export default function AppTabs() {
  const scheme = useColorScheme();
  const colors = HomeColors[scheme === 'dark' ? 'dark' : 'light'];

  return (
    <NativeTabs
      backgroundColor={colors.surface}
      indicatorColor={colors.accent}
      tintColor={colors.brand}
      iconColor={{ default: colors.textSecondary, selected: colors.brand }}
      disableTransparentOnScrollEdge
      labelStyle={{ default: { color: colors.textSecondary }, selected: { color: colors.brand } }}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          src={require('@/assets/images/tabIcons/home.png')}
          renderingMode="template"
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="explore">
        <NativeTabs.Trigger.Label>Explore</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          src={require('@/assets/images/tabIcons/explore.png')}
          renderingMode="template"
        />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
