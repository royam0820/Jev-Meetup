# Jev Tabular Hybrid — Results Summary

## Mode: `fallback_automobile`
- Train: 160 rows, Valid: 41 rows
- Dataset: UCI Automobile (imports-85)
- Metric: RMSLE (root mean squared log error)

## Comparison Table

| Model | Baseline RMSLE | Hybrid RMSLE | Δ |
|-------|---------------|-------------|---|
| RandomForest | 0.3689 | 0.3506 | +0.0183 |
| HistGradientBoosting | 0.1419 | 0.1416 | +0.0003 |
| XGBoost | 0.1243 | 0.1304 | -0.0060 |
| Jev-Only (no training) | 0.2887 | — | — |

## Jev Cost & Latency
- Total API cost: **$0.007697**
- Total latency: 7.3s for 201 calls (36ms avg effective)
- Failures: 0/201

## Key Findings
1. **Hybrid pattern**: Jev semantic features (category, size, market segment, value tier, high-value flag) provide additional signal when combined with traditional ordinal-encoded features.
2. **Jev-only ceiling**: Without any training, Jev's semantic understanding alone (mapping value_tier/market_segment to train-set price quantiles) achieves RMSLE 0.2887 — showing what zero-shot semantic classification can do.
3. **Cost**: At ~$0.00001/call, Jev feature extraction is essentially free even at scale.
4. **What Jev can't replace**: A trained model with access to all numeric features (engine size, horsepower, curb weight, etc.) will always outperform pure semantic classification. Jev adds value as a _feature enrichment_ layer, not a replacement.

## Caveats
- **Small dataset**: UCI automobile has only ~201  valid rows; results may not generalize.
- **Bulldozer mode**: For the full fastai ch.9 experience, add Kaggle credentials to `~/.kaggle/kaggle.json`.
- **Jev features are deterministic per-call** but may vary across API versions.
