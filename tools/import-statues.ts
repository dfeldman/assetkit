/**
 * One-off import of the Tripo statues from Street Runner (Cycle Dash) into assetkit.
 *
 * Each statue is one asset with up to two files: the Tripo original (`incoming_models/`, isSource) and
 * Street Runner's game-ready repack (`public/models/paris/<id>.glb`, isProd: quantized, WebP ≤ 1024 px, made by
 * streetrunner tools/glb/pack.ts). The Cirque d'Hiver's right horseman is a mirror image made by the packer,
 * so it has only a prod file.
 *
 * Re-runnable: assets already present are skipped.
 *
 *   node tools/import-statues.ts [path to cityengine, default: the checkout beside this repo]
 */

import { existsSync } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { addFile, emptyIndex, indexFileName, loadRepo, serializeIndex, type Asset } from 'assetmgr/node';

const SR = process.argv[2] ?? join(import.meta.dirname, '..', '..', 'cityengine');
const INDEX_DIR = 'indexes';
const PACK = 'cityengine/tools/glb/pack.ts';

const DEFAULTS = {
  project: 'assetkit',
  projectName: 'Asset Kit',
  repo: 'https://github.com/dfeldman/assetkit',
  type: '3d' as const,
  subtype: 'sculpture',
  isAi: true,
  aiTool: 'Tripo',
};

interface Statue {
  id: string;
  name: string;
  /** Tripo original under incoming_models/, if any. */
  source?: string;
  /** Packed id under public/models/paris/, if any. */
  packed?: string;
  mirror?: boolean;
  artist?: string;
  keywords: string[];
  extra?: Partial<Asset>;
}

const PARIS: Statue[] = [
  { id: 'genie-liberte', name: 'Génie de la Liberté, Colonne de Juillet', source: 'streetrunner - bastille collone statue.glb', packed: 'genie-liberte', artist: 'Auguste Dumont', keywords: ['genie liberte', 'bastille'] },
  { id: 'colonne-bastille-top', name: 'Colonne de Juillet, top', source: 'streetrunner - colonne bastille top .glb', keywords: ['colonne juillet', 'bastille'], extra: { notes: 'Not used by Street Runner (not in tools/glb/pack.ts).' } },
  { id: 'cirque-horseman-left', name: "Cirque d'Hiver horseman (left)", source: 'streetrunner - cirque dhivers left horseman.glb', packed: 'cirque-horseman-left', keywords: ['cirque hiver', 'horseman', 'equestrian'] },
  { id: 'cirque-horseman-right', name: "Cirque d'Hiver horseman (right)", packed: 'cirque-horseman-right', mirror: true, keywords: ['cirque hiver', 'horseman', 'equestrian'], extra: { notes: 'Mirror image of cirque-horseman-left, made by the packer (mirror: true); no Tripo original of its own.' } },
  { id: 'charlemagne', name: 'Charlemagne et ses Leudes, Notre-Dame', source: 'streetrunner - charlemagne at notre-dame.glb', packed: 'charlemagne', artist: 'Louis Rochet and Charles Rochet', keywords: ['charlemagne', 'notre dame', 'equestrian'] },
  { id: 'de-gaulle', name: 'Charles de Gaulle, Champs-Élysées', source: 'streetrunner - charles de gaulle striding champs elysee.glb', packed: 'de-gaulle', artist: 'Jean Cardot', keywords: ['de gaulle', 'champs elysees'] },
  { id: 'clemenceau', name: 'Georges Clemenceau, Champs-Élysées', source: 'streetrunner - clemenceau champs elysee.glb', packed: 'clemenceau', artist: 'François Cogné', keywords: ['clemenceau', 'champs elysees'] },
  { id: 'etienne-marcel', name: 'Étienne Marcel, Hôtel de Ville', source: 'streetrunner - etienne marcel.glb', packed: 'etienne-marcel', artist: 'Antonin Idrac and Laurent Marqueste', keywords: ['etienne marcel', 'hotel de ville', 'equestrian'] },
  { id: 'jeanne-darc-pyramides', name: "Jeanne d'Arc, Place des Pyramides", source: 'streetrunner - jean darc place d pyramides.glb', packed: 'jeanne-darc-pyramides', artist: 'Emmanuel Frémiet', keywords: ['jeanne arc', 'pyramides', 'equestrian'] },
  { id: 'marianne', name: 'Marianne, Place de la République', source: 'streetrunner - marianne place de la republique - marianne part.glb', packed: 'marianne', artist: 'Léopold Morice', keywords: ['marianne', 'republique'] },
  { id: 'marianne-lion', name: 'Lion, Monument à la République', source: 'streetrunner - marianne monument la republique - lion part.glb', packed: 'marianne-lion', artist: 'Léopold Morice', keywords: ['lion', 'republique'] },
  { id: 'henri-iv', name: 'Henri IV, Pont Neuf', source: 'streetrunner -henry iv equestrian at pont neuf.glb', packed: 'henri-iv', artist: 'François-Frédéric Lemot', keywords: ['henri iv', 'pont neuf', 'equestrian'] },
  { id: 'danton', name: 'Georges Danton, Carrefour de l’Odéon', source: 'streetrunner- danton.glb', packed: 'danton', artist: 'Auguste Paris', keywords: ['danton', 'odeon'] },
];

