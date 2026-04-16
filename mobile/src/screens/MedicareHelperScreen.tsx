import { Feather } from "@expo/vector-icons";
import React, { useCallback, useState } from "react";
import {
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";

import { planGpt as c } from "../theme/planGpt";
import { ollamaChat, type OllamaChatMessage } from "../utils/ollama";

/** Viewports this wide (or wider) use the desktop / tablet-landscape shell. */
export const MEDICARE_LAYOUT_WIDE_MIN_WIDTH = 900;

function narrowWebPhoneShell(wide: boolean) {
  if (Platform.OS !== "web" || wide) return undefined;
  return {
    maxWidth: 430,
    width: "100%" as const,
    alignSelf: "center" as const,
    minHeight: 0,
    boxShadow: "0 12px 40px rgba(0,0,0,0.14)",
  } as const;
}

export type MedicareTabId = "chat" | "rx" | "videos" | "analytics" | "plan" | "agent";

type Props = {
  onOpenDevTools?: () => void;
  /** Example: http://localhost:11434 or https://ollama.internal.example */
  ollamaBaseUrl?: string;
  /** Example: llama3.1 */
  ollamaModel?: string;
};

const TABS: { id: MedicareTabId; label: string; icon: React.ComponentProps<typeof Feather>["name"] }[] = [
  { id: "chat", label: "Chat", icon: "message-circle" },
  { id: "rx", label: "Save Rx", icon: "heart" },
  { id: "videos", label: "Videos", icon: "video" },
  { id: "analytics", label: "Analytics", icon: "bar-chart-2" },
  { id: "plan", label: "Best Plan", icon: "activity" },
  { id: "agent", label: "My Agent", icon: "user" },
];

const serif = Platform.select({ ios: "Georgia", android: "serif", web: "Georgia, serif", default: "serif" });

const webChatInputReset =
  Platform.OS === "web" ? ({ outlineStyle: "none" as const, borderWidth: 0 } as const) : null;

type LocalChatMessage = { role: "user" | "assistant"; content: string };

const DEFAULT_SYSTEM_PROMPT =
  "You are Plan-GPT, a Medicare Advantage plan assistant. Be concise and helpful. " +
  "If the user asks about costs/coverage, answer generally and suggest contacting their agent for plan-specific confirmation.";

export function MedicareHelperScreen({ onOpenDevTools, ollamaBaseUrl, ollamaModel }: Props) {
  const { width } = useWindowDimensions();
  const wide = width >= MEDICARE_LAYOUT_WIDE_MIN_WIDTH;

  const [tab, setTab] = useState<MedicareTabId>("chat");
  const [chatDraft, setChatDraft] = useState("");
  const [chatHistory, setChatHistory] = useState<LocalChatMessage[]>([]);
  const [chatPending, setChatPending] = useState(false);

  const sendChat = useCallback(async () => {
    const t = chatDraft.trim();
    if (!t) return;
    if (chatPending) return;

    const baseUrl = (ollamaBaseUrl || process.env.EXPO_PUBLIC_OLLAMA_BASE_URL || "").trim();
    const model = (ollamaModel || process.env.EXPO_PUBLIC_OLLAMA_MODEL || "llama3.1").trim();

    setChatHistory((prev) => [...prev, { role: "user", content: t }]);
    setChatDraft("");
    setChatPending(true);

    try {
      const msgs: OllamaChatMessage[] = [
        { role: "system", content: DEFAULT_SYSTEM_PROMPT },
        ...chatHistory.map((m) => ({ role: m.role, content: m.content }) as OllamaChatMessage),
        { role: "user", content: t },
      ];

      const out = await ollamaChat({ baseUrl, model, messages: msgs, timeoutMs: 60_000 });
      setChatHistory((prev) => [...prev, { role: "assistant", content: out.content.trim() }]);
    } catch (e: any) {
      const msg = (e?.message ?? String(e)).trim();
      setChatHistory((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            `I couldn’t reach the configured Ollama server.\n\n` +
            `- Base URL: ${baseUrl || "(not set)"}\n` +
            `- Model: ${model || "(not set)"}\n\n` +
            `Error: ${msg}`,
        },
      ]);
    } finally {
      setChatPending(false);
    }
  }, [chatDraft, chatHistory, chatPending, ollamaBaseUrl, ollamaModel]);

  const panels = (
    <>
      {tab === "chat" && <ChatPanel history={chatHistory} pending={chatPending} layoutWide={wide} />}
      {tab === "rx" && <RxPanel />}
      {tab === "videos" && <VideosPanel />}
      {tab === "analytics" && <AnalyticsPanel />}
      {tab === "plan" && <BestPlanPanel />}
      {tab === "agent" && <AgentPanel />}
    </>
  );

  const chatComposer =
    tab === "chat" ? (
      <View style={[styles.inputBar, wide && styles.inputBarWide]}>
        <View style={[styles.inputInner, wide && styles.inputInnerWide]}>
          <Feather name="mic" size={wide ? 20 : 18} color="#5dcaa5" />
          <TextInput
            style={[styles.chatInput, webChatInputReset, wide && styles.chatInputWide]}
            placeholder="Ask about your Medicare plan…"
            placeholderTextColor="#7dcfb4"
            value={chatDraft}
            onChangeText={setChatDraft}
            onSubmitEditing={sendChat}
            returnKeyType="send"
            blurOnSubmit={false}
            accessibilityLabel="Medicare plan question"
          />
          <Pressable
            onPress={sendChat}
            style={({ pressed }) => [
              styles.sendBtn,
              wide && styles.sendBtnWide,
              pressed && Platform.OS === "web" && { opacity: 0.85 },
            ]}
            accessibilityLabel="Send message"
          >
            <Feather name="send" size={wide ? 16 : 14} color={c.white} />
          </Pressable>
        </View>
        {!wide && (
          <View style={styles.homeRow}>
            <View style={[styles.homeDot, { backgroundColor: c.primary }]} />
            <View style={styles.homeBar} />
            <View style={[styles.homeDot, { backgroundColor: c.borderLight }]} />
          </View>
        )}
      </View>
    ) : null;

  if (wide) {
    return (
      <View style={styles.rootWide}>
        <View style={styles.sideNav}>
          <View style={styles.sideNavBrand}>
            <View style={styles.sideLogoMark}>
              <Feather name="shield" size={22} color={c.white} />
            </View>
            <Text style={[styles.sideAppTitle, { fontFamily: serif }]}>Medicare Helper</Text>
            <Text style={styles.sideAppSub}>Powered by Plan-GPT</Text>
          </View>
          <ScrollView style={styles.sideNavScroll} showsVerticalScrollIndicator={false}>
            {TABS.map((t) => {
              const on = t.id === tab;
              return (
                <Pressable
                  key={t.id}
                  onPress={() => setTab(t.id)}
                  style={[styles.sideNavItem, on && styles.sideNavItemOn]}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: on }}
                >
                  <Feather name={t.icon} size={18} color={on ? c.primary : "rgba(255,255,255,0.45)"} />
                  <Text style={[styles.sideNavLbl, on && styles.sideNavLblOn]}>{t.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <Pressable
            onPress={onOpenDevTools}
            style={styles.sideNavFooter}
            accessibilityLabel="Developer tools"
            accessibilityRole="button"
          >
            <Feather name="tool" size={17} color="rgba(255,255,255,0.4)" />
            <Text style={styles.sideNavFooterTxt}>Dev tools</Text>
          </Pressable>
        </View>

        <View style={styles.mainWide}>
          <View style={styles.wideTopGreen}>
            <View style={styles.wideTopRow}>
              <View style={styles.widePlanBlock}>
                <View style={styles.widePlanTitleRow}>
                  <Text style={styles.widePlanName}>Humana Gold Plus HMO</Text>
                  <View style={styles.activePillWide}>
                    <View style={styles.activeDot} />
                    <Text style={styles.activeText}>Active</Text>
                  </View>
                </View>
                <View style={styles.wideDedRow}>
                  <Text style={styles.dedLbl}>Rx Ded.</Text>
                  <View style={styles.wideDedTrack}>
                    <View style={[styles.dedFill, { width: "38.5%" }]} />
                  </View>
                  <Text style={styles.dedVal}>
                    <Text style={styles.dedStrong}>$250</Text> used · <Text style={styles.dedStrong}>$400</Text> left
                  </Text>
                </View>
              </View>
              <View style={styles.wideHeaderIcons}>
                <Pressable onPress={onOpenDevTools} hitSlop={8} accessibilityLabel="Search">
                  <Feather name="search" size={20} color="rgba(255,255,255,0.9)" />
                </Pressable>
                <Feather name="user" size={20} color="rgba(255,255,255,0.9)" />
              </View>
            </View>
          </View>

          <View style={styles.wideBodySplit}>
            <View style={styles.wideCenterCol}>
              <View style={styles.panelWrapWide}>{panels}</View>
              {chatComposer}
            </View>
            <ScrollView
              style={styles.wideRail}
              contentContainerStyle={styles.wideRailContent}
              showsVerticalScrollIndicator={false}
            >
              <DesktopRail currentTab={tab} onOpenAgent={() => setTab("agent")} onOpenRx={() => setTab("rx")} />
            </ScrollView>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.root, narrowWebPhoneShell(wide)]}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View style={styles.headerLeft}>
            <View style={styles.logoMark}>
              <Feather name="shield" size={18} color={c.white} />
            </View>
            <View>
              <Text style={[styles.appTitle, { fontFamily: serif }]}>Medicare Helper</Text>
              <Text style={styles.appSub}>Powered by Plan-GPT</Text>
            </View>
          </View>
          <View style={styles.headerIcons}>
            <Pressable onPress={onOpenDevTools} hitSlop={8} accessibilityLabel="Developer tools">
              <Feather name="search" size={18} color="rgba(255,255,255,0.85)" />
            </Pressable>
            <Feather name="user" size={18} color="rgba(255,255,255,0.85)" />
          </View>
        </View>
        <View style={styles.planCard}>
          <View style={styles.planRow}>
            <Text style={styles.planName}>Humana Gold Plus HMO</Text>
            <View style={styles.activePill}>
              <View style={styles.activeDot} />
              <Text style={styles.activeText}>Active</Text>
            </View>
          </View>
          <View style={styles.dedRow}>
            <Text style={styles.dedLbl}>Rx Ded.</Text>
            <View style={styles.dedTrack}>
              <View style={[styles.dedFill, { width: "38.5%" }]} />
            </View>
            <Text style={styles.dedVal}>
              <Text style={styles.dedStrong}>$250</Text> used · <Text style={styles.dedStrong}>$400</Text> left
            </Text>
          </View>
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabScroll}
        contentContainerStyle={styles.tabRow}
      >
        {TABS.map((t) => {
          const on = t.id === tab;
          return (
            <Pressable key={t.id} onPress={() => setTab(t.id)} style={[styles.tab, on && styles.tabOn]}>
              <Feather name={t.icon} size={14} color={on ? c.primary : c.muted} />
              <Text style={[styles.tabLbl, on ? styles.tabLblOn : styles.tabLblOff]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={styles.panelWrap}>{panels}</View>
      {chatComposer}
    </View>
  );
}

function DesktopRail({
  currentTab,
  onOpenAgent,
  onOpenRx,
}: {
  currentTab: MedicareTabId;
  onOpenAgent: () => void;
  onOpenRx: () => void;
}) {
  return (
    <View style={styles.railInner}>
      <Text style={styles.railSectionTitle}>Your plan</Text>
      <View style={styles.railCard}>
        <Text style={styles.railCardKicker}>Medicare Advantage</Text>
        <Text style={styles.railCardPlan}>Humana Gold Plus HMO</Text>
        <View style={styles.railStatusRow}>
          <View style={styles.railDot} />
          <Text style={styles.railStatusTxt}>Enrollment active</Text>
        </View>
      </View>

      <Text style={styles.railSectionTitle}>Prescription costs</Text>
      <View style={styles.railCard}>
        <Text style={styles.railMuted}>Rx deductible progress</Text>
        <View style={styles.railTrack}>
          <View style={[styles.railFill, { width: "38.5%" }]} />
        </View>
        <Text style={styles.railStrong}>
          $250 <Text style={styles.railMutedInline}>used</Text> · $400 <Text style={styles.railMutedInline}>remaining</Text>
        </Text>
        <Pressable onPress={onOpenRx} style={styles.railLinkBtn}>
          <Feather name="heart" size={15} color={c.primary} />
          <Text style={styles.railLinkBtnTxt}>Compare pharmacy prices</Text>
          <Feather name="chevron-right" size={16} color={c.primary} />
        </Pressable>
      </View>

      <Text style={styles.railSectionTitle}>Support</Text>
      <View style={styles.railCard}>
        <Text style={styles.railBody}>
          Questions about benefits, costs, or enrollment? Your licensed agent can help.
        </Text>
        <Pressable onPress={onOpenAgent} style={styles.railPrimaryBtn}>
          <Feather name="user" size={16} color={c.white} />
          <Text style={styles.railPrimaryBtnTxt}>My Agent</Text>
        </Pressable>
      </View>

      {currentTab === "chat" && (
        <View style={[styles.railCard, styles.railHintCard]}>
          <Feather name="info" size={16} color={c.primaryDark} />
          <Text style={styles.railHint}>
            Tip: Ask Plan-GPT about dental, vision, MTM, or in-network providers — answers use your plan context.
          </Text>
        </View>
      )}
    </View>
  );
}

function ChatPanel({
  history,
  pending,
  layoutWide,
}: {
  history: LocalChatMessage[];
  pending: boolean;
  layoutWide?: boolean;
}) {
  const pad = layoutWide ? styles.scrollPadWide : styles.scrollPad;
  return (
    <ScrollView
      style={[styles.scroll, layoutWide && styles.scrollWide]}
      contentContainerStyle={pad}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <MsgRow
        layoutWide={layoutWide}
        body={
          <>
            <Text style={styles.brandLbl}>Plan-GPT</Text>
            <Text style={styles.bubbleText}>
              Hi, I am your Medicare AI guide and can assist you with your Medicare Advantage plan. Feel free to ask me
              specific questions about your plan. I'm here to help you use your Medicare Advantage plan.
            </Text>
            <View style={styles.tipRow}>
              <View style={styles.tipIcon}>
                <Feather name="coffee" size={12} color={c.primary} />
              </View>
              <Text style={styles.tipText}>
                I will also check in from time to time with tips on how to get the most out of your health plan.
              </Text>
            </View>
          </>
        }
      />
      <View style={[styles.userWrap, layoutWide && styles.userWrapWide]}>
        <View style={[styles.userBubble, layoutWide && styles.userBubbleWide]}>
          <Text style={styles.userText}>What's covered under my Medicare Advantage plan?</Text>
        </View>
      </View>
      <MsgRow
        layoutWide={layoutWide}
        body={
          <>
            <Text style={styles.brandLbl}>Plan-GPT</Text>
            <Text style={[styles.bubbleText, { marginBottom: 8 }]}>
              Your Humana Gold Plus HMO includes all Original Medicare benefits, plus extras:
            </Text>
            <Bullet text={"Hospital & doctor visits (Parts A & B)"} highlight={false} />
            <Bullet text="Prescription drugs (Part D included)" highlight={false} />
            <Bullet text="Dental, vision & hearing — included!" highlight />
            <Bullet text="$0 premium, $3,400 MOOP limit" highlight />
          </>
        }
      />
      <MsgRow
        layoutWide={layoutWide}
        body={
          <>
            <Text style={styles.brandLbl}>Plan-GPT</Text>
            <Text style={[styles.bubbleText, { marginBottom: 8 }]}>
              Based upon your medications you have a free MTM benefit that you are not taking advantage of.
            </Text>
            <View style={styles.mtmBox}>
              <Text style={styles.mtmText}>
                <Text style={styles.mtmLink}>Click here</Text> to learn more about Medication Therapy Management and you
                can speak to a licensed pharmacist to make sure you are on the right medications.
              </Text>
            </View>
            <Pressable style={styles.mtmBtn}>
              <Feather name="heart" size={14} color={c.white} />
              <Text style={styles.mtmBtnText}>Click here to get started</Text>
            </Pressable>
          </>
        }
      />

      {history.map((m, i) => {
        if (m.role === "user") {
          return (
            <View key={`m-${i}`} style={[styles.userWrap, layoutWide && styles.userWrapWide]}>
              <View style={[styles.userBubble, layoutWide && styles.userBubbleWide]}>
                <Text style={styles.userText}>{m.content}</Text>
              </View>
            </View>
          );
        }
        return (
          <MsgRow
            key={`m-${i}`}
            layoutWide={layoutWide}
            body={
              <>
                <Text style={styles.brandLbl}>Plan-GPT</Text>
                <Text style={styles.bubbleText}>{m.content}</Text>
              </>
            }
          />
        );
      })}

      {pending && (
        <MsgRow
          layoutWide={layoutWide}
          body={
            <>
              <Text style={styles.brandLbl}>Plan-GPT</Text>
              <Text style={styles.bubbleText}>Thinking…</Text>
            </>
          }
        />
      )}
    </ScrollView>
  );
}

function Bullet({ text, highlight }: { text: string; highlight: boolean }) {
  return (
    <View style={[styles.bulletRow, highlight && styles.bulletRowHi]}>
      <View style={[styles.bulletDot, highlight ? styles.bulletDotHi : styles.bulletDotNorm]} />
      <Text style={[styles.bulletTxt, highlight && styles.bulletTxtHi]}>{text}</Text>
    </View>
  );
}

function MsgRow({ body, layoutWide }: { body: React.ReactNode; layoutWide?: boolean }) {
  return (
    <View style={[styles.msgRow, layoutWide && styles.msgRowWide]}>
      <View style={[styles.aiAv, layoutWide && styles.aiAvWide]}>
        <Feather name="shield" size={layoutWide ? 16 : 14} color={c.white} />
      </View>
      <View style={[styles.aiBubble, layoutWide && styles.aiBubbleWide]}>{body}</View>
    </View>
  );
}

function RxPanel() {
  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={{ paddingBottom: 20 }}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.rxHeader}>
        <View style={styles.rxLocRow}>
          <Feather name="map-pin" size={14} color={c.primary} />
          <Text style={styles.rxLocTitle}>My Search Area</Text>
        </View>
        <View style={styles.rxFields}>
          <View style={{ flex: 1 }}>
            <Text style={styles.fieldLbl}>Zip code or city</Text>
            <View style={styles.fieldBox}>
              <Text style={styles.fieldVal}>90210 — Beverly Hills</Text>
              <Feather name="chevron-down" size={14} color={c.primary} />
            </View>
          </View>
          <View style={{ width: 88 }}>
            <Text style={styles.fieldLbl}>Radius</Text>
            <View style={styles.fieldBox}>
              <Text style={styles.fieldVal}>2 mi</Text>
              <Feather name="chevron-down" size={14} color={c.primary} />
            </View>
          </View>
        </View>
      </View>
      <View style={{ padding: 12, gap: 12 }}>
        <RxCard
          name="Lisinopril 10mg"
          sub="Generic · Tier 1 · 30-day supply"
          badge="Replaces Zestril"
          pharmacies={[
            { n: "CVS Pharmacy", d: "0.4 mi", p: "$0", tag: "Best" },
            { n: "Walgreens", d: "0.9 mi", p: "$0", tag: "Tier 1" },
            { n: "Rite Aid", d: "1.7 mi", p: "$3", tag: "OTC fee" },
          ]}
        />
        <RxCard
          name="Atorvastatin 20mg"
          sub="Generic · Tier 1 · 30-day supply"
          badge="Replaces Lipitor"
          pharmacies={[
            { n: "Costco Pharm.", d: "1.1 mi", p: "$8", tag: "Best" },
            { n: "CVS Pharmacy", d: "0.4 mi", p: "$11", tag: "Tier 1" },
            { n: "Walgreens", d: "0.9 mi", p: "$14", tag: "Tier 1" },
          ]}
        />
        <RxCard
          name="Metformin 500mg"
          sub="Generic · Tier 1 · 30-day supply"
          badge="Replaces Glucophage"
          pharmacies={[
            { n: "Walmart Pharm.", d: "1.4 mi", p: "$0", tag: "Best" },
            { n: "CVS Pharmacy", d: "0.4 mi", p: "$4", tag: "Tier 1" },
            { n: "Rite Aid", d: "1.7 mi", p: "$7", tag: "Tier 1" },
          ]}
        />
      </View>
    </ScrollView>
  );
}

function RxCard({
  name,
  sub,
  badge,
  pharmacies,
}: {
  name: string;
  sub: string;
  badge: string;
  pharmacies: { n: string; d: string; p: string; tag: string }[];
}) {
  return (
    <View style={styles.rxCard}>
      <View style={styles.rxCardHead}>
        <View>
          <Text style={styles.rxName}>{name}</Text>
          <Text style={styles.rxSub}>{sub}</Text>
        </View>
        <View style={styles.rxBadge}>
          <Text style={styles.rxBadgeTxt}>{badge}</Text>
        </View>
      </View>
      <View style={styles.rxGrid3}>
        {pharmacies.map((ph, i) => (
          <View key={ph.n} style={[styles.rxPh, i < 2 && styles.rxPhBorder]}>
            <Text style={styles.rxPhName}>{ph.n}</Text>
            <Text style={styles.rxPhDist}>{ph.d}</Text>
          </View>
        ))}
      </View>
      <View style={styles.rxGrid3}>
        {pharmacies.map((ph, i) => (
          <View
            key={`${ph.n}-p`}
            style={[styles.rxPriceCell, i < 2 && styles.rxPhBorder, ph.tag === "Best" && styles.rxBestCell]}
          >
            <Text style={[styles.rxPrice, ph.tag === "Best" && styles.rxPriceBest]}>{ph.p}</Text>
            <Text style={[styles.rxTag, ph.tag === "Best" && styles.rxTagBest]}>{ph.tag}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const VIDEO_CHIPS = ["All", "Getting Started", "Benefits", "Prescriptions", "Costs"];

function VideosPanel() {
  const [chip, setChip] = useState("All");
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={{ paddingBottom: 20 }} showsVerticalScrollIndicator={false}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.vChipScroll} contentContainerStyle={styles.vChipRow}>
        {VIDEO_CHIPS.map((x) => (
          <Pressable
            key={x}
            onPress={() => setChip(x)}
            style={[styles.vChip, x === chip ? styles.vChipOn : styles.vChipOff]}
          >
            <Text style={[styles.vChipTxt, x === chip && styles.vChipTxtOn]}>{x}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <View style={{ padding: 12, gap: 10 }}>
        <VideoRow cat="GETTING STARTED" title="Welcome to Your Medicare Advantage Plan" desc="An overview of your Humana Gold Plus HMO and how to get started." dur="4 min" grad={[c.primaryDark, c.primaryDeep]} />
        <VideoRow cat="BENEFITS" title="Using Your Dental, Vision & Hearing Benefits" desc="How to find in-network providers and use your extra benefits." dur="6 min" grad={["#27500a", "#3b6d11"]} />
        <VideoRow cat="PRESCRIPTIONS" title="How to Fill Prescriptions & Save on Medications" desc="Understanding your formulary tiers and finding cheaper generics." dur="5 min" grad={["#533ab7", "#3c3489"]} />
        <VideoRow cat="COSTS" title="Understanding Copays, Deductibles & Your MOOP" desc="What you pay and when your out-of-pocket max kicks in." dur="7 min" grad={["#854f0b", "#633806"]} />
        <VideoRow cat="GETTING STARTED" title="How to Find an In-Network Doctor or Specialist" desc="Use the Humana provider directory to stay in-network and save." dur="3 min" grad={["#185fa5", "#0c447c"]} />
      </View>
    </ScrollView>
  );
}

function VideoRow({
  cat,
  title,
  desc,
  dur,
  grad,
}: {
  cat: string;
  title: string;
  desc: string;
  dur: string;
  grad: [string, string];
}) {
  return (
    <View style={styles.vCard}>
      <View style={[styles.vThumb, { backgroundColor: grad[0] }]}>
        <Text style={styles.vCat}>{cat}</Text>
        <View style={styles.vPlay}>
          <Feather name="play" size={16} color={c.white} style={{ marginLeft: 2 }} />
        </View>
        <Text style={styles.vTimeSmall}>4:32</Text>
      </View>
      <View style={styles.vBody}>
        <Text style={styles.vTitle}>{title}</Text>
        <Text style={styles.vDesc}>{desc}</Text>
        <View style={styles.vDurRow}>
          <Feather name="clock" size={12} color={c.primary} />
          <Text style={styles.vDur}>{dur}</Text>
        </View>
      </View>
    </View>
  );
}

function AnalyticsPanel() {
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={{ paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
      <View style={styles.anYearBar}>
        <Text style={styles.anYearTxt}>2026 Plan Year</Text>
        <View style={styles.anPill}>
          <View style={styles.activeDot} />
          <Text style={styles.anPillTxt}>Current</Text>
        </View>
      </View>
      <View style={styles.anMeta}>
        <View style={[styles.anMetaCol, { borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: c.borderSoft }]}>
          <Text style={styles.anMetaLbl}>CARRIER / PLAN</Text>
          <Text style={styles.anMetaVal}>Humana Gold Plus HMO</Text>
        </View>
        <View style={[styles.anMetaCol, { flex: 1.1 }]}>
          <Text style={styles.anMetaLbl}>PLAN ID / TYPE</Text>
          <Text style={styles.anMetaVal}>H1234-001 · MA HMO</Text>
        </View>
        <View style={{ paddingLeft: 8 }}>
          <Text style={styles.anMetaLbl}>UPDATED</Text>
          <Text style={[styles.anMetaVal, { color: c.primary, fontSize: 11 }]}>Mar 28, 2026</Text>
        </View>
      </View>
      <View style={styles.anCard}>
        <BarLine label="Medical Deductible" cur="$320" max="$500" pct={0.64} />
        <BarLine label="Rx Deductible" cur="$250" max="$650" pct={0.385} />
        <BarLine label="Out-of-Pocket vs. MOOP" cur="$1,240" max="$3,400" pct={0.365} />
      </View>
      <View style={styles.anTwo}>
        <View style={styles.anStat}>
          <Text style={styles.anStatLbl}>BENEFIT AFTER RX DED.</Text>
          <Text style={styles.anStatBig}>$0</Text>
          <Text style={styles.anStatSub}>Not yet met</Text>
        </View>
        <View style={styles.anStat}>
          <Text style={styles.anStatLbl}>BENEFIT AFTER OOPM</Text>
          <Text style={styles.anStatBig}>$0</Text>
          <Text style={styles.anStatSub}>Not yet met</Text>
        </View>
      </View>
      <View style={styles.anWarn}>
        <View style={styles.anWarnIcon}>
          <Text style={{ color: c.warnText, fontWeight: "800", fontSize: 12 }}>!</Text>
        </View>
        <Text style={styles.anWarnTxt}>
          You're on track to meeting your deductible and out of pocket maximum. It does not look like you have used
          your Extra Benefits — consider wellness, acupuncture, gym membership and other benefits.
        </Text>
      </View>
      <View style={styles.anDivider}>
        <View style={styles.anDivLine} />
        <Text style={styles.anDivLbl}>Prior Plan Year</Text>
        <View style={styles.anDivLine} />
      </View>
      <View style={[styles.anYearBar, { backgroundColor: "#85887a" }]}>
        <Text style={styles.anYearTxt}>2025 Plan Year</Text>
        <View style={[styles.anPill, { backgroundColor: "rgba(255,255,255,0.2)" }]}>
          <Text style={styles.anPillTxt}>Completed</Text>
        </View>
      </View>
      <View style={[styles.anMeta, { borderBottomColor: "#e4e4e4" }]}>
        <View style={[styles.anMetaCol, { borderRightColor: "#eee" }]}>
          <Text style={styles.anMetaLbl}>CARRIER / PLAN</Text>
          <Text style={[styles.anMetaVal, { color: c.muted }]}>Humana Gold Plus HMO</Text>
        </View>
        <View style={styles.anMetaCol}>
          <Text style={styles.anMetaLbl}>PLAN ID / TYPE</Text>
          <Text style={[styles.anMetaVal, { color: c.muted }]}>H1234-001 · MA HMO</Text>
        </View>
      </View>
      <View style={[styles.anCard, { borderColor: "#e4e4e4" }]}>
        <BarLineDone label="Medical Deductible" text="$500 / $500 ✓" />
        <BarLineDone label="Rx Deductible" text="$650 / $650 ✓" />
        <BarLineDone label="Out-of-Pocket vs. MOOP" text="$3,400 / $3,400 ✓" />
      </View>
      <View style={styles.anTwo}>
        <View style={[styles.anStat, { borderColor: "#e4e4e4" }]}>
          <Text style={styles.anStatLbl}>BENEFIT AFTER RX DED.</Text>
          <Text style={[styles.anStatBig, { color: c.accentOlive, fontSize: 18 }]}>$1,125.44</Text>
          <Text style={[styles.anStatSub, { color: c.accentOlive, fontWeight: "600" }]}>Deductible met</Text>
        </View>
        <View style={[styles.anStat, { borderColor: "#e4e4e4" }]}>
          <Text style={styles.anStatLbl}>BENEFIT AFTER OOPM</Text>
          <Text style={[styles.anStatBig, { color: c.accentOlive, fontSize: 18 }]}>$17,220</Text>
          <Text style={[styles.anStatSub, { color: c.accentOlive, fontWeight: "600" }]}>MOOP met</Text>
        </View>
      </View>
      <View style={styles.anOk}>
        <View style={styles.anOkIcon}>
          <Feather name="check" size={12} color={c.white} />
        </View>
        <Text style={styles.anOkTxt}>You met your deductible and out of pocket maximum in full this year.</Text>
      </View>
    </ScrollView>
  );
}

function BarLine({ label, cur, max, pct }: { label: string; cur: string; max: string; pct: number }) {
  return (
    <View style={{ marginBottom: 10 }}>
      <View style={styles.barTop}>
        <Text style={styles.barLbl}>{label}</Text>
        <Text style={styles.barVal}>
          {cur} <Text style={{ color: c.mutedLight, fontWeight: "400" }}>/ {max}</Text>
        </Text>
      </View>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${Math.round(pct * 100)}%` }]} />
      </View>
    </View>
  );
}

function BarLineDone({ label, text }: { label: string; text: string }) {
  return (
    <View style={{ marginBottom: 10 }}>
      <View style={styles.barTop}>
        <Text style={[styles.barLbl, { color: c.muted }]}>{label}</Text>
        <Text style={[styles.barVal, { color: c.accentOlive }]}>{text}</Text>
      </View>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: "100%", backgroundColor: c.accentOlive }]} />
      </View>
    </View>
  );
}

function BestPlanPanel() {
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={{ paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
      <View style={styles.bpBanner}>
        <Text style={styles.bpBannerTit}>2027 Plan Recommendations</Text>
        <View style={styles.bpAep}>
          <Text style={styles.bpAepTxt}>AEP Oct 15 – Dec 7</Text>
        </View>
      </View>
      <View style={styles.bpIntro}>
        <Text style={styles.bpIntroTxt}>
          Based upon your medical and drug utilization in 2026, we recommend that you stay on your existing plan for 2027.
          Compared to the other lowest estimated cost plans, your current Humana plan is the lowest estimated cost.
        </Text>
        <Text style={styles.bpIntroFoot}>Please consult with your agent for further information.</Text>
      </View>
      <View style={styles.bpActions}>
        <Pressable style={styles.bpBtnFill}>
          <Feather name="calendar" size={18} color={c.white} />
          <Text style={styles.bpBtnFillTxt}>Setup an Appointment</Text>
        </Pressable>
        <Pressable style={styles.bpBtnOut}>
          <Feather name="phone" size={18} color={c.primary} />
          <Text style={styles.bpBtnOutTxt}>Call My Agent</Text>
        </Pressable>
      </View>
      <Text style={styles.bpSec}>OUR RECOMMENDATION</Text>
      <View style={styles.bpRec}>
        <View style={styles.bpRecHead}>
          <Text style={styles.bpRecHeadTxt}>★ Stay on your Current Plan for 2027</Text>
          <View style={styles.bpLowest}>
            <Text style={styles.bpLowestTxt}>Lowest Cost</Text>
          </View>
        </View>
        <View style={styles.bpRecBody}>
          <Text style={styles.bpPlanName}>Humana Gold Plus HMO</Text>
          <Text style={styles.bpPlanSub}>H1234-001 · Medicare Advantage HMO · 4.5★</Text>
          <View style={styles.bpGrid2}>
            <View style={styles.bpMini}>
              <Text style={styles.bpMiniLbl}>MONTHLY PREMIUM</Text>
              <Text style={styles.bpMiniBig}>$0</Text>
              <Text style={styles.bpMiniSub}>per month</Text>
            </View>
            <View style={styles.bpMini}>
              <Text style={styles.bpMiniLbl}>EST. ANNUAL OOPM</Text>
              <Text style={styles.bpMiniBig}>$3,400</Text>
              <Text style={styles.bpMiniSub}>maximum</Text>
            </View>
          </View>
        </View>
      </View>
      <Text style={[styles.bpSec, { color: c.muted }]}>OTHER PLANS COMPARED</Text>
      <View style={styles.bpTable}>
        <View style={styles.bpTh}>
          <Text style={[styles.bpTc, { flex: 1 }]}>Plan</Text>
          <Text style={[styles.bpTc, { width: 72, textAlign: "center" }]}>Premium</Text>
          <Text style={[styles.bpTc, { width: 72, textAlign: "center" }]}>Est. OOPM</Text>
        </View>
        <PlanCompareRow name="Aetna MA PPO" sub="4.7★ · PPO" prem="$29" oop="$4,200" />
        <PlanCompareRow name="UHC AARP HMO" sub="4.4★ · HMO" prem="$42" oop="$4,900" />
        <PlanCompareRow name="Cigna Healthspring" sub="4.2★ · HMO" prem="$58" oop="$5,500" last />
      </View>
    </ScrollView>
  );
}

function PlanCompareRow({
  name,
  sub,
  prem,
  oop,
  last,
}: {
  name: string;
  sub: string;
  prem: string;
  oop: string;
  last?: boolean;
}) {
  return (
    <View style={[styles.bpTr, !last && styles.bpTrBorder]}>
      <View style={{ flex: 1 }}>
        <Text style={styles.bpTn}>{name}</Text>
        <Text style={styles.bpTs}>{sub}</Text>
      </View>
      <View style={{ width: 72, alignItems: "center" }}>
        <Text style={styles.bpTp}>{prem}</Text>
        <Text style={styles.bpTsub}>/mo</Text>
      </View>
      <View style={{ width: 72, alignItems: "center" }}>
        <Text style={[styles.bpTp, { color: c.danger }]}>{oop}</Text>
        <Text style={styles.bpTsub}>max</Text>
      </View>
    </View>
  );
}

function AgentPanel() {
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={{ paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
      <View style={styles.agHero}>
        <View style={styles.agRow}>
          <Image
            source={{ uri: "https://images.unsplash.com/photo-1560250097-0b93528c311a?w=200&h=200&fit=crop" }}
            style={styles.agPhoto}
          />
          <View style={styles.agHeroTxt}>
            <Text style={[styles.agName, { fontFamily: serif }]}>Bob Broker</Text>
            <Text style={styles.agTag}>Licensed Medicare Agent since 2007</Text>
            <Text style={styles.agSite}>YourHealthPlan.com</Text>
          </View>
        </View>
      </View>
      <View style={styles.agQuote}>
        <Text style={styles.agQuoteTxt}>
          "Thanks for choosing YourHealthPlan for your Medicare insurance needs. I'm your agent, Bob Broker and I
          appreciate your trust in our Medicare expertise."
        </Text>
      </View>
      <View style={styles.agCard}>
        <View style={styles.agCardHead}>
          <Text style={styles.agCardHeadTxt}>CONTACT</Text>
        </View>
        <View style={styles.agLine}>
          <Feather name="phone" size={16} color={c.primary} />
          <Text style={styles.agLineTxt}>(800) 555-0199</Text>
        </View>
        <View style={styles.agLine}>
          <Feather name="mail" size={16} color={c.primary} />
          <Text style={[styles.agLineTxt, { color: c.primary, textDecorationLine: "underline" }]}>bob@yourhealthplan.com</Text>
        </View>
        <View style={[styles.agLine, { borderBottomWidth: 0 }]}>
          <Feather name="globe" size={16} color={c.primary} />
          <Text style={[styles.agLineTxt, { color: c.primary, textDecorationLine: "underline" }]}>YourHealthPlan.com</Text>
        </View>
      </View>
      <View style={styles.agCard}>
        <View style={styles.agCardHead}>
          <Text style={styles.agCardHeadTxt}>ABOUT BOB</Text>
        </View>
        <View style={{ padding: 12 }}>
          <Text style={styles.agBio}>
            When I'm not on the golf course, tinkering with an old car or motorcycle in the garage, or soaking up
            time with my family, I'm doing what I love most professionally — helping people find the Medicare plan
            that's just right for them.
          </Text>
          <View style={styles.agPull}>
            <Text style={styles.agPullTxt}>
              Because everyone deserves great coverage, and nobody should have to figure it out alone.
            </Text>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.pageBg, minHeight: 0 },
  rootWide: {
    flex: 1,
    flexDirection: "row",
    minHeight: 0,
    backgroundColor: c.adminBorder,
  },
  sideNav: {
    width: 236,
    flexShrink: 0,
    backgroundColor: c.adminNav,
    paddingTop: Platform.OS === "ios" ? 14 : 16,
    paddingBottom: 12,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: "rgba(255,255,255,0.08)",
  },
  sideNavBrand: {
    paddingHorizontal: 16,
    paddingBottom: 18,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  sideLogoMark: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: c.primary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  sideAppTitle: { color: c.white, fontSize: 19, fontWeight: "700" },
  sideAppSub: { color: "rgba(255,255,255,0.42)", fontSize: 11, marginTop: 4, letterSpacing: 0.4 },
  sideNavScroll: { flex: 1, paddingTop: 12 },
  sideNavItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginHorizontal: 10,
    marginVertical: 3,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  sideNavItemOn: {
    backgroundColor: "rgba(29,158,117,0.22)",
  },
  sideNavLbl: { color: "rgba(255,255,255,0.55)", fontSize: 14, fontWeight: "600" },
  sideNavLblOn: { color: c.primary },
  sideNavFooter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 14,
    marginTop: 8,
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  sideNavFooterTxt: { color: "rgba(255,255,255,0.38)", fontSize: 12, fontWeight: "600" },
  mainWide: { flex: 1, minWidth: 0, minHeight: 0, flexDirection: "column", backgroundColor: c.pageBg },
  wideTopGreen: {
    backgroundColor: c.primary,
    paddingHorizontal: 20,
    paddingVertical: 14,
    flexShrink: 0,
  },
  wideTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
  },
  widePlanBlock: { flex: 1, minWidth: 0 },
  widePlanTitleRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 10 },
  widePlanName: { color: c.white, fontSize: 18, fontWeight: "700", flexShrink: 1 },
  activePillWide: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(255,255,255,0.22)",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  wideDedRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  wideDedTrack: {
    flex: 1,
    maxWidth: 420,
    height: 8,
    borderRadius: 4,
    backgroundColor: "rgba(0,0,0,0.2)",
    overflow: "hidden",
  },
  wideHeaderIcons: { flexDirection: "row", alignItems: "center", gap: 18, paddingTop: 2 },
  wideBodySplit: {
    flex: 1,
    flexDirection: "row",
    minHeight: 0,
  },
  wideCenterCol: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    flexDirection: "column",
  },
  panelWrapWide: { flex: 1, minHeight: 0 },
  wideRail: {
    width: 300,
    flexShrink: 0,
    backgroundColor: "#f4f6f8",
    borderLeftWidth: 1,
    borderLeftColor: c.adminBorder,
  },
  wideRailContent: { padding: 16, paddingBottom: 32 },
  railInner: { gap: 4 },
  railSectionTitle: {
    fontSize: 10,
    fontWeight: "700",
    color: c.adminMuted,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginTop: 12,
    marginBottom: 8,
  },
  railCard: {
    backgroundColor: c.white,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: c.adminBorder,
    padding: 14,
    marginBottom: 4,
  },
  railHintCard: { flexDirection: "row", gap: 10, alignItems: "flex-start", backgroundColor: c.mintBg, borderColor: c.mint },
  railCardKicker: { fontSize: 11, color: c.adminMuted, fontWeight: "600", marginBottom: 4 },
  railCardPlan: { fontSize: 16, fontWeight: "700", color: c.text, lineHeight: 22 },
  railStatusRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 },
  railDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: c.mint },
  railStatusTxt: { fontSize: 13, color: c.primaryDark, fontWeight: "600" },
  railMuted: { fontSize: 12, color: c.adminMuted, marginBottom: 8 },
  railMutedInline: { color: c.adminMuted, fontWeight: "400" },
  railTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: c.borderSoft,
    overflow: "hidden",
    marginBottom: 8,
  },
  railFill: { height: "100%", backgroundColor: c.primary, borderRadius: 4 },
  railStrong: { fontSize: 14, fontWeight: "700", color: c.text },
  railLinkBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.adminBorder,
  },
  railLinkBtnTxt: { flex: 1, fontSize: 14, fontWeight: "700", color: c.primary },
  railBody: { fontSize: 13, color: c.text, lineHeight: 20, marginBottom: 12 },
  railPrimaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: c.primary,
    borderRadius: 10,
    paddingVertical: 12,
  },
  railPrimaryBtnTxt: { fontSize: 14, fontWeight: "700", color: c.white },
  railHint: { flex: 1, fontSize: 12, color: c.primaryDeep, lineHeight: 18 },
  scrollPadWide: {
    paddingHorizontal: 28,
    paddingVertical: 20,
    paddingBottom: 32,
    gap: 14,
    /** Without full-width content, flex rows collapse on web and text stacks one character per line. */
    width: "100%",
    maxWidth: "100%",
  },
  msgRowWide: {
    width: "100%",
    maxWidth: "100%",
    alignSelf: "stretch",
  },
  aiBubbleWide: {
    flex: 1,
    minWidth: 0,
    maxWidth: 720,
  },
  aiAvWide: { width: 34, height: 34, borderRadius: 17 },
  userBubbleWide: { maxWidth: 560 },
  inputBarWide: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 20,
    backgroundColor: c.white,
    borderTopWidth: 1,
    borderTopColor: c.adminBorder,
  },
  inputInnerWide: {
    maxWidth: 960,
    alignSelf: "center",
    width: "100%",
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 28,
  },
  chatInputWide: { fontSize: 15 },
  sendBtnWide: { width: 40, height: 40, borderRadius: 20 },
  header: {
    backgroundColor: c.primary,
    paddingTop: Platform.OS === "ios" ? 8 : 12,
    paddingHorizontal: 14,
    paddingBottom: 10,
  },
  headerTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  logoMark: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  appTitle: { color: c.white, fontSize: 17, fontWeight: "700" },
  appSub: { color: "rgba(255,255,255,0.65)", fontSize: 11, marginTop: 2, letterSpacing: 0.3 },
  headerIcons: { flexDirection: "row", alignItems: "center", gap: 16 },
  planCard: {
    backgroundColor: "rgba(255,255,255,0.13)",
    borderRadius: 10,
    padding: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.22)",
  },
  planRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  planName: { color: c.white, fontSize: 14, fontWeight: "700", flex: 1 },
  activePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(255,255,255,0.2)",
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  activeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: c.mint },
  activeText: { color: c.white, fontSize: 11, fontWeight: "600" },
  dedRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  dedLbl: { color: "rgba(255,255,255,0.7)", fontSize: 12 },
  dedTrack: { flex: 1, height: 6, borderRadius: 4, backgroundColor: "rgba(0,0,0,0.2)", overflow: "hidden" },
  dedFill: { height: "100%", backgroundColor: c.mint, borderRadius: 4 },
  dedVal: { color: "rgba(255,255,255,0.85)", fontSize: 11 },
  dedStrong: { fontWeight: "700", color: c.white },
  tabScroll: { flexGrow: 0, backgroundColor: c.white, borderBottomWidth: 1.5, borderBottomColor: c.borderLight },
  tabRow: { flexDirection: "row", alignItems: "stretch", paddingHorizontal: 4 },
  tab: {
    minWidth: 72,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderBottomWidth: 2.5,
    borderBottomColor: "transparent",
    marginBottom: -1.5,
  },
  tabOn: { borderBottomColor: c.primary },
  tabLbl: { fontSize: 10, marginTop: 4, fontWeight: "500" },
  tabLblOn: { color: c.primary, fontWeight: "700" },
  tabLblOff: { color: c.muted },
  panelWrap: { flex: 1, minHeight: 0 },
  scroll: { flex: 1, minHeight: 0 },
  /** Lets the scroll view consume full width of the center column on web (wide layout). */
  scrollWide: { alignSelf: "stretch", width: "100%" },
  scrollPad: { padding: 14, paddingBottom: 24, gap: 12 },
  msgRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  aiAv: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: c.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  aiBubble: {
    flex: 1,
    maxWidth: "88%",
    backgroundColor: c.white,
    borderRadius: 16,
    borderBottomLeftRadius: 4,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.borderLight,
  },
  brandLbl: { fontSize: 12, color: c.primary, fontWeight: "700", marginBottom: 6 },
  bubbleText: { fontSize: 14, color: c.text, lineHeight: 22 },
  tipRow: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#e8f5ee",
    flexDirection: "row",
    gap: 8,
    alignItems: "flex-start",
  },
  tipIcon: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: c.mintBg,
    alignItems: "center",
    justifyContent: "center",
  },
  tipText: { flex: 1, fontSize: 13, color: c.primaryDark, fontStyle: "italic", lineHeight: 20 },
  userWrap: { alignItems: "flex-end" },
  userWrapWide: { width: "100%", alignSelf: "stretch" },
  userBubble: {
    maxWidth: "85%",
    backgroundColor: c.primary,
    borderRadius: 16,
    borderBottomRightRadius: 4,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  userText: { color: c.white, fontSize: 14, lineHeight: 20 },
  bulletRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: c.pageBg,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: 4,
  },
  bulletRowHi: { backgroundColor: c.oliveBg, borderWidth: StyleSheet.hairlineWidth, borderColor: "#c0dd97" },
  bulletDot: { width: 8, height: 8, borderRadius: 4 },
  bulletDotNorm: { backgroundColor: c.primary },
  bulletDotHi: { backgroundColor: c.accentOlive },
  bulletTxt: { fontSize: 13, color: c.text, flex: 1 },
  bulletTxtHi: { color: c.accentOliveDark, fontWeight: "600" },
  mtmBox: {
    backgroundColor: c.mintBg,
    borderRadius: 9,
    padding: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.mint,
    marginBottom: 10,
  },
  mtmText: { fontSize: 13, color: c.primaryDeep, lineHeight: 20 },
  mtmLink: { color: c.primaryDark, fontWeight: "700", textDecorationLine: "underline" },
  mtmBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: c.primary,
    borderRadius: 20,
    paddingVertical: 10,
  },
  mtmBtnText: { color: c.white, fontSize: 13, fontWeight: "700" },
  inputBar: {
    backgroundColor: c.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.borderLight,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: Platform.OS === "ios" ? 20 : 12,
  },
  inputInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#f0faf5",
    borderRadius: 24,
    paddingVertical: Platform.OS === "web" ? 6 : 10,
    paddingHorizontal: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.mint,
  },
  chatInput: {
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    color: c.text,
    paddingVertical: Platform.OS === "ios" ? 8 : 6,
  },
  sendBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: c.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  homeRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 10 },
  homeDot: { width: 6, height: 6, borderRadius: 3 },
  homeBar: { width: 36, height: 5, borderRadius: 3, backgroundColor: c.borderLight },
  rxHeader: { backgroundColor: c.white, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.borderLight, padding: 12 },
  rxLocRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 },
  rxLocTitle: { fontSize: 13, fontWeight: "700", color: c.primaryDeep },
  rxFields: { flexDirection: "row", gap: 10 },
  fieldLbl: { fontSize: 11, color: c.muted, marginBottom: 4 },
  fieldBox: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: c.pageBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.mint,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  fieldVal: { fontSize: 14, color: c.text },
  rxCard: {
    backgroundColor: c.white,
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.borderLight,
    overflow: "hidden",
  },
  rxCardHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.borderSoft,
  },
  rxName: { fontSize: 15, fontWeight: "700", color: c.text },
  rxSub: { fontSize: 12, color: c.muted, marginTop: 2 },
  rxBadge: { backgroundColor: c.mintBg, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  rxBadgeTxt: { fontSize: 11, fontWeight: "700", color: c.primaryDeep },
  rxGrid3: { flexDirection: "row" },
  rxPh: { flex: 1, paddingVertical: 8, alignItems: "center" },
  rxPhBorder: { borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: c.borderSoft },
  rxPhName: { fontSize: 11, color: c.muted },
  rxPhDist: { fontSize: 11, color: c.mutedLight, marginTop: 2 },
  rxPriceCell: { flex: 1, paddingVertical: 10, alignItems: "center" },
  rxPrice: { fontSize: 18, fontWeight: "700", color: c.text },
  rxPriceBest: { color: c.primaryDark },
  rxTag: { fontSize: 11, color: c.muted, marginTop: 2 },
  rxTagBest: { color: c.primary, fontWeight: "600" },
  rxBestCell: { backgroundColor: "#f0fdf8" },
  vChipScroll: { backgroundColor: c.white, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.borderLight },
  vChipRow: { paddingHorizontal: 10, paddingVertical: 10, gap: 8, flexDirection: "row" },
  vChip: { borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6 },
  vChipOn: { backgroundColor: c.primary },
  vChipOff: { backgroundColor: "#f0faf5", borderWidth: StyleSheet.hairlineWidth, borderColor: c.mint },
  vChipTxt: { fontSize: 12, color: c.primaryDeep },
  vChipTxtOn: { color: c.white, fontWeight: "700" },
  vCard: {
    flexDirection: "row",
    backgroundColor: c.white,
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.borderLight,
    overflow: "hidden",
  },
  vThumb: {
    width: 96,
    minHeight: 88,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
  },
  vCat: { fontSize: 9, color: "rgba(255,255,255,0.65)", letterSpacing: 0.5 },
  vPlay: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
    marginVertical: 6,
  },
  vTimeSmall: { fontSize: 10, color: "rgba(255,255,255,0.5)" },
  vBody: { flex: 1, padding: 12, justifyContent: "center" },
  vTitle: { fontSize: 14, fontWeight: "700", color: c.text, lineHeight: 19 },
  vDesc: { fontSize: 12, color: c.muted, lineHeight: 18, marginTop: 4 },
  vDurRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 },
  vDur: { fontSize: 12, color: c.primary, fontWeight: "600" },
  anYearBar: {
    backgroundColor: c.primary,
    paddingVertical: 8,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  anYearTxt: { color: c.white, fontSize: 13, fontWeight: "700" },
  anPill: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(255,255,255,0.2)", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  anPillTxt: { color: c.white, fontSize: 11, fontWeight: "600" },
  anMeta: {
    flexDirection: "row",
    backgroundColor: c.white,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.borderLight,
    paddingVertical: 8,
    paddingHorizontal: 10,
    alignItems: "center",
  },
  anMetaCol: { flex: 1, paddingRight: 8 },
  anMetaLbl: { fontSize: 9, color: c.mutedLight, letterSpacing: 0.4, fontWeight: "600" },
  anMetaVal: { fontSize: 12, fontWeight: "700", color: c.text, marginTop: 2 },
  anCard: {
    margin: 10,
    backgroundColor: c.white,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.borderLight,
    padding: 12,
  },
  barTop: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  barLbl: { fontSize: 11, color: "#555", fontWeight: "600" },
  barVal: { fontSize: 11, color: c.primary, fontWeight: "700" },
  barTrack: { height: 8, borderRadius: 4, backgroundColor: c.borderSoft, overflow: "hidden" },
  barFill: { height: "100%", backgroundColor: c.primary, borderRadius: 4 },
  anTwo: { flexDirection: "row", gap: 10, marginHorizontal: 10, marginBottom: 10 },
  anStat: {
    flex: 1,
    backgroundColor: c.white,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.borderLight,
    padding: 10,
  },
  anStatLbl: { fontSize: 9, color: c.mutedLight, letterSpacing: 0.4, fontWeight: "600" },
  anStatBig: { fontSize: 22, fontWeight: "700", color: c.text, marginTop: 4 },
  anStatSub: { fontSize: 10, color: c.mutedLight, marginTop: 2 },
  anWarn: {
    marginHorizontal: 10,
    marginBottom: 10,
    backgroundColor: c.warnBg,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.warnBorder,
    padding: 10,
    flexDirection: "row",
    gap: 8,
    alignItems: "flex-start",
  },
  anWarnIcon: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#fac775",
    alignItems: "center",
    justifyContent: "center",
  },
  anWarnTxt: { flex: 1, fontSize: 12, color: c.warnText, lineHeight: 18 },
  anDivider: { flexDirection: "row", alignItems: "center", marginVertical: 8, marginHorizontal: 10, gap: 8 },
  anDivLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: c.borderLight },
  anDivLbl: { fontSize: 11, color: c.mutedLight },
  anOk: {
    marginHorizontal: 10,
    backgroundColor: c.oliveBg,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#c0dd97",
    padding: 10,
    flexDirection: "row",
    gap: 8,
    alignItems: "flex-start",
  },
  anOkIcon: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#97c459",
    alignItems: "center",
    justifyContent: "center",
  },
  anOkTxt: { flex: 1, fontSize: 12, color: c.accentOliveDark, lineHeight: 18 },
  bpBanner: {
    backgroundColor: c.primary,
    paddingVertical: 10,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  bpBannerTit: { color: c.white, fontSize: 13, fontWeight: "700", flex: 1 },
  bpAep: { backgroundColor: "rgba(255,255,255,0.2)", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  bpAepTxt: { color: c.white, fontSize: 10, fontWeight: "600" },
  bpIntro: {
    margin: 12,
    backgroundColor: c.white,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.borderLight,
    padding: 12,
  },
  bpIntroTxt: { fontSize: 13, color: c.text, lineHeight: 21 },
  bpIntroFoot: { marginTop: 8, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.borderSoft, fontSize: 12, color: c.muted },
  bpActions: { flexDirection: "row", gap: 10, marginHorizontal: 12, marginBottom: 8 },
  bpBtnFill: {
    flex: 1,
    backgroundColor: c.primary,
    borderRadius: 9,
    paddingVertical: 12,
    alignItems: "center",
    gap: 4,
  },
  bpBtnFillTxt: { color: c.white, fontSize: 12, fontWeight: "700", textAlign: "center" },
  bpBtnOut: {
    flex: 1,
    backgroundColor: c.white,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: c.primary,
    paddingVertical: 12,
    alignItems: "center",
    gap: 4,
  },
  bpBtnOutTxt: { color: c.primary, fontSize: 12, fontWeight: "700", textAlign: "center" },
  bpSec: { marginHorizontal: 12, marginBottom: 6, fontSize: 11, fontWeight: "700", color: c.primaryDeep, letterSpacing: 0.5 },
  bpRec: {
    marginHorizontal: 12,
    marginBottom: 12,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: c.primary,
    overflow: "hidden",
    backgroundColor: c.white,
  },
  bpRecHead: {
    backgroundColor: c.mintBg,
    paddingVertical: 8,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  bpRecHeadTxt: { fontSize: 12, fontWeight: "700", color: c.primaryDeep, flex: 1 },
  bpLowest: { backgroundColor: c.primary, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
  bpLowestTxt: { color: c.white, fontSize: 10, fontWeight: "700" },
  bpRecBody: { padding: 12 },
  bpPlanName: { fontSize: 16, fontWeight: "700", color: c.text },
  bpPlanSub: { fontSize: 12, color: c.muted, marginTop: 2, marginBottom: 10 },
  bpGrid2: { flexDirection: "row", gap: 10 },
  bpMini: { flex: 1, backgroundColor: c.pageBg, borderRadius: 8, padding: 10 },
  bpMiniLbl: { fontSize: 9, color: c.mutedLight, letterSpacing: 0.5 },
  bpMiniBig: { fontSize: 22, fontWeight: "700", color: c.primary, marginTop: 4 },
  bpMiniSub: { fontSize: 11, color: c.muted, marginTop: 2 },
  bpTable: {
    marginHorizontal: 12,
    marginBottom: 20,
    backgroundColor: c.white,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.borderLight,
    overflow: "hidden",
  },
  bpTh: {
    flexDirection: "row",
    backgroundColor: c.pageBg,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.borderLight,
    alignItems: "center",
  },
  bpTc: { fontSize: 10, color: c.muted, fontWeight: "700" },
  bpTr: { flexDirection: "row", paddingVertical: 10, paddingHorizontal: 12, alignItems: "center" },
  bpTrBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#f0f0f0" },
  bpTn: { fontSize: 13, fontWeight: "700", color: c.text },
  bpTs: { fontSize: 11, color: c.mutedLight, marginTop: 2 },
  bpTp: { fontSize: 15, fontWeight: "700", color: c.text },
  bpTsub: { fontSize: 10, color: c.mutedLight },
  agHero: { backgroundColor: c.primary, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12 },
  agRow: { flexDirection: "row", alignItems: "flex-end", gap: 14 },
  agPhoto: { width: 76, height: 76, borderRadius: 38, borderWidth: 3, borderColor: c.white },
  agHeroTxt: { flex: 1, paddingBottom: 4 },
  agName: { color: c.white, fontSize: 20, fontWeight: "700" },
  agTag: { color: "rgba(255,255,255,0.85)", fontSize: 12, marginTop: 4 },
  agSite: { color: c.mint, fontSize: 12, fontWeight: "600", marginTop: 4 },
  agQuote: {
    margin: 12,
    backgroundColor: c.white,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.borderLight,
    padding: 12,
  },
  agQuoteTxt: { fontSize: 13, color: c.text, lineHeight: 22, fontStyle: "italic" },
  agCard: {
    marginHorizontal: 12,
    marginBottom: 12,
    backgroundColor: c.white,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.borderLight,
    overflow: "hidden",
  },
  agCardHead: { paddingVertical: 8, paddingHorizontal: 12, backgroundColor: c.pageBg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.borderSoft },
  agCardHeadTxt: { fontSize: 10, fontWeight: "700", color: c.primaryDeep, letterSpacing: 0.5 },
  agLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#f0f0f0",
  },
  agLineTxt: { fontSize: 14, color: c.text },
  agBio: { fontSize: 13, color: c.text, lineHeight: 22 },
  agPull: {
    marginTop: 12,
    padding: 10,
    backgroundColor: c.mintBg,
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: c.primary,
  },
  agPullTxt: { fontSize: 13, color: c.primaryDeep, fontWeight: "600", lineHeight: 20 },
});
