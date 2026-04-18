"""Tests for benchmarking_service.compute_peer_comparison."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from services.benchmarking_service import compute_peer_comparison


def _make_benchmarks(scores: list[float]) -> list[dict]:
    return [
        {
            "overall_score":       s,
            "radar_scores":        {"Communication": s, "Technical Accuracy": s},
            "grade":               "A" if s >= 80 else "B",
            "hire_recommendation": "yes" if s >= 70 else "no",
        }
        for s in scores
    ]


def test_empty_benchmarks_returns_null_percentile():
    result = compute_peer_comparison(75.0, {"Communication": 75}, [])
    assert result["sample_size"] == 0
    assert result["overall_percentile"] is None
    assert "not enough" in result["insight"].lower()


def test_top_performer():
    bm = _make_benchmarks([50, 60, 70, 80])
    result = compute_peer_comparison(90.0, {"Communication": 90}, bm)
    assert result["overall_percentile"] == 100.0
    assert result["avg_peer_score"] == 65.0
    assert "75" in result["insight"] or "100" in result["insight"]


def test_below_median():
    bm = _make_benchmarks([70, 80, 90, 95])
    result = compute_peer_comparison(50.0, {"Communication": 50}, bm)
    assert result["overall_percentile"] == 0.0
    assert "bottom" in result["insight"].lower() or "quartile" in result["insight"].lower()


def test_radar_comparison_shape():
    bm = _make_benchmarks([60, 70, 80])
    radar = {"Communication": 75, "Technical Accuracy": 65}
    result = compute_peer_comparison(72.0, radar, bm)
    axes = {r["axis"] for r in result["radar_comparison"]}
    assert "Communication" in axes
    assert "Technical Accuracy" in axes
    for r in result["radar_comparison"]:
        assert "delta" in r
        assert "percentile" in r


def test_hire_rate():
    bm = _make_benchmarks([80, 80, 50, 50])  # 2 yes, 2 no
    result = compute_peer_comparison(75.0, {}, bm)
    assert result["hire_rate"] == 50.0


def test_grade_distribution_sums_to_100():
    bm = _make_benchmarks([60, 70, 80, 90])
    result = compute_peer_comparison(75.0, {}, bm)
    total = sum(result["grade_distribution"].values())
    assert abs(total - 100.0) < 0.2