async function ensureIndexFile(name: string, description: string, folder: string): Promise<void> {
  const path = join(process.cwd(), INDEX_DIR, indexFileName(name));
  if (existsSync(path)) return;
  await mkdir(join(process.cwd(), INDEX_DIR), { recursive: true });
  await writeFile(path, serializeIndex({ ...emptyIndex(name, { ...DEFAULTS, folder }), description }));
}

const day = async (p: string) => (await stat(p)).mtime.toISOString().slice(0, 10);

async function main(): Promise<void> {
  await ensureIndexFile('assetkit-statues-paris', 'Tripo statues of Paris monuments, from Street Runner (Cycle Dash)', 'statues/paris');
  await ensureIndexFile('assetkit-statues-sf', 'Tripo statues of San Francisco monuments, from Street Runner (Cycle Dash)', 'statues/sf');
  const repo = await loadRepo();
  const has = (index: string, id: string) => !!repo.indexes.find((l) => l.name === index)?.index.assets.some((a) => a.id === id);
  let n = 0;

  for (const s of PARIS) {
    if (has('assetkit-statues-paris', s.id)) continue;
    const src = s.source ? join(SR, 'incoming_models', s.source) : undefined;
    const prod = s.packed ? join(SR, 'public', 'models', 'paris', `${s.packed}.glb`) : undefined;
    const files = [src, prod].filter((p): p is string => !!p && existsSync(p));
    if (!files.length) {
      console.warn(`skip ${s.id}: no files`);
      continue;
    }
    const asset: Partial<Asset> = {
      id: s.id,
      name: s.name,
      ...(s.artist ? { artist: s.artist } : {}),
      creationDate: await day(files[0]!),
      assetKeywords: s.keywords,
      ...(s.mirror ? { generator: { script: PACK, params: { mirror: true, from: 'cirque-horseman-left' } } } : {}),
      notes: 'Tripo output, normalised to about 1 unit tall: scale to the real monument when placing.',
      extra: { streetrunner: { source: s.source, packed: s.packed ? `public/models/paris/${s.packed}.glb` : undefined } },
      ...s.extra,
    };
    if (src && existsSync(src)) {
      await addFile(repo, { index: 'assetkit-statues-paris', src, assetId: s.id, asset, file: { isSource: true, fileKeywords: ['tripo'], fileNote: 'Tripo original, as exported' } });
    }
    if (prod && existsSync(prod)) {
      await addFile(repo, {
        index: 'assetkit-statues-paris',
        src: prod,
        assetId: s.id,
        asset,
        file: { isProd: true, fileKeywords: ['game'], fileNote: `Repacked by ${PACK}: welded, quantized (KHR_mesh_quantization), WebP textures ≤ 1024 px${s.mirror ? ', mirrored' : ''}` },
      });
    }
    n++;
  }

  // reference photos and work in progress for statues still to be modelled live in assetkit's statues_to_model/ (gitignored)
  const adm = join(import.meta.dirname, '..', 'statues_to_model', 'admission-day-monument', 'admission_day_needs_bronze.glb');
  if (existsSync(adm) && !has('assetkit-statues-sf', 'admission-day-monument')) {
    const commons = (t: string) => `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(t.replace(/ /g, '_'))}`;
    await addFile(repo, {
      index: 'assetkit-statues-sf',
      src: adm,
      asset: {
        id: 'admission-day-monument',
        name: 'Admission Day Monument (flag-bearer)',
        artist: 'Douglas Tilden',
        description: "Bronze 'Native Son' flag-bearer atop the Admission Day Monument (1897), Market, Montgomery and Post Streets, celebrating California's admission to the Union in 1850.",
        creationDate: await day(adm),
        height: 2,
        shader: 'bronze',
        assetKeywords: ['admission day', 'native sons', 'market street'],
        aiSourceUrls: [
          commons('Flag waver - Admission Day Monument - San Francisco - DSC03533.JPG'),
          commons('Flag waver - Admission Day Monument - San Francisco - DSC03527.JPG'),
        ],
        notes: 'Untextured Tripo model: shade as bronze. Source photos are Wikimedia Commons, CC-BY-SA (check each file page). Model normalised to about 1 unit tall; the real figure is about 2 m.',
        extra: { streetrunner: { reference: 'statues_to_model/admission-day-monument/about.md' } },
      },
      file: { isSource: true, fileKeywords: ['tripo'], fileNote: 'Tripo original, as exported' },
    });
    n++;
  }
  console.log(`${n} statue(s) added`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
