"""
Flatten FHIR-style labeled JSON blocks (Patient / Coverage / Encounter / EOB + JSON)
into tabular Excel/CSV.

Default: read from elevance.xlsx (columns include ID Token Claims + Raw JSON).

Optional: --json [FILE]  — parse labeled blocks from a text file, or stdin if FILE is - or omitted.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from typing import Any

import pandas as pd

DEFAULT_EXCEL = "elevance.xlsx"
DEFAULT_OUT = "Parsed_Elevance_Data"

# Excel worksheet limits (xlsx). If we exceed these, we must split across sheets/files.
_EXCEL_MAX_ROWS = 1_048_576
_EXCEL_MAX_COLS = 16_384


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

    # Always write CSV (no practical sheet-size limits).
    final_df.to_csv(csv_path, index=False)

    # Write Excel, splitting across sheets when the DataFrame is too large.
    n_rows, n_cols = final_df.shape
    if n_rows <= _EXCEL_MAX_ROWS and n_cols <= _EXCEL_MAX_COLS:
        final_df.to_excel(xlsx_path, index=False)
        excel_note = "1 sheet"
    else:
        # Split by both rows and columns to satisfy Excel's hard worksheet limits.
        row_splits = max(1, math.ceil(n_rows / _EXCEL_MAX_ROWS))
        col_splits = max(1, math.ceil(n_cols / _EXCEL_MAX_COLS))

        def _sheet_name(r_i: int, c_i: int) -> str:
            # Excel sheet names must be <= 31 chars. Keep it deterministic and short.
            if row_splits == 1 and col_splits > 1:
                name = f"data_c{c_i + 1}"
            elif col_splits == 1 and row_splits > 1:
                name = f"data_r{r_i + 1}"
            else:
                name = f"data_r{r_i + 1}_c{c_i + 1}"
            return name[:31]

        # Prefer xlsxwriter (fast, reliable). Fall back to openpyxl if needed.
        engine: str | None
        try:
            __import__("xlsxwriter")
            engine = "xlsxwriter"
        except Exception:
            try:
                __import__("openpyxl")
                engine = "openpyxl"
            except Exception:
                engine = None

        with pd.ExcelWriter(xlsx_path, engine=engine) as writer:
            sheet_count = 0
            for r_i in range(row_splits):
                r_start = r_i * _EXCEL_MAX_ROWS
                r_end = min((r_i + 1) * _EXCEL_MAX_ROWS, n_rows)
                df_r = final_df.iloc[r_start:r_end, :]

                for c_i in range(col_splits):
                    c_start = c_i * _EXCEL_MAX_COLS
                    c_end = min((c_i + 1) * _EXCEL_MAX_COLS, n_cols)
                    df_chunk = df_r.iloc[:, c_start:c_end]
                    df_chunk.to_excel(writer, sheet_name=_sheet_name(r_i, c_i), index=False)
                    sheet_count += 1

        excel_note = f"{sheet_count} sheets ({row_splits} row-split × {col_splits} col-split)"

    print(
        f"\n✅ Data parsed successfully! Wrote {xlsx_path} and {csv_path} "
        f"({final_df.shape[0]} rows × {final_df.shape[1]} columns; Excel: {excel_note})."
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
