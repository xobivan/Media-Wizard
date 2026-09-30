import { useEffect, useRef, useState } from 'react';
import { Alert, Animated, Modal, PanResponder, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { CompressionQuality } from '../../services/smartCompression';
import { styles } from '../styles/mediaWizardStyles';

const SHEET_CLOSED_Y    = 700;
const OPEN_DURATION     = 300;
const CLOSE_DURATION    = 250;
const DISMISS_THRESHOLD = 120; // px down to commit dismiss on release
const DISMISS_VELOCITY  = 0.8; // or fast flick
const SCRIM_MAX_OPACITY = 0.45;
const DRAG_FADE_RANGE   = 350; // px of drag over which scrim goes from full to 0

export type CompressionBottomSheetProps = {
  visible: boolean;
  selectedCount: number;
  selectedSavings: number;
  keepOriginals: boolean;
  compressionQuality: CompressionQuality;
  compressionState: 'idle' | 'compressing' | 'complete' | 'error';
  compressionProgress: number;
  compressionCurrent: number;
  compressionError: string | null;
  onKeepOriginalsChange: (keep: boolean) => void;
  onCompressionQualityChange: (quality: CompressionQuality) => void;
  onStartCompression: () => void;
  onRequestCancel: () => void;
  onCancelConfirmed: () => void;
  onDismiss: () => void;
};

export function CompressionBottomSheet({
  visible,
  selectedCount,
  selectedSavings,
  keepOriginals,
  compressionQuality,
  compressionState,
  compressionProgress,
  compressionCurrent,
  compressionError,
  onKeepOriginalsChange,
  onCompressionQualityChange,
  onStartCompression,
  onRequestCancel,
  onCancelConfirmed,
  onDismiss,
}: CompressionBottomSheetProps) {
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [modalMounted, setModalMounted] = useState(false);

  const sheetY       = useRef(new Animated.Value(SHEET_CLOSED_Y)).current;
  const scrimOpacity = useRef(new Animated.Value(0)).current;
  const insets       = useSafeAreaInsets();

  const isCompressingRef = useRef(false);
  isCompressingRef.current = compressionState === 'compressing';

  const animateOpen = () => {
    Animated.parallel([
      Animated.timing(sheetY,       { toValue: 0,               duration: OPEN_DURATION,  useNativeDriver: true }),
      Animated.timing(scrimOpacity, { toValue: SCRIM_MAX_OPACITY, duration: OPEN_DURATION,  useNativeDriver: true }),
    ]).start();
  };

  const animateClose = (onDone?: () => void) => {
    Animated.parallel([
      Animated.timing(sheetY,       { toValue: SHEET_CLOSED_Y, duration: CLOSE_DURATION, useNativeDriver: true }),
      Animated.timing(scrimOpacity, { toValue: 0,              duration: CLOSE_DURATION, useNativeDriver: true }),
    ]).start(({ finished }) => {
      if (finished) {
        setModalMounted(false);
        onDone?.();
      }
    });
  };

  useEffect(() => {
    if (visible) {
      sheetY.setValue(SHEET_CLOSED_Y);
      scrimOpacity.setValue(0);
      setModalMounted(true);
      animateOpen();
    } else {
      animateClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !isCompressingRef.current,
      onMoveShouldSetPanResponder: (_, { dy }) => !isCompressingRef.current && dy > 2,
      onPanResponderMove: (_, { dy }) => {
        // Follow finger downward only; resist upward pull.
        const clamped = Math.max(0, dy);
        sheetY.setValue(clamped);
        // Fade scrim proportionally as the sheet is dragged away.
        scrimOpacity.setValue(SCRIM_MAX_OPACITY * Math.max(0, 1 - clamped / DRAG_FADE_RANGE));
      },
      onPanResponderRelease: (_, { dy, vy }) => {
        if (dy > DISMISS_THRESHOLD || vy > DISMISS_VELOCITY) {
          animateClose(onDismiss);
        } else {
          // Not far enough — snap everything back.
          Animated.parallel([
            Animated.spring(sheetY,       { toValue: 0,                useNativeDriver: true }),
            Animated.spring(scrimOpacity, { toValue: SCRIM_MAX_OPACITY, useNativeDriver: true }),
          ]).start();
        }
      },
    })
  ).current;

  const handleCancelPress = () => {
    if (compressionState === 'compressing') {
      Alert.alert(
        'Cancel compression?',
        'Compression will stop and any newly compressed videos created this session will be deleted. Your original videos will be kept.',
        [
          { text: 'Keep going', style: 'cancel' },
          {
            text: 'Cancel compression',
            style: 'destructive',
            onPress: () => {
              setConfirmingCancel(true);
              onRequestCancel();
              setTimeout(() => {
                setConfirmingCancel(false);
                onCancelConfirmed();
              }, 800);
            },
          },
        ],
      );
    } else {
      onDismiss();
    }
  };

  const isCompressing = compressionState === 'compressing';
  const isComplete    = compressionState === 'complete';

  return (
    <Modal
      visible={modalMounted}
      animationType="none"
      transparent
      onRequestClose={handleCancelPress}
    >
      {/* Scrim */}
      <Animated.View
        style={[styles.sheetScrim, { opacity: scrimOpacity }]}
        pointerEvents={isCompressing ? 'none' : 'auto'}
      >
        <Pressable style={{ flex: 1 }} onPress={isCompressing ? undefined : handleCancelPress} />
      </Animated.View>

      {/* Sheet */}
      <Animated.View
        style={[
          styles.sheetContainer,
          { paddingBottom: insets.bottom, transform: [{ translateY: sheetY }] },
        ]}
      >
        {/*
          Drag zone: handle pill + header title/subtitle.
          Sits above the ScrollView so it never conflicts with scroll.
          Touch anywhere here to grab and drag the sheet down.
        */}
        <View style={styles.sheetDragZone} {...panResponder.panHandlers}>
          <View style={styles.sheetHandleArea}>
            <View style={styles.sheetHandle} />
          </View>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>
              {isComplete
                ? 'Compression complete'
                : `Compress ${selectedCount} ${selectedCount === 1 ? 'video' : 'videos'}`}
            </Text>
            {!isComplete && (
              <Text style={styles.sheetSubtitle}>
                Save ~{Math.round(selectedSavings)} MB
              </Text>
            )}
          </View>
        </View>

        <ScrollView
          contentContainerStyle={styles.sheetContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {isComplete ? (
            <View style={styles.sheetSuccessBlock}>
              <View style={styles.sheetSuccessIcon}>
                <Text style={styles.sheetSuccessIconText}>✓</Text>
              </View>
              <Text style={styles.sheetSuccessTitle}>Compressed successfully!</Text>
              <Text style={styles.sheetSuccessDetail}>
                Saved ~{Math.round(selectedSavings)} MB · Your compressed videos have been added to the library.
              </Text>
              <Pressable style={styles.primaryButton} onPress={onDismiss}>
                <Text style={styles.primaryButtonText}>Continue reviewing</Text>
              </Pressable>
            </View>
          ) : (
            <>
              {isCompressing && (
                <View style={styles.sheetProgressBlock}>
                  <View style={styles.progressTrack}>
                    <View style={[styles.progressFill, { width: `${compressionProgress}%` }]} />
                  </View>
                  <Text style={styles.sheetProgressLabel}>
                    Compressing {compressionCurrent} of {selectedCount} · {compressionProgress}%
                  </Text>
                </View>
              )}

              {compressionError ? (
                <Text style={styles.errorText}>{compressionError}</Text>
              ) : null}

              {!isCompressing && (
                <>
                  <View style={styles.optionBlock}>
                    <Text style={styles.optionTitle}>Compression quality</Text>
                    {(['balanced', 'high', 'maximum_savings'] as CompressionQuality[]).map((quality) => (
                      <Pressable
                        key={quality}
                        style={styles.optionRow}
                        onPress={() => onCompressionQualityChange(quality)}
                      >
                        <View style={styles.sheetOptionLeft}>
                          <Text style={styles.optionText}>
                            {quality === 'balanced' ? 'Balanced' : quality === 'high' ? 'High quality' : 'Maximum savings'}
                          </Text>
                          <Text style={styles.sheetOptionDetail}>
                            {quality === 'balanced'
                              ? 'Good size reduction, great quality'
                              : quality === 'high'
                                ? 'Minimal quality loss, moderate savings'
                                : 'Smallest file size, some quality loss'}
                          </Text>
                        </View>
                        <Text style={styles.radio}>{compressionQuality === quality ? '●' : '○'}</Text>
                      </Pressable>
                    ))}
                  </View>

                  <View style={styles.optionBlock}>
                    <Text style={styles.optionTitle}>After compression</Text>
                    <Pressable style={styles.optionRow} onPress={() => onKeepOriginalsChange(true)}>
                      <Text style={styles.optionText}>Keep original files</Text>
                      <Text style={styles.radio}>{keepOriginals ? '●' : '○'}</Text>
                    </Pressable>
                    <Pressable style={styles.optionRow} onPress={() => onKeepOriginalsChange(false)}>
                      <Text style={styles.optionText}>Delete originals after verifying</Text>
                      <Text style={styles.radio}>{!keepOriginals ? '●' : '○'}</Text>
                    </Pressable>
                  </View>
                </>
              )}

              <Pressable
                style={[
                  isCompressing ? styles.secondaryButton : styles.primaryButton,
                  confirmingCancel && styles.primaryButtonDisabled,
                ]}
                disabled={confirmingCancel}
                onPress={isCompressing ? handleCancelPress : () => void onStartCompression()}
              >
                <Text style={isCompressing ? styles.secondaryButtonText : styles.primaryButtonText}>
                  {isCompressing ? 'Cancel compression' : compressionState === 'error' ? 'Retry compression' : 'Start compression'}
                </Text>
              </Pressable>
            </>
          )}
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}
