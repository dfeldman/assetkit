# plantgen — grasses, ferns, flowers, palms and cacti (assetkit; used by Trail Trainer and Cycle Dash)

Everything on a route that is neither a tree nor a rock, built on the same core as the trees
(`tools/treekit`: driver, materials, export, LODs, shared textures, library table). The shapes are in
`plantkit.py`, four archetypes:

| form | what | species |
|---|---|---|
| tuft | cards fanned out from a point on the ground, one to four clumps | prairie_grass, meadow_grass, dry_grass, fern |
| flower | thin stems, a rosette at the foot, a head at the top: a tilted disc (daisies, dandelions, wildflowers), crossed upright cards (tulips) or one card facing sideways (sunflowers) | dandelion, daisy, wildflower, sunflower, tulip |
| palm | a leaning ringed trunk, a crown of drooping frond spines carrying frond cards, dead fronds hanging under | palm |
| cactus | a ribbed column with arms that leave it sideways and curve up; or a short fat barrel | saguaro, barrel_cactus |
| bush | cards standing on a dome, crossed, leaning out at the edge, optional flower dots; bushes borrow the tree leaf-cluster pages (`tree:broad` etc.) | bush_green, bush_flowering, bramble, nettle, sagebrush, heather, prickly_pear, clover, hydrangea |

Trail flora on top of the first twelve: meadow_full, meadow_tussock, meadow_short (meadow grass is the
commonest thing on a route, so it has four species and ninety entries), bracken, reeds, yucca, cattail,
lupine, goldenrod, mullein, thistle, cow_parsley, buttercup, poppy. Spikes, discs (poppy, umbel, thistle,
buttercup), prickly-pear pads and heather sprigs are painted.

```bash
npm run plants:textures              # once: Poly Haven pages, painted textures, card atlases
python3 tools/plantgen/library.py    # the table -> library.json (~190 plants)
npm run plants -- --library          # build public/plants/
npm run plants -- --species sunflower --seed 3 --preview
```

Hydrangea (mophead, *Hydrangea macrophylla*; for Lombard Street's beds, 2026-10-16): a dense dark-leaved
mound covered in big round heads. Heads are `painted_hydrangea` (paint.py `mophead`: hundreds of four-petalled
florets in a shaded ball; cells 0 pink, 1 rose, 2 blush, 3 blue), sat on the dome's surface (`flowers.surface`)
and drawn as three crossed cards each (`flowers.cross`) so a head reads as a ball from any side. The library's
twelve entries pick their colours per entry (`flowers.cells`, library.py's `cells` column).

San Francisco's warm-climate planting (2026-10-21; Francisco Park, Lands End, the Presidio, Alcatraz): the library
was built for two deciduous-forest trails and had nothing that grows only somewhere warm. Twelve species, appended to
the table so no earlier seed moved:

| species | what | form |
|---|---|---|
| agave, aloe | rosettes of thick sword leaves (`painted_succulents` 0, 1), folded down the spine (`fold`); aloe with orange torch spikes | tuft, flower |
| aeonium, echeveria | flat rosettes seen from above (`painted_succulents` 2, 3) on bare stems, or a low clump hugging the ground | flower |
| ice_plant | a fleshy green-and-red mat (cards laid nearly flat) with magenta daisies (`painted_warm` 0, 1) | flower |
| nz_flax | a fan of stiff bronze or green straps (`painted_coastal` 0, 1; per entry via `cells`) | tuft |
| deer_grass | a fountain of fine sage-green blades (`grass_tall`, tinted) | tuft |
| artemisia, lavender | silver felted sprigs; grey-green sprigs under purple spikes (`painted_coastal` 2, 3) | bush |
| coyote_brush, ceanothus | coastal scrub mounds (`tree:fine`; `tree:dark` with blue puffs from the hydrangea page, tinted) | bush |
| echium | pride of Madeira: a grey-green mound throwing up blue-violet cones (`painted_warm` 2, 3) | bush |

The three pages are painted by `paint.py` (`warm_pages`). A tuft now takes the species' `cells` and `fold`.

## Textures

Grass, fern, dandelion, daisy, wildflower and leaf cards are cut out of Poly Haven's CC0 plant models
(`fetch.py`). Those pages are baked-model sheets with bleed all over them, so every sprite is a
hand-picked rectangle in `pages.py`, trimmed to its alpha; grass cells are clumps of several tufts, or
long blades fanned from one base. Sunflower heads, tulip cups, palm fronds, cactus skin and the plain
green stem are painted by `paint.py` -- flat, 2011-honest, and the lighting does the rest.

## Output

`public/plants/<name>.glb`: root node with LOD0–2 children, each a mesh of up to three primitives: stem
(opaque: green skin, palm bark or cactus skin), leaves and heads (alpha-masked cards, double-sided).
LODs keep half and a quarter of the cards and grow the rest. Origin on the ground. `index.json` has
`kind: plant`, `form`, `species`, `height`, `bounds` and per-LOD triangle counts. Plants are tiny in
triangles (a grass clump is 40, a sunflower patch 400, a palm 300, a saguaro 600), so the game should
instance them by the thousand, as it does the grass it already has.
