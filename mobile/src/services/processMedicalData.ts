import { LlamaService } from "./LlamaService";
import { LocalVectorStore } from "./LocalVectorStore";

type AnyObj = Record<string, any>;


/** Safe extraction for sparse FHIR bundles (e.g. Cigna sandbox) — used only for RAG text context. */
export function summarizeSparseFhirBundleForRag(bundle: AnyObj): string {
  const rt = bundle?.resourceType;
  if (rt !== "Bundle") {
    return extractTextish(bundle, 8_000);
  }
  const entries = bundle?.entry;
  if (!Array.isArray(entries)) return "";
  const parts: string[] = [];
  for (const ent of entries.slice(0, 80)) {
    const res = ent?.resource as AnyObj | undefined;
    const rtype = res?.resourceType;
    if (!rtype) continue;
    if (rtype === "ExplanationOfBenefit") {
      const id = res?.id ?? "?";
      const st = res?.status ?? "?";
      const type = res?.type?.coding?.[0]?.display ?? res?.type?.coding?.[0]?.code ?? "";
      const sub = res?.subType?.coding?.[0]?.display ?? "";
      parts.push(`EOB ${id} status=${st} type=${type || "—"} subType=${sub || "—"}`);
      const items = res?.item;
      if (Array.isArray(items)) {
        for (const it of items.slice(0, 20)) {
          const rev = it?.adjudication?.map((a: any) => a?.amount?.value).filter((x: any) => x != null) ?? [];
          parts.push(`  item ${it?.sequence ?? "?"} adjudication amounts: ${rev.join(", ") || "—"}`);
        }
      }
    } else if (rtype === "Coverage") {
      parts.push(
        `Coverage ${res?.id ?? "?"} status=${res?.status ?? "?"} type=${res?.type?.coding?.[0]?.code ?? "—"}`
      );
    } else if (rtype === "Encounter") {
      parts.push(
        `Encounter ${res?.id ?? "?"} status=${res?.status ?? "?"} class=${res?.class?.code ?? "—"} period=${res?.period?.start ?? "—"}`
      );
    } else if (rtype === "MedicationRequest") {
      const med =
        res?.medicationCodeableConcept?.text ??
        res?.medicationCodeableConcept?.coding?.[0]?.display ??
        res?.medicationReference?.display ??
        res?.medicationReference?.reference ??
        "";
      parts.push(
        `MedicationRequest ${res?.id ?? "?"} status=${res?.status ?? "?"} intent=${res?.intent ?? "?"} med=${med || "—"} authored=${res?.authoredOn ?? "—"}`
      );
    } else if (rtype === "MedicationStatement") {
      const med =
        res?.medicationCodeableConcept?.text ??
        res?.medicationCodeableConcept?.coding?.[0]?.display ??
        res?.medicationReference?.display ??
        "";
      parts.push(
        `MedicationStatement ${res?.id ?? "?"} status=${res?.status ?? "?"} med=${med || "—"}`
      );
    } else if (rtype === "MedicationDispense") {
      const med =
        res?.medicationCodeableConcept?.text ??
        res?.medicationCodeableConcept?.coding?.[0]?.display ??
        res?.medicationReference?.display ??
        "";
      parts.push(
        `MedicationDispense ${res?.id ?? "?"} status=${res?.status ?? "?"} med=${med || "—"} when=${res?.whenHandedOver ?? res?.whenPrepared ?? "—"}`
      );
    }
  }
  return parts.join("\n").slice(0, 12_000);
}

function stableId(prefix: string): string {
  // Not cryptographic; just stable-enough for a POC chunk key.
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function extractTextish(obj: any, maxChars: number): string {
  const parts: string[] = [];
  const seen = new Set<any>();

  const push = (s: string) => {
    const t = s.trim();
    if (!t) return;
    parts.push(t);
  };

  const walk = (v: any, depth: number) => {
    if (parts.join("\n").length >= maxChars) return;
    if (v == null) return;
    if (typeof v === "string") return push(v);
    if (typeof v === "number" || typeof v === "boolean") return push(String(v));
    if (depth > 6) return;
    if (typeof v !== "object") return;
    if (seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) {
      for (const it of v) walk(it, depth + 1);
      return;
    }
    for (const k of Object.keys(v)) {
      // skip huge or irrelevant fields commonly found in FHIR
      if (k === "contained" || k === "extension" || k === "modifierExtension") continue;
      walk(v[k], depth + 1);
    }
  };

  walk(obj, 0);
  return parts.join("\n").slice(0, maxChars);
}

function chunkText(text: string, opts: { chunkChars: number; overlapChars: number }): string[] {
  const { chunkChars, overlapChars } = opts;
  const t = text.trim();
  if (!t) return [];
  const chunks: string[] = [];
  let i = 0;
  while (i < t.length) {
    const end = Math.min(t.length, i + chunkChars);
    chunks.push(t.slice(i, end));
    if (end >= t.length) break;
    i = Math.max(0, end - overlapChars);
  }
  return chunks;
}

/**
 * process_medical_data(fhir_json)
 *
 * POC scaffold:
 * - chunk raw FHIR JSON into text
 * - embed each chunk locally via llama.cpp embeddings (through LlamaService.embed)
 * - store embeddings + text in LocalVectorStore (SQLite)
 */
export async function process_medical_data(fhir_json: AnyObj): Promise<{
  chunksStored: number;
}> {
  await LocalVectorStore.init();

  const rt = fhir_json?.resourceType;
  const baseText =
    rt === "Bundle"
      ? `${summarizeSparseFhirBundleForRag(fhir_json)}\n\n${extractTextish(fhir_json, 45_000)}`.slice(0, 50_000)
      : extractTextish(fhir_json, 50_000);
  const chunks = chunkText(baseText, { chunkChars: 900, overlapChars: 120 });

  let stored = 0;
  for (const chunk of chunks) {
    const embedding = await LlamaService.embed(chunk);
    const id = stableId("chunk");
    await LocalVectorStore.upsertChunk({
      id,
      text: chunk,
      embedding,
      meta: {
        source: "fhir",
        resourceType: fhir_json?.resourceType ?? null,
      },
    });
    stored++;
  }

  return { chunksStored: stored };
}

