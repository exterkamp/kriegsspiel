| Model | Schema | All checks | All but ammo | Failing checks (cases) | Median s | p95 s | plausibility | faithfulness | consistency | fog | prose | Rubric mean | Disk GB | RAM GB |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| claude-code-opus | 12/12 | 7/12 | 12/12 | ammo 5 | 28.9 | 52.1 | 5 | 5 | 4.9 | 5 | 5 | 5 | - | - |
| claude-code-sonnet | 12/12 | 7/12 | 11/12 | ammo 5, departure 1 | 30.7 | 54.4 | 4.6 | 4.9 | 4.8 | 4.9 | 5 | 4.8 | - | - |
| gemma4:e4b | 6/6 | 0/6 | 0/6 | ids 1, limits 1, observations 5, departure 1, injection 1 | 1946.9 | 2623.9 | 1.7 | 1.5 | 2 | 1.8 | 2.2 | 1.8 | 6.6 | 7.6 |
| llama3.1:8b | 5/5 | 0/5 | 0/5 | ids 2, observations 5, departure 1 | 1424.8 | 1601.9 | 2.2 | 2.4 | 2.4 | 2.4 | 1.4 | 2.2 | 4.9 | - |
| qwen2.5:7b | 6/6 | 0/6 | 0/6 | ids 6, observations 6 | 798.8 | 1469.6 | 2.5 | 2.2 | 3.2 | 2 | 2 | 2.4 | 4.7 | 5.7 |
| test | 12/12 | 12/12 | 12/12 | none | 0 | 0 | 2.7 | 2.2 | 3.8 | 3.1 | 1 | 2.6 | - | - |
