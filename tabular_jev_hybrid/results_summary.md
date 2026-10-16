# Jev × Tabular — Real Results on Blue Book for Bulldozers

- **Mode:** `bulldozer` — `TrainAndValid.csv` (412,698 rows, 53 cols)
- **Metric:** RMSLE (lower = better)
- **Method:** ordinal-encoded baseline vs the same model + **Jev** typed features
  (`value_tier` score, `market_segment` / `size_class` / `category` choice, `is_high_value` noul)

## Run A — 1,500 rows (1,200 train / 300 valid)
| Model | Baseline | + Jev | Δ |
|---|---|---|---|
| RandomForest | 0.6237 | 0.4458 | +0.1779 |
| HistGradientBoosting | 0.5394 | 0.3726 | +0.1669 |
| XGBoost | 0.5155 | 0.3835 | +0.1320 |
| Jev-only (no training) | 0.6282 | — | — |

Cost **$0.0790** · 1,500 calls · 54 s · 0 failures

## Run B — 6,000 rows (4,800 train / 1,200 valid)
| Model | Baseline | + Jev | Δ |
|---|---|---|---|
| RandomForest | 0.5000 | 0.3842 | +0.1158 |
| HistGradientBoosting | 0.4389 | 0.3334 | +0.1055 |
| XGBoost | 0.4472 | 0.3425 | +0.1046 |
| Jev-only (no training) | 0.6271 | — | — |

Cost **$0.3158** · 6,000 calls · 211 s · 0 failures

## What it means
- Jev's typed semantic features cut **RMSLE by ~24–27% relative** on both samples — a large, consistent gain across RF / HGB / XGB.
- The gain shrinks as training data grows (≈ +0.17 → ≈ +0.11): with few labels Jev's priors carry real signal; with many, the model learns it itself. That's exactly Jev's "smart if-statement / feature-enrichment" sweet spot.
- Zero-shot sanity: Jev's `value_tier` → price map alone (no training) already reaches RMSLE ≈ 0.63.

## Caveats
- Sampled runs (capped at `JEV_ROW_CAP` so every modelled row gets a Jev answer); full-data baselines are stronger than shown.
- Text columns are ordinal-encoded; stronger encodings (target/entity embeddings) would lift the baseline and narrow the gap.
- Jev probabilities vary slightly run-to-run.
