import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView, Animated, Easing } from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { Accelerometer } from 'expo-sensors';

export default function WelcomeScreen() {
  const router = useRouter();

  // Floating bubble animations
  const bubble1Y = useRef(new Animated.Value(0)).current;
  const bubble2Y = useRef(new Animated.Value(0)).current;
  const bubble3Y = useRef(new Animated.Value(0)).current;
  const bubble1X = useRef(new Animated.Value(0)).current;
  const bubble2X = useRef(new Animated.Value(0)).current;
  const bubble3X = useRef(new Animated.Value(0)).current;
  const tiltX    = useRef(new Animated.Value(0)).current;
  const tiltY    = useRef(new Animated.Value(0)).current;

  // Entrance animations (0 = invisible/offset → 1 = final position)
  const logoAnim  = useRef(new Animated.Value(0)).current;
  const pill1Anim = useRef(new Animated.Value(0)).current;
  const pill2Anim = useRef(new Animated.Value(0)).current;
  const pill3Anim = useRef(new Animated.Value(0)).current;
  const btnsAnim  = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Staggered spring entrances
    const spring = (a: Animated.Value, delay: number) =>
      Animated.sequence([
        Animated.delay(delay),
        Animated.spring(a, { toValue: 1, tension: 52, friction: 9, useNativeDriver: true }),
      ]);
    Animated.parallel([
      spring(logoAnim,  80),
      spring(pill1Anim, 280),
      spring(pill2Anim, 420),
      spring(pill3Anim, 560),
      spring(btnsAnim,  660),
    ]).start();

    // Floating bubble loops
    const floatBubble = (
      animY: Animated.Value, animX: Animated.Value,
      duration: number, rangeY: number, rangeX: number
    ) => {
      Animated.loop(
        Animated.sequence([
          Animated.parallel([
            Animated.timing(animY, { toValue: -rangeY, duration, useNativeDriver: true, easing: Easing.inOut(Easing.sin) }),
            Animated.timing(animX, { toValue:  rangeX, duration: duration * 0.9, useNativeDriver: true, easing: Easing.inOut(Easing.sin) }),
          ]),
          Animated.parallel([
            Animated.timing(animY, { toValue:  rangeY, duration, useNativeDriver: true, easing: Easing.inOut(Easing.sin) }),
            Animated.timing(animX, { toValue: -rangeX, duration: duration * 0.9, useNativeDriver: true, easing: Easing.inOut(Easing.sin) }),
          ]),
          Animated.parallel([
            Animated.timing(animY, { toValue: 0, duration, useNativeDriver: true, easing: Easing.inOut(Easing.sin) }),
            Animated.timing(animX, { toValue: 0, duration: duration * 0.9, useNativeDriver: true, easing: Easing.inOut(Easing.sin) }),
          ]),
        ])
      ).start();
    };

    floatBubble(bubble1Y, bubble1X, 4000, 40, 25);
    floatBubble(bubble2Y, bubble2X, 5500, 55, 30);
    floatBubble(bubble3Y, bubble3X, 3500, 30, 20);

    // Gyroscope parallax
    Accelerometer.setUpdateInterval(40);
    const sub = Accelerometer.addListener(({ x, y }) => {
      Animated.spring(tiltX, { toValue: x,     damping: 18, stiffness: 65, useNativeDriver: true }).start();
      Animated.spring(tiltY, { toValue: y + 1, damping: 18, stiffness: 65, useNativeDriver: true }).start();
    });
    return () => sub.remove();
  }, []);

  // Shared helper: 0→1 value drives both opacity and a slide-up
  const pillStyle = (anim: Animated.Value) => ({
    opacity: anim,
    transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [30, 0] }) }],
  });

  return (
    <View style={styles.root}>
      <StatusBar style="light" />

      {/* Floating circles with gyro parallax */}
      <Animated.View style={[styles.circle1, { transform: [
        { translateY: bubble1Y },
        { translateX: bubble1X },
        { translateX: tiltX.interpolate({ inputRange: [-1, 1], outputRange: [-42, 42] }) },
        { translateY: tiltY.interpolate({ inputRange: [-1, 1], outputRange: [-32, 32] }) },
      ]}]} />
      <Animated.View style={[styles.circle2, { transform: [
        { translateY: bubble2Y },
        { translateX: bubble2X },
        { translateX: tiltX.interpolate({ inputRange: [-1, 1], outputRange: [-20, 20] }) },
        { translateY: tiltY.interpolate({ inputRange: [-1, 1], outputRange: [-15, 15] }) },
      ]}]} />
      <Animated.View style={[styles.circle3, { transform: [
        { translateY: bubble3Y },
        { translateX: bubble3X },
        { translateX: tiltX.interpolate({ inputRange: [-1, 1], outputRange: [-30, 30] }) },
        { translateY: tiltY.interpolate({ inputRange: [-1, 1], outputRange: [-22, 22] }) },
      ]}]} />

      <SafeAreaView style={styles.safeArea}>
        <View style={styles.container}>

          {/* Logo slides down from slightly above */}
          <Animated.View style={[styles.logoSection, {
            opacity: logoAnim,
            transform: [{ translateY: logoAnim.interpolate({ inputRange: [0, 1], outputRange: [-22, 0] }) }],
          }]}>
            <Text style={styles.logo}>go<Text style={styles.logoTeal}>good</Text></Text>
          </Animated.View>

          {/* Feature pills stagger in from below */}
          <View style={styles.pills}>
            <Animated.View style={[styles.pill, pillStyle(pill1Anim)]}>
              <Text style={styles.pillIcon}>📷</Text>
              <Text style={styles.pillText}>Scan your fridge & track what's <Text style={styles.pillBold}>expiring first</Text></Text>
            </Animated.View>
            <Animated.View style={[styles.pill, pillStyle(pill2Anim)]}>
              <Text style={styles.pillIcon}>🤖</Text>
              <Text style={styles.pillText}><Text style={styles.pillBold}>Good Bot</Text> builds recipes before anything goes to waste</Text>
            </Animated.View>
            <Animated.View style={[styles.pill, pillStyle(pill3Anim)]}>
              <Text style={styles.pillIcon}>💰</Text>
              <Text style={styles.pillText}>Watch your money <Text style={styles.pillBold}>go good</Text> instead of in the trash</Text>
            </Animated.View>
          </View>

          {/* Buttons rise up last */}
          <Animated.View style={[styles.buttons, {
            opacity: btnsAnim,
            transform: [{ translateY: btnsAnim.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }],
          }]}>
            <TouchableOpacity
              style={styles.btnPrimary}
              onPress={() => router.navigate('/auth/signup' as any)}
              activeOpacity={0.8}
            >
              <Text style={styles.btnPrimaryText}>create an account →</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.btnSecondary}
              onPress={() => router.navigate('/auth/login' as any)}
              activeOpacity={0.8}
            >
              <Text style={styles.btnSecondaryText}>i already have an account</Text>
            </TouchableOpacity>

            <Text style={styles.hint}>free to join · no spam · cancel anytime</Text>
          </Animated.View>

        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root:             { flex: 1, backgroundColor: '#085041' },
  safeArea:         { flex: 1 },
  container:        { flex: 1, paddingHorizontal: 28, paddingTop: 32, paddingBottom: 32, justifyContent: 'space-between' },
  circle1:          { position: 'absolute', width: 320, height: 320, borderRadius: 160, backgroundColor: 'rgba(255,255,255,0.05)', top: -40, right: -80 },
  circle2:          { position: 'absolute', width: 220, height: 220, borderRadius: 110, backgroundColor: 'rgba(93,202,165,0.08)', bottom: 200, left: -60 },
  circle3:          { position: 'absolute', width: 160, height: 160, borderRadius: 80, backgroundColor: 'rgba(255,255,255,0.04)', top: 220, right: -40 },
  logoSection:      { alignItems: 'center', paddingTop: 16 },
  logo:             { fontSize: 56, fontWeight: '700', color: 'white', letterSpacing: -2, lineHeight: 62, textAlign: 'center', fontFamily: 'Fraunces_600SemiBold' },
  logoTeal:         { color: '#5DCAA5', fontFamily: 'Fraunces_600SemiBold' },
  pills:            { gap: 10 },
  pill:             { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 14, padding: 16, borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.12)' },
  pillIcon:         { fontSize: 22 },
  pillText:         { flex: 1, fontSize: 13, color: 'rgba(255,255,255,0.75)', lineHeight: 20 },
  pillBold:         { color: 'white', fontWeight: '600' },
  buttons:          { gap: 12 },
  btnPrimary:       { backgroundColor: '#1D9E75', padding: 16, borderRadius: 14, alignItems: 'center' },
  btnPrimaryText:   { color: 'white', fontSize: 15, fontWeight: '600' },
  btnSecondary:     { backgroundColor: '#085041', padding: 15, borderRadius: 14, alignItems: 'center', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.3)' },
  btnSecondaryText: { color: 'white', fontSize: 15, fontWeight: '500' },
  hint:             { textAlign: 'center', fontSize: 11, color: 'rgba(255,255,255,0.35)' },
});
