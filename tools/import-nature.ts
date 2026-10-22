/**
 * Record the generated nature libraries (public/{trees,plants,rocks}, written by the generators in tools/) in the
 * assetkit-* indexes. The libraries were first built in Trail Trainer, whose index format the entries keep (in
 * `extra.trailtrainer`, which every consumer reads).
 *
 * The GLBs reference their textures by relative URI (`textures/bark_brown_diff_512_e737e38e.jpg`). Each texture
 * becomes its own asset (index assetkit-nature-textures, stored once however many models use it), each GLB's
 * image URIs are rewritten to the textures' assetmgr file names, and everything goes in one `nature/` folder
 * so the URIs resolve both on disk and in the flat bucket.
 *
 * Re-runnable: assets already in an index are skipped.
 *
 *   npm run import:nature            (reads public/, where the generators in tools/ write)
 */

import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { existsSync } from 'node:fs';
import { addFile, emptyIndex, indexFileName, loadRepo, makeFilename, saveIndex, serializeIndex, sha256Bytes, slugify, type Asset, type Repo } from 'assetmgr/node';

// the generators in tools/ write their libraries to public/ in this repo
const TT = process.argv[2] ?? join(import.meta.dirname, '..');
const FOLDER = 'nature';
const INDEX_DIR = 'indexes';
const SCRATCH = join(process.cwd(), '.assetmgr', 'import-scratch');

const DEFAULTS = { project: 'assetkit', projectName: 'Asset Kit', repo: 'https://github.com/dfeldman/assetkit', folder: FOLDER };

/** Common name (as Trail Trainer names files) → Latin name. Genus only where the generator models no particular species. */
const LATIN: Record<string, string> = {
  ash: 'Fraxinus excelsior', aspen: 'Populus tremula', beech: 'Fagus sylvatica', birch: 'Betula pendula',
  black_pine: 'Pinus nigra', cypress: 'Cupressus sempervirens', elm: 'Ulmus', fir: 'Abies alba',
  larch: 'Larix decidua', maple: 'Acer', oak: 'Quercus', poplar: 'Populus', scots_pine: 'Pinus sylvestris',
  spruce: 'Picea abies', willow: 'Salix',
  barrel_cactus: 'Ferocactus', bracken: 'Pteridium aquilinum', bramble: 'Rubus fruticosus', buttercup: 'Ranunculus',
  cattail: 'Typha', clover: 'Trifolium', cow_parsley: 'Anthriscus sylvestris', daisy: 'Bellis perennis',
  dandelion: 'Taraxacum officinale', dogwood: 'Cornus', elder: 'Sambucus nigra', goldenrod: 'Solidago',
  hawthorn: 'Crataegus monogyna', hazel: 'Corylus avellana', heather: 'Calluna vulgaris', hydrangea: 'Hydrangea macrophylla',
  juniper_scrub: 'Juniperus communis', lupine: 'Lupinus', mugo_pine: 'Pinus mugo', mullein: 'Verbascum thapsus',
  nettle: 'Urtica dioica', poppy: 'Papaver rhoeas', prickly_pear: 'Opuntia', reeds: 'Phragmites australis',
  rhododendron: 'Rhododendron', sagebrush: 'Artemisia tridentata', saguaro: 'Carnegiea gigantea',
  sunflower: 'Helianthus annuus', thistle: 'Cirsium', tulip: 'Tulipa', willow_scrub: 'Salix', yucca: 'Yucca',
  agave: 'Agave americana', aloe: 'Aloe arborescens', aeonium: 'Aeonium arboreum', echeveria: 'Echeveria', ice_plant: 'Carpobrotus edulis',
  nz_flax: 'Phormium tenax', deer_grass: 'Muhlenbergia rigens', artemisia: 'Artemisia', lavender: 'Lavandula', coyote_brush: 'Baccharis pilularis',
  ceanothus: 'Ceanothus', echium: 'Echium candicans',
  strelitzia: 'Strelitzia reginae', agapanthus: 'Agapanthus praecox', calla_lily: 'Zantedeschia aethiopica', bougainvillea: 'Bougainvillea',
  buckwheat: 'Eriogonum fasciculatum', san_pedro: 'Echinopsis pachanoi', golden_barrel: 'Echinocactus grusonii',
  toyon: 'Heteromeles arbutifolia', rosemary: 'Salvia rosmarinus', mexican_sage: 'Salvia leucantha', fuchsia: 'Fuchsia', lions_tail: 'Leonotis leonurus',
  oleander: 'Nerium oleander', lantana: 'Lantana camara', rockrose: 'Cistus', leucadendron: 'Leucadendron', monkeyflower: 'Diplacus aurantiacus',
  westringia: 'Westringia fruticosa',
};

