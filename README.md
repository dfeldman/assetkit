# assetkit

Shared static assets for many projects (games and otherwise), and the generators that make them: trees, plants,
rocks, statues and their textures, plus carkit, the procedural vehicle library. Nothing here depends on
Dandyhorse.

- **The files** live in the shared asset bucket, managed with [assetmgr](https://github.com/dfeldman/assetmgr).
  This repo holds their indexes (`indexes/asset-index-*.json`), which say what each asset is, where it came from
  and its license.
- **The generators** (`tools/`) build the libraries with Blender, headless, from Poly Haven's CC0 textures.
- **carkit** (`carkit/`) builds low-poly cars, vans, trucks and buses at run time; see `carkit/README.md`.

| Index | What | Assets |
|---|---|---|
| `assetkit-trees` | deciduous trees and conifers, 3 LODs per file | 680 |
| `assetkit-plants` | shrubs, flowers, grasses, cacti | 550 |
| `assetkit-rocks` | boulders, slabs, rock fields | 216 |
| `assetkit-nature-textures` | the textures the trees, plants and rocks reference (beside them in the bucket) | 106 |
| `assetkit-texture-sources` | the generators' sources: Poly Haven downloads and the pages built from them | 165 |
| `assetkit-statues-paris` | Tripo statues of Paris monuments (Tripo original + game repack) | 13 |
| `assetkit-statues-sf` | Tripo statues of San Francisco monuments | 1 |

## Setting up a checkout

Check out [assetmgr](https://github.com/dfeldman/assetmgr) beside this repo (npm links it as a `file:` dependency),
then:

```bash
npm install                 # links ../assetmgr
npm run assets              # assetmgr restore: the texture sources back into tools/cache/ (public, no key)
cd carkit && npm install && npm test
```

Projects that use the assets read them from the bucket by URL, or list these indexes under `imports` in their
own `assetmgr.config.json` and run `npx assetmgr download`. Trees, plants and rocks reference their textures by
relative path (`requires` in the index), so import `assetkit-nature-textures` with them.

## Generating

Needs Blender (4.4 tested) on the PATH and Python 3. Each generator writes its library to `public/<library>/`
(gitignored); `npx assetmgr restore` puts back the sources the `*:textures` scripts would otherwise fetch.

```bash
npm run trees -- --library                        # public/trees: deciduous (tools/deciduousgen)
npm run conifers -- --library                     # public/trees: conifers (tools/conifergen)
npm run rocks -- --library                        # public/rocks (tools/rockgen)
npm run plants -- --library && npm run bushes -- --library   # public/plants
npm run trees -- --species oak --seed 3 --out /tmp/try        # one tree, somewhere else
npm run trees:textures                            # re-fetch Poly Haven sources (not needed after restore)
```

Then record and upload what changed:

```bash
npm run import:nature       # public/ → assetkit-trees / -plants / -rocks / -nature-textures
npm run import:sources      # tools/cache/ → assetkit-texture-sources
npm run import:statues      # Tripo statues from cityengine ($CITYENGINE_DIR, default beside this repo) and statues_to_model/
npx assetmgr upload         # needs the bucket's keys (ASSETMGR_ENV_FILE, see assetmgr's README)
```

Every asset records the generator and the hash of its code (`generator`), and its seed, so it can be rebuilt.
The import rewrites each GLB's texture paths to the textures' bucket names, so a model fetched by URL finds its
textures beside it.

## Statues

There are no statue generators yet: statues are made with Tripo, by hand. Many are **untextured** (a texture
costs about four times as much, and a bronze statue's texture would only say "bronze"), so each records its
material in `shader`: `bronze`, `marble`, `copper`, `copperoxide` or `plaster`, applied by the renderer from
assetmgr's `SHADER_PRESETS`. Reference photos and models in progress live in `statues_to_model/`, which is
gitignored: the photos are mostly Wikimedia Commons, not ours to publish.

## Licensing

Everything made for these projects is CC0 (`CC0-1.0`, set in each index's `defaults`): the generated trees,
plants and rocks, the painted textures, carkit, and the Tripo statues. Poly Haven's sources are CC0 too and carry
their attribution and page; see [CREDITS.md](CREDITS.md). The Admission Day model was built from Wikimedia Commons
photographs (CC-BY-SA), listed in its `aiSourceUrls`; the photos themselves are not in the bucket.
