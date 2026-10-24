import { CLASSICO, parseSkin, skinOrder, type Skin } from '../shared/skins'

// Só p/ as rotas de QA (#preview, #preview-ui), que rodam sem IPC. O app real recebe as skins do registry no main.
const files = import.meta.glob('../../skins/*/skin.json', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>
const loaded = Object.entries(files).flatMap(([p, raw]) => { const r = parseSkin(raw, p.split('/').at(-2)!); return 'skin' in r ? [r.skin] : [] }).sort((a, b) => skinOrder(a.id, b.id))
export const PREVIEW_SKINS: Skin[] = [loaded.find((s) => s.id === CLASSICO.id) ?? CLASSICO, ...loaded.filter((s) => s.id !== CLASSICO.id)]
