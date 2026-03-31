"""
Flatten FHIR-style labeled JSON blocks (Patient / Coverage / Encounter / EOB + JSON)
into tabular Excel/CSV.

Default: read from elevance.xlsx (columns include ID Token Claims + Raw JSON).

Optional: --json [FILE]  — parse labeled blocks from a text file, or stdin if FILE is - or omitted.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from typing import Any

import pandas as pd

DEFAULT_EXCEL = "elevance.xlsx"
DEFAULT_OUT = "Parsed_Elevance_Data"


def flatten_json(y: Any) -> dict[str, Any]:
    out: dict[str, Any] = {}

    def flatten(x: Any, name: str = "") -> None:
        if isinstance(x, dict):
            for a in x:
                flatten(x[a], name + a + "_")
        elif isinstance(x, list):
            for i, a in enumerate(x):
                flatten(a, name + str(i) + "_")
        else:
            out[name[:-1]] = x

    flatten(y)
    return out


def parse_labeled_blocks(raw_str: str) -> dict[str, Any]:
    """
    Parse text like::

        Patient
        { ... }
        Coverage
        { ... }

    Returns a flat dict with keys Raw_{Label}_{flattened_path}.
    """
    base_info: dict[str, Any] = {}
    raw_str = str(raw_str)
    if not raw_str.strip():
        return base_info

    # Label line (word) followed by JSON object starting with {
    parts = re.split(r"(?m)^([A-Za-z][A-Za-z0-9]*)\s*\n(?=\{)", raw_str)

    for i in range(1, len(parts) - 1, 2):
        resource_type = parts[i]
        json_str = parts[i + 1]

        if "truncated" in json_str:
            print(
                f"⚠️ Warning: '{resource_type}' block was marked truncated in source. Skipping block.",
                file=sys.stderr,
            )
            continue

        try:
            last_brace = json_str.rfind("}")
            if last_brace == -1:
                print(f"❌ Error: No closing '}}' for block '{resource_type}'", file=sys.stderr)
                continue
            clean_json = json_str[: last_brace + 1]
            data = json.loads(clean_json, strict=False)
            flat_data = {f"Raw_{resource_type}_{k}": v for k, v in flatten_json(data).items()}
            base_info.update(flat_data)
        except Exception as e:
            print(f"❌ Error: Malformed block '{resource_type}': {e}", file=sys.stderr)

    return base_info


def read_json_input(path: str | None) -> str:
    if path is None or path == "-":
        return sys.stdin.read()
    with open(path, encoding="utf-8") as f:
        return f.read()


def run_from_excel(file_path: str, out_stem: str) -> None:
    df = pd.read_excel(file_path)
    parsed_data: list[dict[str, Any]] = []

    for idx, row in df.iterrows():
        base_info = {k: row[k] for k in df.columns if k not in ["ID Token Claims", "Raw JSON"]}

        if pd.notnull(row.get("ID Token Claims")):
            try:
                id_claims = json.loads(row["ID Token Claims"], strict=False)
                flat_claims = {f"ID Token_{k}": v for k, v in flatten_json(id_claims).items()}
                base_info.update(flat_claims)
            except Exception as e:
                print(f"Row {idx + 2} ID Token Parsing Error: {e}", file=sys.stderr)

        raw_str = str(row.get("Raw JSON", ""))
        if pd.notnull(raw_str) and raw_str != "nan":
            base_info.update(parse_labeled_blocks(raw_str))

        parsed_data.append(base_info)

    final_df = pd.DataFrame(parsed_data)
    _write_outputs(final_df, out_stem)


def run_from_json_text(text: str, out_stem: str) -> None:
    base_info = parse_labeled_blocks(text)
    final_df = pd.DataFrame([base_info])
    _write_outputs(final_df, out_stem)


def _write_outputs(final_df: pd.DataFrame, out_stem: str) -> None:
    xlsx_path = f"{out_stem}.xlsx"
    csv_path = f"{out_stem}.csv"
    final_df.to_excel(xlsx_path, index=False)
    final_df.to_csv(csv_path, index=False)
    print(
        f"\n✅ Data parsed successfully! Wrote {xlsx_path} and {csv_path} "
        f"({final_df.shape[0]} rows × {final_df.shape[1]} columns)."
    )


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Parse Elevance-style FHIR JSON blocks into flat Excel/CSV.",
    )
    parser.add_argument(
        "--json",
        "-j",
        nargs="?",
        const="-",
        metavar="FILE",
        help=(
            "Read labeled blocks (Patient/Coverage/Encounter/EOB + JSON) from FILE. "
            "Use - or omit the path to read from stdin. "
            "When set, elevance.xlsx is not used."
        ),
    )
    parser.add_argument(
        "--excel",
        "-e",
        default=DEFAULT_EXCEL,
        metavar="FILE",
        help=f"Input Excel when --json is not used (default: {DEFAULT_EXCEL}).",
    )
    parser.add_argument(
        "-o",
        "--output",
        default=DEFAULT_OUT,
        metavar="STEM",
        help=f"Output file prefix without extension (default: {DEFAULT_OUT}).",
    )
    args = parser.parse_args()

    if args.json is not None:
        text = read_json_input(args.json if args.json != "-" else None)
        if not text.strip():
            print("No input text. Paste labeled JSON into stdin or pass a file path.", file=sys.stderr)
            return 2
        run_from_json_text(text, args.output)
        return 0

    run_from_excel(args.excel, args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
