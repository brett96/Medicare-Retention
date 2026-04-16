import React, { useEffect, useMemo, useState } from "react";
import {
  Linking,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { HandoffScreen } from "./src/screens/HandoffScreen";
import { LoginScreen } from "./src/screens/LoginScreen";
import { MedicareHelperScreen } from "./src/screens/MedicareHelperScreen";
import { SetupModelScreen } from "./src/screens/SetupModelScreen";
import { TestPromptScreen } from "./src/screens/TestPromptScreen";

type DevScreen = "setup" | "prompt" | "handoff" | "login";

function looksLikeHandoffUrl(url: string): boolean {
  if (url.includes("/handoff") || url.includes("://oauth/callback") || url.includes("/callback")) {
    return true;
  }
  try {
    const u = new URL(url);
    if (u.searchParams.has("code") && u.searchParams.has("api_base")) {
      return true;
    }
  } catch {
    // ignore invalid URL
  }
  return false;
}

export default function App() {
  const [devOpen, setDevOpen] = useState(false);
  const [devScreen, setDevScreen] = useState<DevScreen>("setup");
  const [handoffUrl, setHandoffUrl] = useState<string | undefined>(undefined);
  const [modelUrl, setModelUrl] = useState<string>(
    "https://example-bucket.s3.amazonaws.com/models/phi-3-mini-q4.gguf"
  );
  const [modelFilename, setModelFilename] = useState<string>("model.gguf");
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState<string>(
    (process.env.EXPO_PUBLIC_OLLAMA_BASE_URL || "").trim() || "http://localhost:11434"
  );
  const [ollamaModel, setOllamaModel] = useState<string>(
    (process.env.EXPO_PUBLIC_OLLAMA_MODEL || "").trim() || "llama3.1"
  );

  useEffect(() => {
    let sub: any | null = null;

    const boot = async () => {
      if (Platform.OS === "web" && typeof window !== "undefined") {
        const href = window.location.href;
        if (looksLikeHandoffUrl(href)) {
          setHandoffUrl(href);
        }
        return;
      }

      try {
        const initial = await Linking.getInitialURL();
        if (initial && looksLikeHandoffUrl(initial)) {
          setHandoffUrl(initial);
        }
      } catch {
        // ignore
      }

      sub = Linking.addEventListener("url", (evt: { url: string }) => {
        if (evt?.url && looksLikeHandoffUrl(evt.url)) {
          setHandoffUrl(evt.url);
        }
      });
    };

    void boot();

    return () => {
      try {
        sub?.remove?.();
      } catch {
        // ignore
      }
    };
  }, []);

  const defaultApiBase = useMemo(
    () => (process.env.EXPO_PUBLIC_API_BASE_URL || "").trim().replace(/\/+$/, ""),
    []
  );

  const devScreenEl = useMemo(() => {
    switch (devScreen) {
      case "setup":
        return <SetupModelScreen modelUrl={modelUrl} modelFilename={modelFilename} />;
      case "prompt":
        return <TestPromptScreen modelFilename={modelFilename} />;
      case "handoff":
        return <HandoffScreen initialUrl={handoffUrl} />;
      case "login":
        return <LoginScreen defaultApiBase={defaultApiBase} />;
    }
  }, [defaultApiBase, devScreen, modelFilename, modelUrl, handoffUrl]);

  const outerBg = { backgroundColor: "#f5faf6" } as const;

  if (Platform.OS === "web" && typeof window !== "undefined" && looksLikeHandoffUrl(window.location.href)) {
    const href = typeof window !== "undefined" ? window.location.href : undefined;
    return (
      <SafeAreaView style={[{ flex: 1, minHeight: 0 }, outerBg]}>
        <HandoffScreen initialUrl={handoffUrl ?? href} />
      </SafeAreaView>
    );
  }

  if (Platform.OS !== "web" && handoffUrl && looksLikeHandoffUrl(handoffUrl)) {
    return (
      <SafeAreaView style={[{ flex: 1, minHeight: 0 }, outerBg]}>
        <HandoffScreen initialUrl={handoffUrl} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[{ flex: 1, minHeight: 0 }, outerBg]}>
      <MedicareHelperScreen
        onOpenDevTools={() => setDevOpen(true)}
        ollamaBaseUrl={ollamaBaseUrl}
        ollamaModel={ollamaModel}
      />

      <Modal visible={devOpen} animationType="slide" onRequestClose={() => setDevOpen(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: "#fff" }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              paddingHorizontal: 16,
              paddingVertical: 12,
              borderBottomWidth: 1,
              borderBottomColor: "#e4e8ed",
            }}
          >
            <Text style={{ fontSize: 17, fontWeight: "700", color: "#1a2332" }}>Developer tools</Text>
            <TouchableOpacity onPress={() => setDevOpen(false)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Text style={{ fontSize: 16, fontWeight: "600", color: "#1d9e75" }}>Done</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
            <Text style={{ fontSize: 15, color: "#555", marginBottom: 12, lineHeight: 22 }}>
              Edge-AI POC: model download, prompts, payer OAuth handoff, and FHIR login.
            </Text>

            <Text style={{ fontSize: 13, fontWeight: "700", color: "#1a2332", marginTop: 6 }}>LLM chat (Ollama)</Text>
            <Text style={{ fontSize: 12, color: "#666", marginTop: 6, lineHeight: 18 }}>
              Point the UI at an Ollama server (local or private network) for chat responses. For web builds, the Ollama
              endpoint must be reachable from the browser and allow cross-origin requests.
            </Text>

            <View style={{ height: 10 }} />

            <Text style={{ fontWeight: "600" }}>Ollama base URL</Text>
            <TextInput
              value={ollamaBaseUrl}
              onChangeText={setOllamaBaseUrl}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="http://localhost:11434"
              style={{
                borderWidth: 1,
                borderColor: "#ccc",
                padding: 10,
                borderRadius: 8,
                marginTop: 6,
              }}
            />

            <View style={{ height: 12 }} />

            <Text style={{ fontWeight: "600" }}>Ollama model</Text>
            <TextInput
              value={ollamaModel}
              onChangeText={setOllamaModel}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="llama3.1"
              style={{
                borderWidth: 1,
                borderColor: "#ccc",
                padding: 10,
                borderRadius: 8,
                marginTop: 6,
              }}
            />

            <View style={{ height: 18 }} />

            <Text style={{ fontWeight: "600" }}>Model S3 URL</Text>
            <TextInput
              value={modelUrl}
              onChangeText={setModelUrl}
              autoCapitalize="none"
              autoCorrect={false}
              style={{
                borderWidth: 1,
                borderColor: "#ccc",
                padding: 10,
                borderRadius: 8,
                marginTop: 6,
              }}
            />

            <View style={{ height: 12 }} />

            <Text style={{ fontWeight: "600" }}>Local filename</Text>
            <TextInput
              value={modelFilename}
              onChangeText={setModelFilename}
              autoCapitalize="none"
              autoCorrect={false}
              style={{
                borderWidth: 1,
                borderColor: "#ccc",
                padding: 10,
                borderRadius: 8,
                marginTop: 6,
              }}
            />

            <View style={{ height: 16 }} />

            <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" as any }}>
              <TouchableOpacity
                onPress={() => setDevScreen("setup")}
                style={{
                  paddingVertical: 10,
                  paddingHorizontal: 14,
                  borderRadius: 10,
                  backgroundColor: devScreen === "setup" ? "#1a2332" : "#eee",
                }}
              >
                <Text style={{ color: devScreen === "setup" ? "#fff" : "#111" }}>Setup model</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => setDevScreen("prompt")}
                style={{
                  paddingVertical: 10,
                  paddingHorizontal: 14,
                  borderRadius: 10,
                  backgroundColor: devScreen === "prompt" ? "#1a2332" : "#eee",
                }}
              >
                <Text style={{ color: devScreen === "prompt" ? "#fff" : "#111" }}>Test prompt</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => setDevScreen("handoff")}
                style={{
                  paddingVertical: 10,
                  paddingHorizontal: 14,
                  borderRadius: 10,
                  backgroundColor: devScreen === "handoff" ? "#1a2332" : "#eee",
                }}
              >
                <Text style={{ color: devScreen === "handoff" ? "#fff" : "#111" }}>Handoff</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => setDevScreen("login")}
                style={{
                  paddingVertical: 10,
                  paddingHorizontal: 14,
                  borderRadius: 10,
                  backgroundColor: devScreen === "login" ? "#1a2332" : "#eee",
                }}
              >
                <Text style={{ color: devScreen === "login" ? "#fff" : "#111" }}>Connect payer</Text>
              </TouchableOpacity>
            </View>

            <View style={{ height: 16 }} />

            {devScreenEl}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}
