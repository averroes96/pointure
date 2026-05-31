import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { C } from "@/constants";
import api from "@/lib/api";
import { storeTokens } from "@/lib/auth";
import { registerDeviceToken } from "@/lib/notifications";

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);

  async function handleLogin() {
    if (!email.trim() || !password) {
      Alert.alert("Champs requis", "Veuillez saisir votre email et mot de passe.");
      return;
    }
    setLoading(true);
    try {
      const { data } = await api.post("/auth/login/", { email, password });
      await storeTokens(data.access, data.refresh);
      await registerDeviceToken();
      router.replace("/(app)");
    } catch (err: any) {
      Alert.alert(
        "Connexion impossible",
        err?.response?.data?.detail ?? "Identifiants incorrects."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        {/* Brand */}
        <View style={styles.brand}>
          <View style={styles.logoBox}>
            <Text style={styles.logoEmoji}>👟</Text>
          </View>
          <Text style={styles.appName}>ShoeDZ</Text>
          <Text style={styles.appSub}>Gestion de stock & ventes</Text>
        </View>

        {/* Card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Connexion</Text>
          <Text style={styles.cardSub}>Accédez à votre espace de gestion</Text>

          {/* Email */}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Adresse email</Text>
            <View style={[styles.inputWrap, emailFocused && styles.inputWrapFocused]}>
              <Ionicons name="mail-outline" size={18} color={emailFocused ? C.primary : C.textMuted} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                placeholder="vous@entreprise.dz"
                placeholderTextColor={C.textMuted}
                onFocus={() => setEmailFocused(true)}
                onBlur={() => setEmailFocused(false)}
                editable={!loading}
              />
            </View>
          </View>

          {/* Password */}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Mot de passe</Text>
            <View style={[styles.inputWrap, passwordFocused && styles.inputWrapFocused]}>
              <Ionicons name="lock-closed-outline" size={18} color={passwordFocused ? C.primary : C.textMuted} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { flex: 1 }]}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                placeholder="••••••••"
                placeholderTextColor={C.textMuted}
                onFocus={() => setPasswordFocused(true)}
                onBlur={() => setPasswordFocused(false)}
                editable={!loading}
                onSubmitEditing={handleLogin}
                returnKeyType="go"
              />
              <Pressable onPress={() => setShowPassword((v) => !v)} style={styles.eyeBtn}>
                <Ionicons
                  name={showPassword ? "eye-off-outline" : "eye-outline"}
                  size={18}
                  color={C.textMuted}
                />
              </Pressable>
            </View>
          </View>

          {/* Submit */}
          <Pressable
            style={[styles.btn, loading && styles.btnLoading]}
            onPress={handleLogin}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color={C.white} />
            ) : (
              <>
                <Text style={styles.btnText}>Se connecter</Text>
                <Ionicons name="arrow-forward" size={18} color={C.white} />
              </>
            )}
          </Pressable>
        </View>

        <Text style={styles.footer}>ShoeDZ · Gestion chaussures Algérie</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.surface },
  scroll: {
    flexGrow: 1,
    justifyContent: "center",
    padding: C.space.xxl,
  },
  brand: { alignItems: "center", marginBottom: C.space.xxxl },
  logoBox: {
    width: 72,
    height: 72,
    borderRadius: C.radius.xl,
    backgroundColor: C.primaryBg,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: C.space.md,
    borderWidth: 1,
    borderColor: C.primaryBorder,
  },
  logoEmoji: { fontSize: 36 },
  appName: { fontSize: 28, fontWeight: "800", color: C.text, letterSpacing: -0.5 },
  appSub: { fontSize: 14, color: C.textMuted, marginTop: 4, fontWeight: "500" },
  card: {
    backgroundColor: C.white,
    borderRadius: C.radius.xl,
    padding: C.space.xxl,
    ...C.shadow.md,
  },
  cardTitle: { fontSize: 22, fontWeight: "800", color: C.text, marginBottom: 4, letterSpacing: -0.3 },
  cardSub: { fontSize: 14, color: C.textMuted, marginBottom: C.space.xxl, fontWeight: "500" },
  fieldGroup: { marginBottom: C.space.lg },
  label: { fontSize: 12, fontWeight: "700", color: C.textSecondary, marginBottom: C.space.sm, letterSpacing: 0.3 },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: C.border,
    borderRadius: C.radius.md,
    backgroundColor: C.surface,
    paddingHorizontal: C.space.md,
  },
  inputWrapFocused: {
    borderColor: C.primary,
    backgroundColor: C.primaryBg,
  },
  inputIcon: { marginRight: C.space.sm },
  input: {
    flex: 1,
    paddingVertical: 13,
    fontSize: 15,
    color: C.text,
  },
  eyeBtn: { padding: C.space.xs },
  btn: {
    backgroundColor: C.primary,
    borderRadius: C.radius.md,
    paddingVertical: 15,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: C.space.sm,
    marginTop: C.space.sm,
    ...C.shadow.sm,
  },
  btnLoading: { opacity: 0.7 },
  btnText: { color: C.white, fontWeight: "700", fontSize: 16 },
  footer: {
    textAlign: "center",
    fontSize: 12,
    color: C.textMuted,
    marginTop: C.space.xxl,
  },
});
