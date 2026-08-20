/**
 * Ask Nearby — "Signal" palette.
 *
 * Borrowed from transit boards and road signage rather than from product UI:
 * a near-black ground with a small set of full-chroma signal colours that each
 * mean exactly one thing. Nothing here is decorative — if something is orange
 * it is urgent, if it is green it is money or confirmation.
 *
 *   orange  urgency, live activity, the asking side
 *   green   money, confirmation, the earning side
 *   amber   waiting on someone
 *   red     expiring, disputed, destructive
 *   blue    information, location
 *
 * Signage is legible because it is high contrast and unambiguous, so the
 * ground stays near-black in both schemes and the signals stay at full
 * saturation. The light scheme is a daylight board — near-white ground with
 * the same signals darkened only as far as legibility requires.
 */
const colors = {
  dark: {
    // Ground
    background: '#0B0D10',
    surface: '#14171C',
    card: '#14171C',
    cardForeground: '#F2F5F7',
    sunken: '#1C2027',

    // Type
    foreground: '#F2F5F7',
    text: '#F2F5F7',
    mutedForeground: '#9BA5B0',
    faintForeground: '#6E7883',

    // Structure — signage rules are drawn, not implied
    border: '#2C333C',
    borderStrong: '#454F5B',
    input: '#1C2027',

    // Signals
    primary: '#00C46A', // sign green
    primaryForeground: '#04150C',
    primarySoft: '#0A2A1B',

    accent: '#FF6B00', // safety orange
    accentForeground: '#1A0900',
    accentSoft: '#331603',

    money: '#00C46A',
    pending: '#FFB000',
    pendingSoft: '#332400',
    danger: '#FF3B30',
    dangerSoft: '#330F0D',
    info: '#2E9BFF',
    infoSoft: '#0A2138',

    // Category codes
    catFuel: '#FFB000',
    catFood: '#00C46A',
    catTraffic: '#2E9BFF',
    catShopping: '#C77DFF',
    catSafety: '#FF3B30',

    overlay: 'rgba(0, 0, 0, 0.72)',
    /** Page behind the phone frame on wide web viewports. */
    backdrop: '#000000',
  },

  light: {
    // Ground — a daylight board
    background: '#F4F6F8',
    surface: '#FFFFFF',
    card: '#FFFFFF',
    cardForeground: '#0B0D10',
    sunken: '#E4E8EC',

    // Type
    foreground: '#0B0D10',
    text: '#0B0D10',
    mutedForeground: '#525C67',
    faintForeground: '#6E7883',

    // Structure
    border: '#C6CDD4',
    borderStrong: '#0B0D10',
    input: '#FFFFFF',

    // Signals — darkened only as far as legibility on white requires
    primary: '#00753F',
    primaryForeground: '#FFFFFF',
    primarySoft: '#CDEFDD',

    accent: '#B34400',
    accentForeground: '#FFFFFF',
    accentSoft: '#FFE2CC',

    money: '#00753F',
    pending: '#8A5A00',
    pendingSoft: '#FFEDC7',
    danger: '#C81E14',
    dangerSoft: '#FFDCD9',
    info: '#0B63C4',
    infoSoft: '#D6E7FA',

    // Category codes
    catFuel: '#8A5A00',
    catFood: '#00753F',
    catTraffic: '#0B63C4',
    catShopping: '#7A2FBF',
    catSafety: '#C81E14',

    overlay: 'rgba(11, 13, 16, 0.58)',
    /** Page behind the phone frame on wide web viewports. */
    backdrop: '#C6CDD4',
  },

  /**
   * Signage geometry: things are boxes. The 2px radius exists only to stop
   * corners looking accidentally ragged at render time — nothing is a pill.
   */
  radius: {
    hard: 0,
    box: 2,
    module: 4,
  },

  /** Borders are structural here, so they get their own scale. */
  stroke: {
    hair: 1,
    rule: 2,
    heavy: 3,
  },

  /** 4pt base spacing scale. */
  space: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 20,
    xxl: 28,
    xxxl: 40,
  },
};

export default colors;
