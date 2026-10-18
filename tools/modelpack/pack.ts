/**
 * Photogrammetry-style (AI) models of San Francisco landmarks → game-ready LODs in the shared bucket.
 *
 * Reads models/sf-models.json (what each model is: its source file, real size, front axis, waterline, material, the
 * LODs to make) and, per model:
 *
 * - LOD n: welded and de-duplicated, simplified to `ratio` of its triangles (meshoptimizer's simplifier: only the
 *   PACKER needs it — the output is plain glTF), vertex data QUANTIZED (KHR_mesh_quantization, which Babylon reads
 *   with no decoder: the games run offline, so no Draco or meshopt decoders fetched from a CDN), textures resized to
 *   `tex` px and re-encoded as WebP (EXT_texture_webp). The exporter's extras (FB_ngon_encoding,
 *   KHR_materials_volume) are dropped. Same recipe as cityengine tools/glb/pack.ts, which made the Paris statues.
 * - records it in indexes/asset-index-assetkit-models-sf.json: the source GLB (isSource) and each LOD (`lod`,
 *   isProd), with the model's real size and the rest of its metadata under `extra.model`, so any project can place it
 *   without opening the file.
 *
 * Re-runnable: a LOD whose bytes are unchanged is skipped; a changed one replaces the old file (kept in the index as
 * isDeleted, so `assetmgr delete --yes` clears it from the bucket). Never changes the source files.
 *
 *   node tools/modelpack/pack.ts [id…]            (INCOMING_DIR: the source GLBs; default ../cityengine/incoming_assets)
 *   npx assetmgr upload                            (credentials: see ~/assetmgr/README.md)
 */
import { NodeIO, type Document } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, prune, quantize, simplify, textureCompress, weld } from '@gltf-transform/functions'
import { MeshoptSimplifier } from 'meshoptimizer'
import sharp from 'sharp'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { addFile, emptyIndex, indexFileName, loadRepo, saveIndex, serializeIndex } from 'assetmgr/node'

const ROOT = resolve(import.meta.dirname, '..', '..')
const INCOMING = process.env.INCOMING_DIR || resolve(ROOT, '..', 'cityengine', 'incoming_assets')
const INDEX = 'assetkit-models-sf'
const INDEX_DIR = 'indexes'
const FOLDER = 'models/sf'
const SCRATCH = resolve(ROOT, '.assetmgr', 'modelpack')

interface Lod { ratio: number; tex: number; error?: number }
interface Model {
  id: string; name: string; file: string; kind: string; material: string
  front: '+z' | '-z' | '+x' | '-x'; scale: { axis: 'x' | 'y' | 'z'; metres: number }
  draft?: number; plinth?: [number, number, number]; lods: Lod[]
  description?: string; keywords?: string[]; reference?: string; notes?: string; artist?: string
}

const spec = JSON.parse(await readFile(join(ROOT, 'models', 'sf-models.json'), 'utf8')) as { models: Model[] }
const want = process.argv.slice(2)
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ sharp })
await MeshoptSimplifier.ready

/** the model's bounds, as loaded (glTF units) */
function bounds(doc: Document): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
    const a = p.getAttribute('POSITION')
    if (!a) continue
    const lo = a.getMin([0, 0, 0]), hi = a.getMax([0, 0, 0])
    for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], lo[k]); max[k] = Math.max(max[k], hi[k]) }
  }
  return { min, max }
}

const triangles = (doc: Document): number => doc.getRoot().listMeshes().reduce((n, m) => n + m.listPrimitives()
  .reduce((k, p) => k + ((p.getIndices()?.getCount() ?? p.getAttribute('POSITION')?.getCount() ?? 0) / 3), 0), 0)

async function ensureIndex(): Promise<void> {
  const path = join(ROOT, INDEX_DIR, indexFileName(INDEX))
  if (existsSync(path)) return
  await mkdir(join(ROOT, INDEX_DIR), { recursive: true })
  await writeFile(path, serializeIndex({
    ...emptyIndex(INDEX, {
      project: 'assetkit', projectName: 'Asset Kit', repo: 'https://github.com/dfeldman/assetkit', folder: FOLDER,
      license: 'CC0-1.0', type: '3d', subtype: 'scenery', isAi: true,
    }),
    description: 'AI photogrammetry-style models of San Francisco landmarks (ships, fountains, bridges), with game-ready LODs',
  }))
}

