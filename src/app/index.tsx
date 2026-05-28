import React from 'react';
import { StyleSheet, View, Text, Image, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../context/auth-context';

function Barcode({ value }: { value: string }) {
  // Mock barcode pattern of bar widths
  const pattern = [
    2, 1, 3, 1, 2, 4, 1, 2, 1, 3, 2, 1, 4, 2, 1, 1, 3, 1, 2, 4, 1, 2, 1, 3, 2, 1, 4, 2, 1, 1, 2, 1, 3, 1, 2
  ];
  return (
    <View style={styles.barcodeContainer}>
      <View style={styles.barcodeRow}>
        {pattern.map((width, idx) => (
          <View
            key={idx}
            style={{
              width: width,
              height: 44,
              backgroundColor: idx % 2 === 0 ? '#000000' : 'transparent',
            }}
          />
        ))}
      </View>
      <Text style={styles.barcodeText}>{value}</Text>
    </View>
  );
}

export default function HomeScreen() {
  const { user, logout } = useAuth();

  // Clean professional avatar placeholder matching mockup portrait style
  const avatarUrl = 'https://images.unsplash.com/photo-1560250097-0b93528c311a?w=400&auto=format&fit=crop&q=80';

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.card}>
        {/* Logo Section */}
        <View style={styles.logoRow}>
          <Text style={styles.logoRed}>RITAVÕ</Text>
          <Text style={styles.logoBlack}>.ID</Text>
        </View>

        {/* Avatar Section */}
        <View style={styles.avatarContainer}>
          <Image
            source={{ uri: avatarUrl }}
            style={styles.avatar}
          />
        </View>

        {/* Name */}
        <Text style={styles.nameText}>
          {user?.name?.toUpperCase() || ''}
        </Text>

        {/* Action Button */}
        <Pressable
          onPress={logout}
          style={({ pressed }) => [
            styles.actionButton,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.actionButtonText}>SIGN OUT</Text>
        </Pressable>

        {/* Details List */}
        <View style={styles.detailsContainer}>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>RitaID No</Text>
            <Text style={styles.detailValue}>: {user?.employee_id || user?.sub || '1234567890'}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Account</Text>
            <Text style={styles.detailValue}>: {user?.email || 'morgan@gmail.com'}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Phone</Text>
            <Text style={styles.detailValue}>: {user?.phone_number || 'N/A'}</Text>
          </View>
        </View>

        {/* Barcode Section */}
        <Barcode value={user?.employee_id || String(user?.sub) || '1234567890'} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f3f4f6', // Light gray background to pop the white card
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    width: '90%',
    maxWidth: 350,
    backgroundColor: '#ffffff',
    borderRadius: 24,
    paddingVertical: 32,
    paddingHorizontal: 24,
    alignItems: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 8,
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
  logoRed: {
    fontSize: 28,
    fontWeight: '900',
    color: '#e11d48', // Red brand color
    letterSpacing: -1,
  },
  logoBlack: {
    fontSize: 28,
    fontWeight: '900',
    color: '#1f2937', // Dark gray/black
    letterSpacing: -1,
  },
  avatarContainer: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: '#e5e7eb',
    overflow: 'hidden',
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  avatar: {
    width: '100%',
    height: '100%',
  },
  nameText: {
    fontSize: 20,
    fontWeight: '800',
    color: '#000000',
    textAlign: 'center',
    marginBottom: 20,
    letterSpacing: 0.5,
  },
  actionButton: {
    width: '100%',
    height: 44,
    backgroundColor: '#2563eb', // Blue button color matching mockup
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 28,
  },
  actionButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 1,
  },
  detailsContainer: {
    width: '100%',
    paddingHorizontal: 8,
    marginBottom: 28,
    gap: 8,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  detailLabel: {
    width: 80,
    fontSize: 14,
    color: '#4b5563',
    fontWeight: '500',
  },
  detailValue: {
    flex: 1,
    fontSize: 14,
    color: '#1f2937',
    fontWeight: '600',
  },
  barcodeContainer: {
    alignItems: 'center',
    width: '100%',
  },
  barcodeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  barcodeText: {
    fontSize: 12,
    color: '#4b5563',
    letterSpacing: 3,
    fontWeight: '500',
  },
  pressed: {
    opacity: 0.85,
  },
});
