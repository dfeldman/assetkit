/**
 * Record the generators' texture sources (tools/cache/<generator>/) in the assetkit-texture-sources index, so they
 * are kept in the bucket rather than depending on Poly Haven serving the same files forever, and so a fresh clone
 * can put them back with `npx assetmgr restore` instead of re-running every *:textures script.
 *
 * Each texture is one asset: the full-size file (LOD 0) and its `_512` copy (LOD 1), each with a `localPath`
 * back into tools/cache/. The Poly Haven asset it came from is read from the generator's own fetch.py lists, so
 * every file links to its page (sourceUrl) with Poly Haven's CC0 attribution. Files whose names carry no Poly
 * Haven key (plantgen's painted textures) are recorded as our own work. Previews and build logs are skipped:
 * they are the generators' output, not their input.
 *
 *   npm run import:sources
 *   npx assetmgr upload
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { addFile, emptyIndex, indexFileName, loadRepo, saveIndex, serializeIndex, slugify } from 'assetmgr/node';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';

const ROOT = join(import.meta.dirname, '..');
const INDEX = 'assetkit-texture-sources';
const GENERATORS = ['deciduousgen', 'conifergen', 'rockgen', 'plantgen'];
const PREFIXES = ['bark', 'rock', 'leaf', 'needle', 'page'];

/** key → Poly Haven asset id, from the `{'key': …, 'asset': …}` rows of a generator's fetch.py */
async function polyHavenKeys(gen: string): Promise<Map<string, string>> {
  const src = await readFile(join(ROOT, 'tools', gen, 'fetch.py'), 'utf8');
  const keys = new Map<string, string>();
  for (const m of src.matchAll(/'key':\s*'([^']+)',\s*'asset':\s*'([^']+)'/g)) keys.set(m[1]!, m[2]!);
  return keys;
}

async function main(): Promise<void> {
  const path = join(ROOT, 'indexes', indexFileName(INDEX));
  if (!existsSync(path)) {
    await mkdir(join(ROOT, 'indexes'), { recursive: true });
    await writeFile(path, serializeIndex({
      ...emptyIndex(INDEX, { project: 'assetkit', projectName: 'Asset Kit', repo: 'https://github.com/dfeldman/assetkit', license: 'CC0-1.0', type: '2d', subtype: 'texture', folder: 'sources' }),
      description: 'The texture sources the tree, plant and rock generators build from: Poly Haven downloads and the pages and atlases made from them (tools/cache/)',
    }));
  }
  const repo = await loadRepo(ROOT);
  const index = () => repo.indexes.find((l) => l.name === INDEX)!.index;
  let added = 0, files = 0;
  for (const gen of GENERATORS) {
    const keys = await polyHavenKeys(gen);
    const byLength = [...keys.keys()].sort((a, b) => b.length - a.length);
    const dir = join(ROOT, 'tools', 'cache', gen);
    const names = (await readdir(dir, { withFileTypes: true })).filter((d) => d.isFile() && /\.(jpg|png)$/.test(d.name)).map((d) => d.name).sort();
    const groups = new Map<string, string[]>();
    for (const n of names) {
      const base = n.replace(/_512(\.[a-z]+)$/, '$1');
      groups.set(base, [...(groups.get(base) ?? []), n]);
    }
    for (const [base, members] of groups) {
      const stem = base.replace(/\.[a-z]+$/, '');
      const id = slugify(`${gen}-${stem}`);
      if (index().assets.some((a) => a.id === id)) continue;
      const key = byLength.find((k) => PREFIXES.some((p) => stem.startsWith(`${p}_${k}_`) || stem === `${p}_${k}`) || stem.startsWith(`${k}_`));
      const asset = key ? keys.get(key) : undefined;
      const derived = /snow|atlas/.test(stem);
      const painted = stem.startsWith('painted_') || stem.startsWith('skin_');
      for (const n of members.sort((a, b) => (a.includes('_512') ? 1 : 0) - (b.includes('_512') ? 1 : 0))) {
        const small = n.includes('_512.');
        await addFile(repo, {
          index: INDEX,
          src: join(dir, n),
          assetId: id,
          allowDuplicate: true,
          asset: {
            id,
            name: stem.replace(/_/g, ' '),
            assetKeywords: [gen, ...(asset ? ['polyhaven'] : [])],
            ...(asset && !painted
              ? { attribution: 'Poly Haven (polyhaven.com), CC0', sourceUrl: `https://polyhaven.com/a/${asset}`, clickUrl: `https://polyhaven.com/a/${asset}` }
              : {}),
            generator: { script: `assetkit/tools/${gen}/${derived || painted ? (painted ? 'paint.py' : 'pages.py') : 'fetch.py'}` },
            notes: painted
              ? `Painted by tools/${gen}/paint.py: our own work.`
              : derived
                ? `Built by tools/${gen} from the Poly Haven ${asset ?? ''} download${stem.includes('snow') ? ' (snow added by treekit/snowtex.py)' : ''}.`
                : asset ? `Downloaded from Poly Haven (${asset}) by tools/${gen}/fetch.py.` : `Made by tools/${gen}.`,
            extra: { assetkit: { generator: gen, polyHavenKey: key } },
          },
          file: {
            lod: small ? 1 : 0,
            fileKeywords: [small ? '512' : 'full', ...(!derived && !painted && !small && asset ? ['source'] : [])],
            ...(!derived && !painted && !small && asset ? { isSource: true } : {}),
            localPath: `tools/cache/${gen}/${n}`,
          },
        });
        files++;
      }
      added++;
    }
  }
  await saveIndex(repo.indexes.find((l) => l.name === INDEX)!);
  console.log(`${added} textures added (${files} files)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