await ensureIndex()
await mkdir(SCRATCH, { recursive: true })
for (const m of spec.models.filter((q) => want.length === 0 || want.includes(q.id))) {
  const src = join(INCOMING, m.file)
  if (!existsSync(src)) { console.warn(`  ${m.id}: ${src} not found, skipped`); continue }
  const repo = await loadRepo()
  const loaded = repo.indexes.find((l) => l.name === INDEX)!
  let asset = loaded.index.assets.find((a) => a.id === m.id)

  // the model's own size, from the source: the scale that makes `scale.axis` measure `scale.metres`
  const srcDoc = await io.read(src)
  const b = bounds(srcDoc)
  const k = { x: 0, y: 1, z: 2 }[m.scale.axis]
  const unit = m.scale.metres / Math.max(1e-6, b.max[k] - b.min[k])
  const size = [0, 1, 2].map((i) => Math.round((b.max[i] - b.min[i]) * unit * 100) / 100)
  const lodInfo: { lod: number; triangles: number; tex: number; kB: number }[] = []

  const fields = {
    name: m.name, description: m.description, artist: m.artist, notes: m.notes,
    width: size[0], height: size[1], length: size[2],
    aiTool: 'Tripo', subtype: m.kind === 'statue' ? 'sculpture' : 'scenery',
    ...(m.material !== 'textured' ? { shader: m.material } : {}),
    assetKeywords: m.keywords ?? [m.id],
  }
  if (!asset) {
    await addFile(repo, { index: INDEX, indexDir: INDEX_DIR, src, asset: { id: m.id, ...fields }, file: { isSource: true, fileKeywords: ['source'], fileNote: 'Tripo original, as exported' } })
    asset = loaded.index.assets.find((a) => a.id === m.id)!
    console.log(`  ${m.id}: source added`)
  }

  for (const [n, lod] of m.lods.entries()) {
    const doc = await io.read(src)
    for (const ext of doc.getRoot().listExtensionsUsed()) {
      if (ext.extensionName === 'FB_ngon_encoding' || ext.extensionName === 'KHR_materials_volume') ext.dispose()
    }
    await doc.transform(
      dedup(), weld(),
      ...(lod.ratio < 1 ? [simplify({ simplifier: MeshoptSimplifier, ratio: lod.ratio, error: lod.error ?? 0.02 })] : []),
      prune(),
      textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [lod.tex, lod.tex], quality: 86 }),
      quantize(),
    )
    const out = join(SCRATCH, `${m.id}.lod${n}.glb`)
    const bytes = await io.writeBinary(doc)
    await writeFile(out, bytes)
    const hash = createHash('sha256').update(bytes).digest('hex')
    lodInfo.push({ lod: n, triangles: Math.round(triangles(doc)), tex: lod.tex, kB: Math.round(bytes.length / 1024) })
    const live = asset.assetFiles.filter((f) => f.lod === n && !f.isDeleted)
    if (live.some((f) => f.hash === hash)) continue
    for (const f of live) f.isDeleted = true
    await addFile(repo, { index: INDEX, indexDir: INDEX_DIR, src: out, assetId: m.id, move: true,
      file: { lod: n, isProd: true, fileKeywords: [`lod${n}`], fileNote: `${lodInfo[n].triangles} triangles, textures ≤ ${lod.tex} px` } })
    console.log(`  ${m.id} lod${n}: ${lodInfo[n].triangles} triangles, ${lodInfo[n].kB} kB`)
  }

  // a LOD no longer asked for: its file is retired (kept in the index as isDeleted)
  for (const f of asset.assetFiles) if (f.lod !== undefined && f.lod >= m.lods.length && !f.isDeleted) f.isDeleted = true
  // the metadata, every run: what a project needs to place it without opening the file
  Object.assign(asset, fields, {
    extra: {
      ...(asset.extra ?? {}),
      model: {
        kind: m.kind, front: m.front, scale: m.scale, unitsToMetres: Math.round(unit * 1000) / 1000,
        ...(m.draft !== undefined ? { draft: m.draft } : {}), ...(m.plinth ? { plinth: m.plinth } : {}),
        material: m.material, source: m.file, reference: m.reference, lods: lodInfo,
      },
    },
  })
  await saveIndex(loaded)
  console.log(`  ${m.id}: ${size.join(' × ')} m (x × y × z), ${lodInfo.map((l) => `lod${l.lod} ${l.triangles} tris ${l.kB} kB`).join(', ')}`)
}
