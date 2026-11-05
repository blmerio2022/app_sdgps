/**
 * Métadonnées techniques d'une image LOCALE (choisie dans l'assistant, pas encore téléversée).
 *
 * Miroir CLIENT de `backend/pieces/imaging.py` : après téléversement, Pillow recalcule ces
 * mêmes informations et reste la source de vérité. Ce module ne sert qu'à les afficher dès
 * la sélection du fichier, pour que le panneau « Détails techniques » de l'assistant montre
 * les mêmes rubriques que la galerie de consultation d'une pièce.
 *
 * Les libellés produits sont volontairement IDENTIQUES à ceux du serveur (« Couleur »,
 * « Niveaux de gris », « JPEG (avec perte)»…) : une image ne doit pas changer de description
 * en passant de l'assistant à la page de consultation.
 */

/** Type d'image (mode couleur) — mêmes catégories que `_classify_mode` côté serveur. */
export type ColorMode = 'Couleur' | 'Niveaux de gris' | 'Noir & blanc' | '';

/**
 * Libellé de compression déduit de l'extension — reproduit la chaîne de `_compression_label`.
 *
 * Le TIFF fait exception : sa compression réelle (LZW, PackBits, Deflate…) est inscrite dans
 * un tag interne que seul le décodage serveur peut lire. On renvoie donc `''` (affiché « — »)
 * plutôt qu'une valeur inventée ; elle sera renseignée après l'import.
 */
export function compressionLabel(filename: string): string {
  const ext = (filename.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
  switch (ext) {
    case 'jpg': case 'jpeg': return 'JPEG (avec perte)';
    case 'png': return 'Deflate/ZIP (sans perte)';
    case 'gif': return 'LZW (sans perte)';
    case 'webp': return 'WebP';
    default: return '';           // tif/tiff & inconnus : lu à l'import
  }
}

/**
 * Classe le type d'image à partir des pixels — mêmes catégories que `_classify_mode`.
 *
 * L'image est échantillonnée sur une vignette de 64 px au plus, **sans lissage** : le
 * rééchantillonnage interpolé transformerait un noir & blanc pur en niveaux de gris et
 * fausserait le classement. Renvoie `''` si les pixels ne sont pas lisibles.
 */
export function classifyColorMode(img: HTMLImageElement): ColorMode {
  try {
    const w = Math.max(1, Math.min(64, img.naturalWidth));
    const h = Math.max(1, Math.min(64, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    let binaire = true;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (r !== g || g !== b) return 'Couleur';
      if (r !== 0 && r !== 255) binaire = false;
    }
    return binaire ? 'Noir & blanc' : 'Niveaux de gris';
  } catch {
    return '';
  }
}

/** `YYYY:MM:DD HH:MM:SS` — format de date EXIF (cf. `_parse_exif_datetime` côté serveur). */
export function parseExifDate(value: string): Date | null {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec((value || '').trim());
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  return isNaN(d.getTime()) ? null : d;
}

const TAG_DATETIME = 0x0132;           // DateTime (IFD0)
const TAG_EXIF_IFD = 0x8769;           // pointeur vers la sous-IFD Exif
const TAG_DATETIME_ORIGINAL = 0x9003;  // DateTimeOriginal (sous-IFD Exif)

/** Lit une date ASCII EXIF (19 caractères) pointée par une entrée d'IFD. */
function readAsciiDate(view: DataView, tiff: number, entry: number, le: boolean): Date | null {
  const count = view.getUint32(entry + 4, le);
  if (count < 19) return null;
  const off = tiff + view.getUint32(entry + 8, le);
  if (off < 0 || off + 19 > view.byteLength) return null;
  let s = '';
  for (let i = 0; i < 19; i++) s += String.fromCharCode(view.getUint8(off + i));
  return parseExifDate(s);
}

/**
 * Parcourt une IFD : renvoie `DateTimeOriginal` en priorité (via la sous-IFD Exif), sinon
 * `DateTime` — même ordre de préférence que le serveur.
 */
function readIfd(view: DataView, tiff: number, ifd: number, le: boolean, depth = 0): Date | null {
  if (depth > 2 || ifd < 0 || ifd + 2 > view.byteLength) return null;
  const count = view.getUint16(ifd, le);
  let dateTime: Date | null = null;
  let subIfd = 0;
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > view.byteLength) break;
    const tag = view.getUint16(entry, le);
    if (tag === TAG_DATETIME_ORIGINAL) {
      const d = readAsciiDate(view, tiff, entry, le);
      if (d) return d;
    } else if (tag === TAG_EXIF_IFD) {
      subIfd = view.getUint32(entry + 8, le);
    } else if (tag === TAG_DATETIME) {
      dateTime = readAsciiDate(view, tiff, entry, le);
    }
  }
  if (subIfd) {
    const d = readIfd(view, tiff, tiff + subIfd, le, depth + 1);
    if (d) return d;
  }
  return dateTime;
}

/** En-tête TIFF d'un bloc EXIF : boutisme, magie 42, offset de l'IFD0. */
function readTiffHeader(view: DataView, tiff: number): Date | null {
  if (tiff + 8 > view.byteLength) return null;
  const bom = view.getUint16(tiff);
  const le = bom === 0x4949;                       // 'II' = petit-boutiste
  if (!le && bom !== 0x4D4D) return null;          // 'MM' = grand-boutiste
  if (view.getUint16(tiff + 2, le) !== 0x002A) return null;
  return readIfd(view, tiff, tiff + view.getUint32(tiff + 4, le), le);
}

/**
 * Date de prise de vue d'un JPEG (segment EXIF APP1) — équivalent client de `date_creation`.
 *
 * Seuls les premiers 256 Ko sont lus : l'EXIF est toujours en tête de fichier. Renvoie `null`
 * pour un format sans EXIF (PNG, WebP, TIFF…) ou si le bloc est absent/illisible — la date
 * sera alors fixée par le serveur à l'import.
 */
export async function readExifDate(file: File): Promise<Date | null> {
  try {
    const buf = await file.slice(0, 256 * 1024).arrayBuffer();
    const view = new DataView(buf);
    if (view.byteLength < 4 || view.getUint16(0) !== 0xFFD8) return null;   // pas un JPEG
    let offset = 2;
    while (offset + 4 <= view.byteLength) {
      if (view.getUint8(offset) !== 0xFF) break;
      const marker = view.getUint8(offset + 1);
      const size = view.getUint16(offset + 2);
      // APP1 : vérifier la signature « Exif\0\0 » avant de parser l'en-tête TIFF.
      if (marker === 0xE1 && offset + 10 <= view.byteLength &&
          view.getUint32(offset + 4) === 0x45786966 /* 'Exif' */) {
        return readTiffHeader(view, offset + 10);
      }
      if (size < 2) break;
      offset += 2 + size;
    }
    return null;
  } catch {
    return null;
  }
}
