from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Tuple


def mm_to_pt(mm: float) -> float:
    return mm * 72.0 / 25.4


@dataclass(frozen=True)
class BBox:
    x0: float
    y0: float
    x1: float
    y1: float

    @property
    def w(self) -> float:
        return max(0.0, self.x1 - self.x0)

    @property
    def h(self) -> float:
        return max(0.0, self.y1 - self.y0)

    def intersects(self, other: "BBox") -> bool:
        return not (
            self.x1 <= other.x0
            or self.x0 >= other.x1
            or self.y1 <= other.y0
            or self.y0 >= other.y1
        )

    def contains(self, other: "BBox") -> bool:
        return (
            self.x0 <= other.x0
            and self.y0 <= other.y0
            and self.x1 >= other.x1
            and self.y1 >= other.y1
        )


def bbox_from_points(points: Iterable[Tuple[float, float]]) -> BBox:
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return BBox(min(xs), min(ys), max(xs), max(ys))


def apply_matrix_to_point(
    a: float, b: float, c: float, d: float, e: float, f: float, x: float, y: float
) -> Tuple[float, float]:
    # PDF: [a b c d e f] transforms (x,y) -> (a*x + c*y + e, b*x + d*y + f)
    return (a * x + c * y + e, b * x + d * y + f)


def transform_bbox(
    a: float, b: float, c: float, d: float, e: float, f: float, bbox: BBox
) -> BBox:
    pts = [
        apply_matrix_to_point(a, b, c, d, e, f, bbox.x0, bbox.y0),
        apply_matrix_to_point(a, b, c, d, e, f, bbox.x1, bbox.y0),
        apply_matrix_to_point(a, b, c, d, e, f, bbox.x0, bbox.y1),
        apply_matrix_to_point(a, b, c, d, e, f, bbox.x1, bbox.y1),
    ]
    return bbox_from_points(pts)

