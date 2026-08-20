import { TextStyle } from 'react-native';

/**
 * Ask Nearby — "Signal" typography.
 *
 * Two voices, taken from how signage actually works:
 *   Barlow        — a grotesk with a direct transit-signage lineage. Carries
 *                   headlines and anything meant to be read at a glance,
 *                   mostly uppercase with open tracking.
 *   IBM Plex Mono — every figure and code: money, countdowns, distances,
 *                   coordinates, category codes, status labels. Monospace
 *                   keeps columns of numbers aligned and makes a value read
 *                   as a reading off an instrument rather than as prose.
 *
 * Body copy stays in Barlow; setting paragraphs in mono would be authentic to
 * a departure board and miserable to read.
 *
 * The string values must match the import names used in useFonts() in
 * app/_layout.tsx — that is what registers them as usable family names.
 */
export const font = {
  sans: 'Barlow_400Regular',
  sansMedium: 'Barlow_500Medium',
  sansSemi: 'Barlow_600SemiBold',
  sansBold: 'Barlow_700Bold',

  mono: 'IBMPlexMono_400Regular',
  monoMedium: 'IBMPlexMono_500Medium',
  monoSemi: 'IBMPlexMono_600SemiBold',
  monoBold: 'IBMPlexMono_700Bold',
} as const;

export const text = {
  /** Board headline. Uppercase, tight, unmissable. */
  display: {
    fontFamily: font.sansBold,
    fontSize: 32,
    lineHeight: 35,
    letterSpacing: -0.2,
    textTransform: 'uppercase',
  } as TextStyle,

  /** Screen title. */
  title: {
    fontFamily: font.sansBold,
    fontSize: 23,
    lineHeight: 26,
    letterSpacing: -0.1,
    textTransform: 'uppercase',
  } as TextStyle,

  /** Sentence-case headline for moments that should not shout. */
  titleSoft: {
    fontFamily: font.sansSemi,
    fontSize: 20,
    lineHeight: 26,
  } as TextStyle,

  /** Card and row headings. */
  heading: {
    fontFamily: font.sansSemi,
    fontSize: 16,
    lineHeight: 20,
  } as TextStyle,

  subheading: {
    fontFamily: font.sansMedium,
    fontSize: 14.5,
    lineHeight: 19,
  } as TextStyle,

  body: {
    fontFamily: font.sans,
    fontSize: 14.5,
    lineHeight: 21,
  } as TextStyle,

  bodySmall: {
    fontFamily: font.sans,
    fontSize: 13,
    lineHeight: 18,
  } as TextStyle,

  /** Route-code style marker: mono, uppercase, wide. One per section. */
  label: {
    fontFamily: font.monoSemi,
    fontSize: 10.5,
    lineHeight: 14,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
  } as TextStyle,

  /** Button text — stencilled, not chatty. */
  action: {
    fontFamily: font.monoSemi,
    fontSize: 13.5,
    lineHeight: 18,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  } as TextStyle,

  /** Money. */
  amount: {
    fontFamily: font.monoBold,
    fontSize: 20,
    lineHeight: 24,
    letterSpacing: -0.5,
  } as TextStyle,

  amountLarge: {
    fontFamily: font.monoBold,
    fontSize: 38,
    lineHeight: 44,
    letterSpacing: -1.5,
  } as TextStyle,

  /** Countdowns, distances, coordinates, counts. */
  data: {
    fontFamily: font.mono,
    fontSize: 12,
    lineHeight: 16,
  } as TextStyle,

  dataMedium: {
    fontFamily: font.monoMedium,
    fontSize: 12,
    lineHeight: 16,
  } as TextStyle,
} as const;
