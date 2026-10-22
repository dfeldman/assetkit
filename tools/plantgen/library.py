#!/usr/bin/env python3
"""
Writes library.json for the plants: what the ground cover of a route is made of, by biome.

Each species gets a count and a scale range; grasses and flowers also get a warmth and lightness so a
meadow is not one green. Everything else varies by seed.

    python3 tools/plantgen/library.py
"""
import json
import random
from pathlib import Path

HERE = Path(__file__).resolve().parent

TABLE = {
    'prairie_grass': {'count': 24, 'scale': (0.7, 1.3), 'tint': ((0.9, 1.0), (0.85, 1.0), (0.6, 0.95))},
    # meadow grass is the commonest thing on a route, so it gets the most entries and the most jitter
    'meadow_grass':  {'count': 30, 'scale': (0.6, 1.4), 'tint': ((0.8, 1.0), (0.9, 1.0), (0.65, 1.0)), 'jitter': True},
    'meadow_full':   {'count': 28, 'scale': (0.6, 1.4), 'tint': ((0.8, 1.0), (0.9, 1.0), (0.65, 1.0)), 'jitter': True},
    'meadow_tussock': {'count': 18, 'scale': (0.7, 1.3), 'tint': ((0.7, 0.9), (0.85, 1.0), (0.5, 0.75)), 'jitter': True},
    'meadow_short':  {'count': 16, 'scale': (0.7, 1.3), 'tint': ((0.8, 1.0), (0.9, 1.0), (0.65, 1.0)), 'jitter': True},
    'dry_grass':     {'count': 18, 'scale': (0.7, 1.3), 'tint': ((0.9, 1.0), (0.75, 0.9), (0.45, 0.65))},
    'fern':          {'count': 18, 'scale': (0.6, 1.3), 'tint': ((0.85, 1.0), (0.95, 1.0), (0.8, 1.0))},
    'dandelion':     {'count': 14, 'scale': (0.7, 1.3)},
    'daisy':         {'count': 14, 'scale': (0.7, 1.3)},
    'wildflower':    {'count': 16, 'scale': (0.7, 1.3)},
    'sunflower':     {'count': 12, 'scale': (0.8, 1.2)},
    'tulip':         {'count': 14, 'scale': (0.8, 1.2)},
    'palm':          {'count': 16, 'scale': (0.7, 1.3)},
    # the trail flora: verges, hedgerows, moor, scrub and desert
    'nettle':        {'count': 10, 'scale': (0.7, 1.3)},
    'bush_flowering': {'count': 12, 'scale': (0.7, 1.4)},
    'heather':       {'count': 14, 'scale': (0.7, 1.4)},
    'prickly_pear':  {'count': 10, 'scale': (0.7, 1.4)},
    'bracken':       {'count': 12, 'scale': (0.7, 1.3)},
    'reeds':         {'count': 12, 'scale': (0.7, 1.3)},
    'yucca':         {'count': 8, 'scale': (0.7, 1.3)},
    'cattail':       {'count': 10, 'scale': (0.8, 1.2)},
    'lupine':        {'count': 10, 'scale': (0.8, 1.2)},
    'goldenrod':     {'count': 10, 'scale': (0.8, 1.2)},
    'mullein':       {'count': 8, 'scale': (0.8, 1.2)},
    'thistle':       {'count': 10, 'scale': (0.8, 1.2)},
    'cow_parsley':   {'count': 10, 'scale': (0.8, 1.2)},
    'buttercup':     {'count': 12, 'scale': (0.8, 1.2)},
    'poppy':         {'count': 10, 'scale': (0.8, 1.2)},
    'clover':        {'count': 12, 'scale': (0.7, 1.3)},
    'saguaro':       {'count': 14, 'scale': (0.6, 1.3)},
    'barrel_cactus': {'count': 8, 'scale': (0.7, 1.3)},
    # Lombard Street's beds: the heads' colours by entry (flowers.cells), see the 'cells' list below
    'hydrangea':     {'count': 12, 'scale': (0.8, 1.25), 'cells': [[0, 1], [1], [0, 2], [2, 0], [3], [0, 1]]},
    # San Francisco's warm-climate planting (2026-10-21): succulents, coastal natives and the Mediterranean garden
    # plants that grow wild there. Appended, so the seeds of everything above stay as they were.
    'agave':         {'count': 8, 'scale': (0.75, 1.3)},
    'aloe':          {'count': 8, 'scale': (0.8, 1.25)},
    'aeonium':       {'count': 8, 'scale': (0.8, 1.25)},
    'echeveria':     {'count': 8, 'scale': (0.8, 1.3)},
    'ice_plant':     {'count': 8, 'scale': (0.8, 1.3)},
    'nz_flax':       {'count': 8, 'scale': (0.8, 1.25), 'cells': [[0], [1], [0], [0, 1]]},
    'deer_grass':    {'count': 8, 'scale': (0.8, 1.25), 'tint': ((0.78, 0.9), (0.84, 0.95), (0.6, 0.72))},
    'artemisia':     {'count': 8, 'scale': (0.8, 1.3)},
    'lavender':      {'count': 8, 'scale': (0.8, 1.25)},
    'coyote_brush':  {'count': 10, 'scale': (0.8, 1.3)},
    'ceanothus':     {'count': 10, 'scale': (0.8, 1.25)},
    'echium':        {'count': 8, 'scale': (0.8, 1.2)},
    # and the owner's iconic ones (2026-10-21: "bird of paradise", "cactuses"), with Francisco Park's buckwheat
    'strelitzia':    {'count': 10, 'scale': (0.8, 1.25)},
    'agapanthus':    {'count': 8, 'scale': (0.8, 1.2)},
    'calla_lily':    {'count': 8, 'scale': (0.8, 1.2)},
    'bougainvillea': {'count': 8, 'scale': (0.8, 1.2)},
    'buckwheat':     {'count': 10, 'scale': (0.8, 1.3)},
    'san_pedro':     {'count': 8, 'scale': (0.7, 1.3)},
    'golden_barrel': {'count': 8, 'scale': (0.7, 1.3)},
}


def main() -> None:
    rng = random.Random(2029)
    plants = []
    for species, t in TABLE.items():
        for i in range(t['count']):
            sets = [f'scale={round(rng.uniform(*t["scale"]), 2)}']
            if 'tint' in t:
                sets.append('tint=' + json.dumps([round(rng.uniform(*c), 2) for c in t['tint']]))
            if t.get('jitter'):
                # how many cards, how many clumps, how much they lean: no two meadow clumps alike
                lo, hi = rng.randint(3, 6), rng.randint(7, 11)
                sets.append(f'cards=[{lo},{hi}]')
                c = rng.randint(1, 5)
                sets.append(f'clumps=[{c},{c + rng.randint(0, 2)}]')
                sets.append(f'lean=[{rng.randint(5, 20)},{rng.randint(25, 45)}]')
                sets.append(f'cross={round(rng.uniform(0.0, 0.5), 2)}')
            if 'cells' in t:
                key = 'cells' if species == 'nz_flax' else 'flowers.cells'
                sets.append(f'{key}=' + json.dumps(t['cells'][i % len(t['cells'])]))
            plants.append({'species': species, 'seed': 9000 + len(plants), 'name': f'{species}_{i + 1:03d}', 'set': sets})
    out = HERE / 'library.json'
    out.write_text(json.dumps({'about': 'Generated by library.py from its table; do not edit by hand.', 'total': len(plants), 'trees': plants}, indent=1))
    print(f'{len(plants)} plants -> {out}')


if __name__ == '__main__':
    main()