/** Texture families Trail Trainer's CREDITS.md traces to Poly Haven (CC0). The rest are painted by plantgen. */
const POLYHAVEN = /^(bark_|rock_|leaf_|needle_|broadleaf_|grass_|fern_|dandelion_|daisy_)/;

const LIBRARIES = [
  { dir: 'trees', index: 'assetkit-trees', subtype: 'tree', description: 'Trail Trainer tree library: deciduous and conifer, 3 LODs per file' },
  { dir: 'plants', index: 'assetkit-plants', subtype: 'plant', description: 'Trail Trainer plant library: shrubs, flowers, grasses, cacti' },
  { dir: 'rocks', index: 'assetkit-rocks', subtype: 'rock', description: 'Trail Trainer rocks: boulders, slabs, fields' },
] as const;

interface LibEntry {
  file: string;
  species: string;
  kind?: string;
  form?: string;
  type?: string;
  seed?: number;
  height?: number;
  size?: number;
  crown_radius?: number;
  bounds?: { top: number; bottom: number; radius: number };
  season?: string;
  lods?: unknown[];
  generator?: string;
  [k: string]: unknown;
}

/** sha256 over a generator's source files, sorted by path: identifies the code, not when it ran. */
async function codeHash(dirs: string[]): Promise<string> {
  const h = createHash('sha256');
  for (const d of dirs) {
    const files = ((await readdir(d, { recursive: true })) as string[]).filter((f) => /\.(py|ts|js|json)$/.test(f) && !f.includes('__pycache__')).sort();
    for (const f of files) h.update(f).update(await readFile(join(d, f)));
  }
  return h.digest('hex');
}

/** Rewrite the image URIs in a GLB's JSON chunk; the binary chunk is untouched. */
function rewriteGlb(bytes: Buffer, map: (uri: string) => string): { out: Buffer; uris: string[] } {
  if (bytes.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB');
  const jsonLen = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLen).toString('utf8'));
  const uris: string[] = [];
  for (const img of gltf.images ?? []) {
    if (img.uri) {
      img.uri = map(img.uri);
      uris.push(img.uri);
    }
  }
  let json = Buffer.from(JSON.stringify(gltf), 'utf8');
  if (json.length % 4) json = Buffer.concat([json, Buffer.alloc(4 - (json.length % 4), 0x20)]);
  const rest = bytes.subarray(20 + jsonLen);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + json.length + rest.length, 8);
  header.writeUInt32LE(json.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  return { out: Buffer.concat([header, json, rest]), uris };
}

function hasAsset(repo: Repo, index: string, id: string): boolean {
  return !!repo.indexes.find((l) => l.name === index)?.index.assets.some((a) => a.id === id);
}

/** Create an index file with its description and defaults before anything is added, so `folder` applies. */
async function ensureIndexFile(name: string, description: string): Promise<void> {
  const path = join(process.cwd(), INDEX_DIR, indexFileName(name));
  if (existsSync(path)) return;
  await mkdir(join(process.cwd(), INDEX_DIR), { recursive: true });
  await writeFile(path, serializeIndex({ ...emptyIndex(name, DEFAULTS), description }));
}

