from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Sequence, Tuple

import pikepdf
from pikepdf import Name

from .content_ops import Op, iter_blocks_q_cm_do_q, parse_ops_from_page, unparse_ops_to_bytes
from .geometry import BBox, mm_to_pt, transform_bbox


@dataclass(frozen=True)
class RemoveConfig:
    margin_x_mm: float = 60.0
    margin_y_mm: float = 60.0


@dataclass(frozen=True)
class Hit:
    page_index: int  # 0-based
    xobject_name: str
    bbox_on_page: Optional[BBox]
    reason: str


def _page_bbox(page: Any) -> BBox:
    # Use CropBox if present, else MediaBox
    box = page.get(Name.CropBox, None) or page.get(Name.MediaBox)
    x0, y0, x1, y1 = (float(box[0]), float(box[1]), float(box[2]), float(box[3]))
    return BBox(x0, y0, x1, y1)


def _corner_region(page_box: BBox, cfg: RemoveConfig) -> BBox:
    mx = mm_to_pt(cfg.margin_x_mm)
    my = mm_to_pt(cfg.margin_y_mm)
    return BBox(page_box.x1 - mx, page_box.y0, page_box.x1, page_box.y0 + my)


def _xobject_bbox(xobj: Any) -> Optional[BBox]:
    # Image XObjects usually have Width/Height; Form XObjects usually have BBox.
    subtype = xobj.get("/Subtype", None)
    if str(subtype) == "/Image":
        # In content streams, images are typically painted in a unit square (0..1),
        # then scaled/positioned by the current transformation matrix (cm).
        return BBox(0.0, 0.0, 1.0, 1.0)
    if "/BBox" in xobj:
        b = xobj["/BBox"]
        return BBox(float(b[0]), float(b[1]), float(b[2]), float(b[3]))
    w = xobj.get("/Width", None)
    h = xobj.get("/Height", None)
    if w is not None and h is not None:
        return BBox(0.0, 0.0, float(w), float(h))
    return None


def find_corner_xobject_hits(
    pdf: pikepdf.Pdf, cfg: RemoveConfig
) -> List[Hit]:
    hits: List[Hit] = []
    for pi, page in enumerate(pdf.pages):
        page_box = _page_bbox(page)
        region = _corner_region(page_box, cfg)
        eps = 1.0  # pt tolerance for float rounding
        try:
            ops = parse_ops_from_page(page)
        except Exception as e:
            hits.append(
                Hit(
                    page_index=pi,
                    xobject_name="",
                    bbox_on_page=None,
                    reason=f"parse_failed: {type(e).__name__}: {e}",
                )
            )
            continue

        res = page.get("/Resources", None) or {}
        xobjs = res.get("/XObject", {}) if isinstance(res, dict) else res.get(Name.XObject, {})

        for start, end, cm_op, do_op in iter_blocks_q_cm_do_q(ops):
            if len(cm_op.operands) != 6:
                continue
            # do operands: [/Name]
            if not do_op.operands:
                continue
            xname = do_op.operands[0]
            if not isinstance(xname, str) or not xname.startswith("/"):
                continue
            if xname not in xobjs:
                continue
            xb = _xobject_bbox(xobjs[xname])
            if xb is None:
                continue
            a, b, c, d, e, f = [float(x) for x in cm_op.operands]
            placed = transform_bbox(a, b, c, d, e, f, xb)
            # We must avoid matching full-page background images that intersect the corner.
            # Heuristic: either fully within the corner region, or a "small" object whose
            # center is in the lower-right quadrant and intersects the corner region.
            within = (
                placed.x0 >= region.x0 - eps
                and placed.y0 >= region.y0 - eps
                and placed.x1 <= region.x1 + eps
                and placed.y1 <= region.y1 + eps
            )
            intersects = region.intersects(placed)
            area = placed.w * placed.h
            page_area = page_box.w * page_box.h
            cx = (placed.x0 + placed.x1) / 2.0
            cy = (placed.y0 + placed.y1) / 2.0
            small = area <= page_area * 0.25 and placed.w <= page_box.w * 0.8 and placed.h <= page_box.h * 0.8
            lower_rightish = cx >= page_box.x0 + page_box.w * 0.55 and cy <= page_box.y0 + page_box.h * 0.45
            if within or (intersects and small and lower_rightish):
                hits.append(
                    Hit(
                        page_index=pi,
                        xobject_name=xname,
                        bbox_on_page=placed,
                        reason="q cm Do Q block matches corner heuristic",
                    )
                )
    return hits


def remove_corner_marks_inplace(
    pdf: pikepdf.Pdf,
    cfg: RemoveConfig,
    *,
    dry_run: bool = False,
) -> Tuple[List[Hit], int]:
    hits = find_corner_xobject_hits(pdf, cfg)
    removed_ops = 0
    if dry_run:
        return hits, removed_ops

    hits_by_page: Dict[int, List[str]] = {}
    for h in hits:
        if h.xobject_name:
            hits_by_page.setdefault(h.page_index, []).append(h.xobject_name)

    for pi, page in enumerate(pdf.pages):
        target_names = set(hits_by_page.get(pi, []))
        if not target_names:
            continue
        ops = parse_ops_from_page(page)
        new_ops: List[Op] = []
        i = 0
        while i < len(ops):
            # If this is a matching q cm Do Q block, drop it.
            if i + 3 < len(ops) and ops[i].operator == "q" and ops[i + 1].operator == "cm" and ops[i + 2].operator == "Do" and ops[i + 3].operator == "Q":
                do_op = ops[i + 2]
                if do_op.operands and isinstance(do_op.operands[0], str) and do_op.operands[0] in target_names:
                    removed_ops += 4
                    i += 4
                    continue
            new_ops.append(ops[i])
            i += 1

        # Rewrite page contents as a single stream (normalized).
        new_bytes = unparse_ops_to_bytes(new_ops)
        page["/Contents"] = pdf.make_stream(new_bytes)

        # Optionally remove dead XObject entries from the page resource dict.
        try:
            res = page["/Resources"]
            if "/XObject" in res:
                xobj = res["/XObject"]
                for name in list(target_names):
                    if name in xobj:
                        del xobj[name]
        except Exception:
            pass

    return hits, removed_ops

