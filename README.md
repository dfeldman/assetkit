# assetkit

Shared static assets for many games: trees, plants, rocks, statues and their textures. The files live in the
`assets` R2 bucket; this repo holds their indexes (`indexes/asset-index-*.json`) and the scripts that
produced them. Everything is managed with [assetmgr](../assetmgr).

| Index | What | Assets |
|---|---|---|
| `assetkit-trees` | Trail Trainer's tree library: deciduous and conifer, 3 LODs per file | 680 |
| `assetkit-plants` | Trail Trainer's shrubs, flowers, grasses, cacti | 550 |
| `assetkit-rocks` | Trail Trainer's boulders, slabs, rock fields | 216 |
| `assetkit-nature-textures` | Bark, leaf, rock and painted textures the three above reference | 106 |
| `assetkit-statues-paris` | Tripo statues of Paris monuments (Tripo original + game repack) | 13 |
| `assetkit-statues-sf` | Tripo statues of San Francisco monuments | 1 |

## Getting the files

```bash
npm install
npx assetmgr download                    # everything (≈ 420 MB)
npx assetmgr download --only assetkit-trees,assetkit-nature-textures
```

To use these in another repo, list the indexes under `imports` in that repo's `assetmgr.config.json`. Trees,
plants and rocks reference their textures by relative URI (`requires` in the index), so import
`assetkit-nature-textures` along with them. All of them sit in one `nature/` folder.

Credentials, for uploading only, come from the environment, a `.env` here, or `ASSETMGR_ENV_FILE`.

## How the imports were made

- `tools/import-trailtrainer.ts`: Trail Trainer's `public/{trees,plants,rocks}`. Each texture became its own
  asset, and each GLB's image URIs were rewritten to the textures' assetmgr names. Species are mapped from
  Trail Trainer's common names to Latin (genus only where the generator models no particular species).
  `generator.hash` hashes the generator code at import time.
- `tools/import-statues.ts`: Street Runner's `incoming_models/` (Tripo originals, `isSource`) and its packed
  `public/models/paris/` (`isProd`), plus the Admission Day Monument from `statues_to_model/`.

Both scripts can be re-run safely; they skip assets that are already present.

## Licensing

Textures derived from Poly Haven are CC0 and marked so. The generated models, the painted textures and the
Tripo statues don't have a license recorded yet: `assetmgr validate` lists them.
