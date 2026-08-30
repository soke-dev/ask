import React, { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { text } from '@/constants/type';
import { LEGAL } from '@/constants/legal';



export default function LegalScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? 22 : insets.top + 6;

  /**
   * Opened straight onto one document when something links to it.
   *
   * Sign-in points here to say what somebody is agreeing to, and landing them
   * on a list to hunt through would be the same problem in a new place.
   */
  const { doc } = useLocalSearchParams<{ doc?: string }>();
  const [openDoc, setOpenDoc] = useState<string | null>(
    doc ? (LEGAL.find((d) => d.title.toLowerCase().startsWith(doc.toLowerCase()))?.title ?? null) : null,
  );

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingTop: topPad, paddingBottom: insets.bottom + 40 }]}
      >
        <Pressable
          onPress={() => router.back()}
          style={[styles.backBtn, { borderColor: colors.border }]}
        >
          <Ionicons name="arrow-back" size={18} color={colors.foreground} />
        </Pressable>

        <Text style={[text.display, { color: colors.foreground, marginTop: 22 }]}>Legal</Text>
        <Text style={[text.bodySmall, { color: colors.mutedForeground, marginTop: 6 }]}>
          Written in plain language so they can be read. They have not yet been reviewed by a
          lawyer, and some limits below may be narrower in practice than they are written, because
          consumer law overrides an agreement in places.
        </Text>

        {LEGAL.map((d) => {
          const expanded = openDoc === d.title;
          return (
            <Pressable
              key={d.title}
              onPress={() => setOpenDoc(expanded ? null : d.title)}
              style={[styles.row, { borderBottomColor: colors.border }]}
            >
              <View style={styles.head}>
                <Text style={[text.subheading, { color: colors.foreground, flex: 1 }]}>
                  {d.title}
                </Text>
                <Ionicons
                  name={expanded ? 'chevron-up' : 'chevron-down'}
                  size={15}
                  color={colors.faintForeground}
                />
              </View>
              {expanded &&
                d.body.map((para) => (
                  <Text
                    key={para}
                    style={[text.bodySmall, { color: colors.mutedForeground, marginTop: 10 }]}
                  >
                    {para}
                  </Text>
                ))}
            </Pressable>
          );
        })}

        <Text style={[text.data, { color: colors.faintForeground, marginTop: 24 }]}>
          Questions about any of this go to help@confam.xyz
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scroll: { paddingHorizontal: 20 },
  backBtn: {
    width: 38,
    height: 38,
    borderWidth: 2,
    borderRadius: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: { paddingVertical: 16, borderBottomWidth: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});
