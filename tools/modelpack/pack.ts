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
import { compactPrimitive, dedup, prune, quantize, simplify, textureCompress, weld } from '@gltf-transform/functions'
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

/** `sloppy`: meshopt's simplifySloppy, which ignores the topology — for a scan whose UV seams lock the ordinary
 *  simplifier (the Sutro Heights lion stopped at 182 000 of 1.9 M triangles whatever the ratio, 2026-10-25) */
interface Lod { ratio: number; tex: number; error?: number; sloppy?: boolean }
interface Model {
  id: string; name: string; file: string; kind: string; material: string
  front: '+z' | '-z' | '+x' | '-x'; scale: { axis: 'x' | 'y' | 'z'; metres: number }
  draft?: number; plinth?: [number, number, number]; lods: Lod[]
  /** drop triangles whose middle stands further than `max` (model units) from the centre along `axis`: a stray rope */
  crop?: { axis: 'x' | 'y' | 'z'; max: number }
  /** scale the model along one axis only (a model the AI stretched): positions × factor, normals corrected */
  squash?: { axis: 'x' | 'y' | 'z'; factor: number }
  description?: string; keywords?: string[]; reference?: string; notes?: string; artist?: string
}

const spec = JSON.parse(await readFile(join(ROOT, 'models', 'sf-models.json'), 'utf8')) as { models: Model[] }
const want = process.argv.slice(2)
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ sharp })
await MeshoptSimplifier.ready

/** `sloppy` LODs: each indexed primitive cut to `ratio` of its triangles by meshopt's simplifySloppy, then compacted */
function sloppy(doc: Document, ratio: number, error: number): void {
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
    const idx = p.getIndices(), pos = p.getAttribute('POSITION')
    if (!idx || !pos) continue
    const indices = new Uint32Array(idx.getArray()!)
    const positions = new Float32Array(pos.getArray()!)
    const target = Math.max(3, Math.floor((indices.length * ratio) / 3) * 3)
    const [out] = MeshoptSimplifier.simplifySloppy(indices, positions, 3, null, target, error)
    idx.setArray(new Uint32Array(out))
    compactPrimitive(p)
  }
}

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

/** `crop`: every triangle whose middle lies beyond `max` along `axis` is dropped (indexed primitives) */
function crop(doc: Document, c: { axis: 'x' | 'y' | 'z'; max: number }): number {
  const k = { x: 0, y: 1, z: 2 }[c.axis]
  let dropped = 0
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
    const pos = p.getAttribute('POSITION')?.getArray(), idx = p.getIndices()
    if (!pos || !idx) continue
    const a = idx.getArray()!, keep: number[] = []
    for (let i = 0; i + 2 < a.length; i += 3) {
      const mid = (pos[a[i] * 3 + k] + pos[a[i + 1] * 3 + k] + pos[a[i + 2] * 3 + k]) / 3
      if (Math.abs(mid) > c.max) { dropped++; continue }
      keep.push(a[i], a[i + 1], a[i + 2])
    }
    idx.setArray(a.length > 65535 * 3 || pos.length / 3 > 65535 ? new Uint32Array(keep) : new Uint16Array(keep))
  }
  return dropped
}

/** `squash`: positions scaled along one axis; normals by the inverse, renormalised (a non-uniform scale's normal rule) */
function squash(doc: Document, q: { axis: 'x' | 'y' | 'z'; factor: number }): void {
  const k = { x: 0, y: 1, z: 2 }[q.axis]
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
    const pos = p.getAttribute('POSITION'), nor = p.getAttribute('NORMAL')
    if (pos) { const a = pos.getArray()!.slice(); for (let i = k; i < a.length; i += 3) a[i] *= q.factor; pos.setArray(a) }
    if (nor) {
      const a = nor.getArray()!.slice()
      for (let i = 0; i < a.length; i += 3) {
        a[i + k] /= q.factor
        const l = Math.hypot(a[i], a[i + 1], a[i + 2]) || 1
        a[i] /= l; a[i + 1] /= l; a[i + 2] /= l
      }
      nor.setArray(a)
    }
  }
}

/** the bounds of the vertices triangles actually use (a crop leaves the dropped ones in the buffer) */
function triBounds(doc: Document): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
    const pos = p.getAttribute('POSITION')?.getArray(), idx = p.getIndices()?.getArray()
    if (!pos || !idx) continue
    for (const v of idx) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], pos[v * 3 + k]); max[k] = Math.max(max[k], pos[v * 3 + k]) }
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
    if (m.crop) crop(doc, m.crop)
    if (m.squash) squash(doc, m.squash)
    if (lod.sloppy) { await doc.transform(dedup(), weld()); sloppy(doc, lod.ratio, lod.error ?? 0.02) }
    await doc.transform(
      dedup(), weld(),
      ...(lod.ratio < 1 && !lod.sloppy ? [simplify({ simplifier: MeshoptSimplifier, ratio: lod.ratio, error: lod.error ?? 0.02 })] : []),
      prune(),
      textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [lod.tex, lod.tex], quality: 86 }),
    )
    // the real size, from the model as packed (cropped, squashed) and before quantizing (which stores integers)
    const kept = n === 0 ? triBounds(doc) : null
    await doc.transform(quantize())
    const out = join(SCRATCH, `${m.id}.lod${n}.glb`)
    const bytes = await io.writeBinary(doc)
    await writeFile(out, bytes)
    const hash = createHash('sha256').update(bytes).digest('hex')
    lodInfo.push({ lod: n, triangles: Math.round(triangles(doc)), tex: lod.tex, kB: Math.round(bytes.length / 1024) })
    if (kept) {
      const pb = kept
      const s = [0, 1, 2].map((i) => Math.round((pb.max[i] - pb.min[i]) * unit * 100) / 100)
      Object.assign(fields, { width: s[0], height: s[1], length: s[2] })
      size.splice(0, 3, ...s)
    }
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
        material: m.material, source: m.file, ...(m.crop ? { crop: m.crop } : {}), ...(m.squash ? { squash: m.squash } : {}), reference: m.reference, lods: lodInfo,
      },
    },
  })
  await saveIndex(loaded)
  console.log(`  ${m.id}: ${size.join(' × ')} m (x × y × z), ${lodInfo.map((l) => `lod${l.lod} ${l.triangles} tris ${l.kB} kB`).join(', ')}`)
}
