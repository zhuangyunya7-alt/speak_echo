from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable, List, Sequence, Tuple


@dataclass(frozen=True)
class Op:
    operator: str
    operands: Tuple[Any, ...]


def _to_py(obj: Any) -> Any:
    """
    Convert pikepdf object-ish values to basic Python types for easier handling.
    """
    # pikepdf.Number, pikepdf.Name, etc. usually have Python conversions
    try:
        import pikepdf

        if isinstance(obj, pikepdf.Name):
            return str(obj)  # '/Im1'
    except Exception:
        pass
    return obj


def parse_ops_from_page(page: Any) -> List[Op]:
    """
    Parse PDF content stream into a list of operations.

    Uses pikepdf's internal content stream parser.
    """
    import pikepdf

    # pikepdf provides parse_content_stream(page, operators=None) in recent versions
    ops: List[Op] = []
    for operands, operator in pikepdf.parse_content_stream(page):
        ops.append(Op(str(operator), tuple(_to_py(x) for x in operands)))
    return ops


def unparse_ops_to_bytes(ops: Sequence[Op]) -> bytes:
    """
    Convert operations back to a content stream.

    We intentionally emit a simple, normalized syntax. This changes stream formatting
    but preserves rendered output (except for removed ops).
    """
    out: List[bytes] = []

    def fmt(v: Any) -> str:
        if isinstance(v, str) and v.startswith("/"):
            return v
        if isinstance(v, bool):
            return "true" if v else "false"
        if v is None:
            return "null"
        if isinstance(v, (int, float)):
            # keep compact but stable
            if isinstance(v, float) and (abs(v) < 1e-10):
                v = 0.0
            s = repr(float(v)) if isinstance(v, float) else str(v)
            # avoid scientific notation where possible
            if "e" in s or "E" in s:
                s = f"{float(v):.10f}".rstrip("0").rstrip(".")
                if s == "-0":
                    s = "0"
            return s
        return str(v)

    for op in ops:
        parts = [fmt(x) for x in op.operands] + [op.operator]
        out.append((" ".join(parts) + "\n").encode("utf-8"))
    return b"".join(out)


def iter_blocks_q_cm_do_q(ops: Sequence[Op]) -> Iterable[Tuple[int, int, Op, Op]]:
    """
    Yield blocks that look like:

        q
        a b c d e f cm
        /Name Do
        Q

    Returns tuples: (start_idx, end_idx_exclusive, cm_op, do_op)
    """
    i = 0
    n = len(ops)
    while i + 3 < n:
        if ops[i].operator == "q" and ops[i + 1].operator == "cm" and ops[i + 2].operator == "Do" and ops[i + 3].operator == "Q":
            yield (i, i + 4, ops[i + 1], ops[i + 2])
            i += 4
            continue
        i += 1