async function main(): Promise<void> {
  await ensureIndexFile('assetkit-nature-textures', 'Textures used by the assetkit trees, plants and rocks (Trail Trainer)');
  for (const lib of LIBRARIES) await ensureIndexFile(lib.index, lib.description);
  const repo = await loadRepo();
  await mkdir(SCRATCH, { recursive: true });
  const t0 = Date.now();

  // ---- textures: one asset per distinct file, keyed by content
  const texByHash = new Map<string, string>(); // sha256 → assetmgr filename
  const texByPath = new Map<string, string>(); // "<lib>/textures/<name>" → assetmgr filename
  let texAdded = 0;
  for (const lib of LIBRARIES) {
    const dir = join(TT, 'public', lib.dir, 'textures');
    for (const name of (await readdir(dir)).sort()) {
      const src = join(dir, name);
      const bytes = await readFile(src);
      const hash = sha256Bytes(bytes);
      const stem = name.replace(/\.[^.]+$/, '');
      const words = stem.replace(/_[0-9a-f]{8}$/, '');
      const ext = name.split('.').pop()!;
      const filename = makeFilename(hash, ext, [words.replace(/_/g, ' ')]);
      texByPath.set(`${lib.dir}/textures/${name}`, filename);
      if (texByHash.has(hash)) continue;
      texByHash.set(hash, filename);
      const id = slugify(stem);
      if (hasAsset(repo, 'assetkit-nature-textures', id)) continue;
      const polyhaven = POLYHAVEN.test(words);
      await addFile(repo, {
        index: 'assetkit-nature-textures',
        indexDir: INDEX_DIR,
        src,
        asset: {
          id,
          name: words.replace(/_/g, ' '),
          type: '2d',
          subtype: 'texture',
          assetKeywords: [words.replace(/_/g, ' ')],
          ...(polyhaven
            ? { license: 'CC0-1.0', attribution: 'Poly Haven (polyhaven.com), CC0', sourceUrl: 'https://polyhaven.com', notes: 'Derived from Poly Haven CC0 assets by Trail Trainer tools; per-texture sources in trailtrainer/CREDITS.md' }
            : { notes: 'Painted by assetkit tools/plantgen/paint.py' }),
          generator: { script: 'assetkit/tools' },
          extra: { trailtrainer: { file: `${lib.dir}/textures/${name}` } },
        },
        file: { isProd: true, fileNote: name.includes('_nor_gl') ? 'normal map (OpenGL convention)' : name.includes('_arm') ? 'AO/roughness/metalness' : undefined },
        allowDuplicate: false,
      });
      texAdded++;
    }
  }
  const texIdByFilename = new Map<string, string>();
  for (const a of repo.indexes.find((l) => l.name === 'assetkit-nature-textures')!.index.assets) texIdByFilename.set(a.assetFiles[0]!.filename, a.id);
  console.log(`textures: ${texByHash.size} distinct, ${texAdded} added (${texByPath.size} files across libraries)`);

  // ---- models
  const genHash = new Map<string, string>();
  for (const lib of LIBRARIES) {
    const dir = join(TT, 'public', lib.dir);
    const meta = JSON.parse(await readFile(join(dir, 'index.json'), 'utf8')) as { trees: LibEntry[] };
    let added = 0;
    for (const e of meta.trees) {
      const id = slugify(e.file.replace(/\.glb$/, ''));
      if (hasAsset(repo, lib.index, id)) continue;
      const gen = (e.generator ?? '').replace(/^(trailtrainer|assetkit)\s+/, '');
      if (gen && !genHash.has(gen)) genHash.set(gen, await codeHash([join(TT, 'tools', gen), join(TT, 'tools', 'treekit')]));
      const src = join(dir, e.file);
      const { out, uris } = rewriteGlb(await readFile(src), (uri) => {
        const f = texByPath.get(`${lib.dir}/${uri}`);
        if (!f) throw new Error(`${e.file}: texture ${uri} not found`);
        return f;
      });
      const tmp = join(SCRATCH, basename(e.file));
      await writeFile(tmp, out);
      const common = e.species;
      const latin = lib.subtype === 'rock' ? undefined : LATIN[common];
      const b = e.bounds;
      const asset: Partial<Asset> = {
        id,
        name: `${common.replace(/_/g, ' ')} ${e.file.match(/_(\d+)\.glb$/)?.[1] ?? ''}`.trim(),
        type: '3d',
        subtype: lib.subtype,
        ...(latin ? { species: latin } : {}),
        creationDate: (await stat(src)).mtime.toISOString().slice(0, 10),
        ...(b ? { height: +(b.top - b.bottom).toFixed(2), width: +(2 * b.radius).toFixed(2), length: +(2 * b.radius).toFixed(2) } : {}),
        assetKeywords: [common.replace(/_/g, ' '), ...(e.kind && e.kind !== lib.subtype ? [e.kind] : []), ...(e.form ? [e.form] : [])],
        generator: { script: `assetkit/tools/${gen}`, hash: genHash.get(gen), params: { season: e.season, kind: e.kind, form: e.form } },
        seed: e.seed,
        requires: [...new Set(uris.map((u) => `assetkit-nature-textures/${texIdByFilename.get(u)}`))],
        notes: 'Generated by Trail Trainer. generator.hash is of the code at import (2026-10-13), which may postdate the bake. Texture URIs rewritten to assetmgr names on import.',
        extra: { trailtrainer: { ...e, lods: e.lods } },
      };
      await addFile(repo, {
        index: lib.index,
        indexDir: INDEX_DIR,
        src: tmp,
        move: true,
        asset,
        file: { isProd: true, multiLod: (e.lods?.length ?? 1) > 1 },
      });
      added++;
    }
    console.log(`${lib.dir}: ${meta.trees.length} in library, ${added} added`);
  }

  for (const l of repo.indexes) await saveIndex(l);
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
