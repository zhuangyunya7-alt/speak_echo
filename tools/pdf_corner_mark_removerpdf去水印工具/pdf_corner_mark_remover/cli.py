from __future__ import annotations

import argparse
from dataclasses import asdict
from pathlib import Path
from typing import Sequence

import pikepdf

from .remover import RemoveConfig, remove_corner_marks_inplace


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="pdf_corner_mark_remover")
    sub = p.add_subparsers(dest="cmd", required=True)

    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--in", dest="in_path", required=True, help="Input PDF path")
    common.add_argument("--margin-x-mm", type=float, default=60.0)
    common.add_argument("--margin-y-mm", type=float, default=60.0)

    probe = sub.add_parser("probe", parents=[common], help="Probe PDF structure")
    probe.add_argument("--max-pages", type=int, default=0, help="Limit pages (0 = all)")

    rm = sub.add_parser("remove", parents=[common], help="Remove corner mark")
    rm.add_argument("--out", dest="out_path", required=False, help="Output PDF path")
    rm.add_argument("--dry-run", action="store_true", help="Do not write output")
    rm.add_argument(
        "--inplace",
        action="store_true",
        help="Overwrite input file (dangerous). Prefer --out.",
    )

    return p


def _cmd_probe(args: argparse.Namespace) -> int:
    in_path = Path(args.in_path)
    pdf = pikepdf.Pdf.open(str(in_path))
    pages = list(pdf.pages)
    if args.max_pages and args.max_pages > 0:
        pages = pages[: args.max_pages]

    print(f"pages: {len(pdf.pages)}")
    annots_pages = 0
    annots_total = 0
    do_hits = 0
    xobj_pages = 0

    for page in pages:
        annots = page.get("/Annots", None)
        if annots:
            annots_pages += 1
            annots_total += len(annots)

        res = page.get("/Resources", None) or {}
        xobj = res.get("/XObject", {}) if isinstance(res, dict) else res.get("/XObject", {})
        if xobj:
            xobj_pages += 1

        contents = page.get("/Contents", None)
        if contents is None:
            continue
        streams = []
        if isinstance(contents, pikepdf.Stream):
            streams = [contents]
        elif isinstance(contents, pikepdf.Array):
            streams = [s for s in contents if isinstance(s, pikepdf.Stream)]
        for s in streams:
            b = s.read_bytes()
            do_hits += b.count(b" Do") + b.count(b"\nDo")

    print(f"annots_pages: {annots_pages}, annots_total: {annots_total}")
    print(f"xobject_pages: {xobj_pages}")
    print(f"approx_Do_operator_hits: {do_hits}")
    return 0


def _cmd_remove(args: argparse.Namespace) -> int:
    in_path = Path(args.in_path)
    if args.inplace and args.out_path:
        raise SystemExit("Use either --inplace OR --out, not both.")

    out_path = None
    if args.inplace:
        out_path = in_path
    else:
        if not args.out_path:
            raise SystemExit("--out is required unless --inplace is set.")
        out_path = Path(args.out_path)

    cfg = RemoveConfig(margin_x_mm=args.margin_x_mm, margin_y_mm=args.margin_y_mm)
    pdf = pikepdf.Pdf.open(str(in_path))

    # Find/remove in-place, then write out.
    hits, removed_ops = remove_corner_marks_inplace(pdf, cfg, dry_run=args.dry_run)

    # Pretty print hits
    by_name = {}
    for h in hits:
        if not h.xobject_name:
            continue
        by_name[h.xobject_name] = by_name.get(h.xobject_name, 0) + 1
    print("config:", asdict(cfg))
    if by_name:
        print("hits:", ", ".join([f"{k}x{v}" for k, v in sorted(by_name.items())]))
    else:
        print("hits: (none)")
    print(f"removed_ops: {removed_ops}")

    if args.dry_run:
        print("dry-run: not writing output")
        return 0

    out_path.parent.mkdir(parents=True, exist_ok=True)
    pdf.save(str(out_path))
    print(f"written: {out_path}")
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    p = _build_parser()
    args = p.parse_args(argv)
    if args.cmd == "probe":
        return _cmd_probe(args)
    if args.cmd == "remove":
        return _cmd_remove(args)
    raise SystemExit(f"Unknown command: {args.cmd}")

