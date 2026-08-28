import React, { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { text } from '@/constants/type';

/**
 * Pulls a destination address out of whatever a wallet put in its QR code.
 *
 * Three shapes turn up in practice: a bare address, an EIP-681 URI naming the
 * account, and an EIP-681 transfer request. The last one is the reason this is
 * a parser rather than a regex — in a transfer request the address in the path
 * is the *token contract* and the recipient lives in the `address` parameter:
 *
 *   ethereum:0xTOKEN@8453/transfer?address=0xRECIPIENT&uint256=1000000
 *
 * Taking the first hex string in that URI would send the money to the USDC
 * contract, which is a burn. Chain ids are deliberately ignored: an EVM
 * address is the same account on every chain, so a QR generated for mainnet
 * still names the right account on Base. The sheet's existing warning covers
 * the risk of the *recipient* not being able to reach Base.
 */
export function parseWalletQr(raw: string): string | null {
  const value = raw.trim();
  const ADDRESS = /0x[a-fA-F0-9]{40}/;

  const transfer = /^ethereum:[^?]*\/transfer\?(.*)$/i.exec(value);
  if (transfer) {
    const recipient = /(?:^|&)address=(0x[a-fA-F0-9]{40})/i.exec(transfer[1]);
    return recipient ? recipient[1] : null;
  }

  const found = ADDRESS.exec(value);
  return found ? found[0] : null;
}

type Props = {
  visible: boolean;
  onClose: () => void;
  onScan: (address: string) => void;
};

export function AddressScanner({ visible, onClose, onScan }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [unreadable, setUnreadable] = useState(false);

  /**
   * The camera reports the same code many times a second for as long as it is
   * in frame. Without this the sheet closes on the first read and then keeps
   * calling back into a parent that has already moved on.
   */
  const taken = useRef(false);
  useEffect(() => {
    if (visible) {
      taken.current = false;
      setUnreadable(false);
    }
  }, [visible]);

  function handleScan(value: string) {
    if (taken.current) return;

    const address = parseWalletQr(value);
    if (!address) {
      // Not fatal: keep the camera live so they can try another code rather
      // than closing on them and making them start again.
      setUnreadable(true);
      return;
    }

    taken.current = true;
    onScan(address);
    onClose();
  }

  const granted = permission?.granted ?? false;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.screen, { backgroundColor: colors.background }]}>
        {/* Only mounted while the sheet is open, so the camera is released
            the moment it closes rather than idling behind the withdrawal. */}
        {visible && granted ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={({ data }) => handleScan(data)}
          />
        ) : null}

        <View style={[styles.bar, { paddingTop: insets.top + 12 }]}>
          <Pressable onPress={onClose} hitSlop={12} style={styles.close}>
            <Ionicons name="close" size={22} color="#FFFFFF" />
          </Pressable>
          <Text style={[text.subheading, styles.barLabel]}>Scan wallet address</Text>
        </View>

        {granted ? (
          <>
            <View style={styles.reticleWrap} pointerEvents="none">
              <View style={[styles.reticle, { borderColor: colors.accent }]} />
            </View>

            <View style={[styles.hint, { paddingBottom: insets.bottom + 26 }]}>
              <Text style={[text.bodySmall, styles.hintText]}>
                {unreadable
                  ? 'That code is not a wallet address. Try another.'
                  : 'Point the camera at the QR code from the receiving wallet.'}
              </Text>
            </View>
          </>
        ) : (
          <View style={styles.ask}>
            <Ionicons name="camera-outline" size={30} color={colors.mutedForeground} />
            <Text style={[text.body, { color: colors.foreground, textAlign: 'center' }]}>
              {permission && !permission.canAskAgain
                ? 'Camera access is off for Confam. Turn it on in Settings to scan a code.'
                : 'Confam needs the camera to read a wallet QR code.'}
            </Text>
            {permission?.canAskAgain !== false && (
              <Pressable
                onPress={requestPermission}
                style={[styles.allow, { backgroundColor: colors.accent }]}
              >
                <Text style={[text.action, { color: colors.background }]}>Allow camera</Text>
              </Pressable>
            )}
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 18,
    paddingBottom: 12,
  },
  close: { padding: 2 },
  barLabel: { color: '#FFFFFF' },
  reticleWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  reticle: { width: 232, height: 232, borderWidth: 2, borderRadius: 4 },
  hint: { paddingHorizontal: 30 },
  hintText: { color: '#FFFFFF', textAlign: 'center' },
  ask: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    paddingHorizontal: 34,
  },
  allow: { paddingHorizontal: 20, paddingVertical: 12, borderRadius: 2 },
});
