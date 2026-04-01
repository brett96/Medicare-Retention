import React, { useCallback, useMemo, useState } from "react";
import { Linking, Platform, Text, TextInput, TouchableOpacity, View } from "react-native";

export type PayerId = "elevance" | "cigna" | "aetna";

type Props = {
  /** Default API origin (no trailing slash), e.g. from EXPO_PUBLIC_API_BASE_URL */
  defaultApiBase: string;
};

export function LoginScreen(props: Props) {
  const { defaultApiBase } = props;
  const [payer, setPayer] = useState<PayerId>("elevance");
  const [apiBase, setApiBase] = useState<string>(defaultApiBase);
  const [status, setStatus] = useState<string>("");

  const authorizeUrl = useMemo(() => {
    const base = (apiBase || "").trim().replace(/\/+$/, "");
    if (!base) return "";
    return `${base}/api/auth/${payer}/authorize/`;
  }, [apiBase, payer]);

  const openSignIn = useCallback(async () => {
    setStatus("");
    if (!authorizeUrl) {
      setStatus("Set API base URL (e.g. from EXPO_PUBLIC_API_BASE_URL).");
      return;
    }
    try {
      await Linking.openURL(authorizeUrl);
      setStatus("Opened browser / Custom Tabs. Complete sign-in; you will return with a handoff code.");
    } catch (e: any) {
      setStatus(e?.message ?? String(e));
    }
  }, [authorizeUrl]);

  return (
    <View
      style={{
        padding: 14,
        borderWidth: 1,
        borderColor: "#ddd",
        borderRadius: 12,
        backgroundColor: "#fff",
      }}
    >
      <Text style={{ fontSize: 16, fontWeight: "600" }}>Connect your payer</Text>
      <Text style={{ fontSize: 13, color: "#555", marginTop: 8, lineHeight: 20 }}>
        Choose your payer, then open the OAuth page. After approval, use the handoff screen with{" "}
        <Text style={{ fontFamily: "Courier" }}>{`?code=…&api_base=…`}</Text> or the app deep link.
      </Text>

      <View style={{ height: 14 }} />

      <Text style={{ fontWeight: "600" }}>Payer</Text>
      <View style={{ flexDirection: "row", gap: 10, marginTop: 8, flexWrap: "wrap" as any }}>
        {(["elevance", "cigna", "aetna"] as const).map((id) => (
          <TouchableOpacity
            key={id}
            onPress={() => setPayer(id)}
            style={{
              paddingVertical: 10,
              paddingHorizontal: 14,
              borderRadius: 10,
              backgroundColor: payer === id ? "#111" : "#eee",
            }}
          >
            <Text style={{ color: payer === id ? "#fff" : "#111", fontWeight: "600" }}>
              {id === "elevance" ? "Elevance" : id === "cigna" ? "Cigna" : "Aetna"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={{ height: 14 }} />

      <Text style={{ fontWeight: "600" }}>API base URL</Text>
      <TextInput
        value={apiBase}
        onChangeText={setApiBase}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="https://your-api.vercel.app"
        style={{
          borderWidth: 1,
          borderColor: "#ccc",
          padding: 10,
          borderRadius: 8,
          marginTop: 6,
          fontFamily: Platform.OS === "web" ? ("monospace" as const) : "Courier",
        }}
      />

      <View style={{ height: 14 }} />

      <TouchableOpacity
        onPress={openSignIn}
        style={{
          paddingVertical: 12,
          borderRadius: 10,
          backgroundColor: "#111",
          alignItems: "center",
        }}
      >
        <Text style={{ color: "#fff", fontWeight: "600" }}>Open sign-in</Text>
      </TouchableOpacity>

      {authorizeUrl ? (
        <Text
          style={{
            marginTop: 12,
            fontSize: 11,
            color: "#666",
            fontFamily: Platform.OS === "web" ? ("monospace" as const) : "Courier",
          }}
        >
          {authorizeUrl}
        </Text>
      ) : null}

      {status ? (
        <Text style={{ marginTop: 10, fontSize: 13, color: "#333" }}>{status}</Text>
      ) : null}
    </View>
  );
}
