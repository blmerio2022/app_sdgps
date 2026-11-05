import { classifyColorMode, compressionLabel, parseExifDate, readExifDate } from './piece-image-meta.util';

/**
 * Construit un JPEG MINIMAL porteur d'un segment EXIF APP1 contenant `DateTimeOriginal`
 * (dans la sous-IFD Exif) — de quoi exercer le parcours complet du parseur :
 * SOI → APP1 → en-tête TIFF → IFD0 → pointeur sous-IFD → tag 0x9003.
 */
function jpegWithExif(dateAscii: string, littleEndian = true): File {
  const ascii = dateAscii + '\0';                 // 20 octets attendus par l'EXIF
  // Disposition dans le bloc TIFF : [0] en-tête (8) [8] IFD0 [.] sous-IFD [.] chaîne ASCII
  const ifd0 = 8;
  const subIfd = ifd0 + 2 + 12 + 4;               // 1 entrée + offset IFD suivant
  const strOff = subIfd + 2 + 12 + 4;
  const tiffLen = strOff + ascii.length;

  const tiff = new DataView(new ArrayBuffer(tiffLen));
  const le = littleEndian;
  tiff.setUint16(0, le ? 0x4949 : 0x4D4D);        // boutisme
  tiff.setUint16(2, 0x002A, le);                  // magie 42
  tiff.setUint32(4, ifd0, le);                    // offset IFD0

  tiff.setUint16(ifd0, 1, le);                    // IFD0 : 1 entrée
  tiff.setUint16(ifd0 + 2, 0x8769, le);           // tag pointeur sous-IFD Exif
  tiff.setUint16(ifd0 + 4, 4, le);                // type LONG
  tiff.setUint32(ifd0 + 6, 1, le);                // count
  tiff.setUint32(ifd0 + 10, subIfd, le);          // valeur = offset sous-IFD
  tiff.setUint32(ifd0 + 14, 0, le);               // pas d'IFD suivante

  tiff.setUint16(subIfd, 1, le);                  // sous-IFD : 1 entrée
  tiff.setUint16(subIfd + 2, 0x9003, le);         // DateTimeOriginal
  tiff.setUint16(subIfd + 4, 2, le);              // type ASCII
  tiff.setUint32(subIfd + 6, ascii.length, le);   // count
  tiff.setUint32(subIfd + 10, strOff, le);        // offset de la chaîne
  tiff.setUint32(subIfd + 14, 0, le);
  for (let i = 0; i < ascii.length; i++) tiff.setUint8(strOff + i, ascii.charCodeAt(i));

  // Enveloppe JPEG : SOI (FFD8) + APP1 (FFE1, taille, « Exif\0\0 », bloc TIFF).
  const payload = 2 + 6 + tiffLen;                // taille APP1 (inclut ses 2 octets)
  const out = new Uint8Array(4 + payload);
  const dv = new DataView(out.buffer);
  dv.setUint16(0, 0xFFD8);                        // SOI
  dv.setUint16(2, 0xFFE1);                        // APP1
  dv.setUint16(4, payload);
  out.set([0x45, 0x78, 0x69, 0x66, 0, 0], 6);     // « Exif\0\0 »
  out.set(new Uint8Array(tiff.buffer), 12);
  return new File([out], 'photo.jpg', { type: 'image/jpeg' });
}

describe('piece-image-meta.util', () => {
  describe('compressionLabel', () => {
    it('reprend les libellés du serveur selon le format', () => {
      expect(compressionLabel('a.jpg')).toBe('JPEG (avec perte)');
      expect(compressionLabel('a.JPEG')).toBe('JPEG (avec perte)');
      expect(compressionLabel('a.png')).toBe('Deflate/ZIP (sans perte)');
      expect(compressionLabel('a.gif')).toBe('LZW (sans perte)');
      expect(compressionLabel('a.webp')).toBe('WebP');
    });

    it('reste vide pour le TIFF (compression lue seulement à l’import) et l’inconnu', () => {
      expect(compressionLabel('a.tif')).toBe('');
      expect(compressionLabel('a.tiff')).toBe('');
      expect(compressionLabel('sans-extension')).toBe('');
    });
  });

  describe('parseExifDate', () => {
    it('lit le format EXIF « YYYY:MM:DD HH:MM:SS »', () => {
      const d = parseExifDate('2026:03:15 14:30:05')!;
      expect(d.getFullYear()).toBe(2026);
      expect(d.getMonth()).toBe(2);       // mars (0-indexé)
      expect(d.getDate()).toBe(15);
      expect(d.getHours()).toBe(14);
      expect(d.getMinutes()).toBe(30);
      expect(d.getSeconds()).toBe(5);
    });

    it('rejette une valeur absente ou mal formée', () => {
      expect(parseExifDate('')).toBeNull();
      expect(parseExifDate('15/03/2026')).toBeNull();
      expect(parseExifDate(null as any)).toBeNull();
    });
  });

  describe('readExifDate', () => {
    it('extrait DateTimeOriginal d’un JPEG petit-boutiste', async () => {
      const d = await readExifDate(jpegWithExif('2026:03:15 14:30:05', true));
      expect(d).not.toBeNull();
      expect(d!.getFullYear()).toBe(2026);
      expect(d!.getDate()).toBe(15);
      expect(d!.getHours()).toBe(14);
    });

    it('extrait DateTimeOriginal d’un JPEG grand-boutiste', async () => {
      const d = await readExifDate(jpegWithExif('2024:12:01 08:05:00', false));
      expect(d).not.toBeNull();
      expect(d!.getFullYear()).toBe(2024);
      expect(d!.getMonth()).toBe(11);
      expect(d!.getDate()).toBe(1);
    });

    it('renvoie null pour un fichier sans EXIF (PNG, contenu quelconque)', async () => {
      expect(await readExifDate(new File(['pas un jpeg'], 'a.png'))).toBeNull();
      expect(await readExifDate(new File([new Uint8Array([0xFF, 0xD8])], 'court.jpg'))).toBeNull();
    });
  });

  describe('classifyColorMode', () => {
    /** Fabrique un <canvas> rempli d'une couleur unie, utilisable comme source de dessin. */
    function painted(r: number, g: number, b: number): any {
      const c = document.createElement('canvas');
      c.width = 8; c.height = 8;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(0, 0, 8, 8);
      // `drawImage` accepte un canvas ; on simule les propriétés lues par la fonction.
      Object.defineProperty(c, 'naturalWidth', { value: 8 });
      Object.defineProperty(c, 'naturalHeight', { value: 8 });
      return c;
    }

    it('distingue couleur, niveaux de gris et noir & blanc', () => {
      expect(classifyColorMode(painted(200, 30, 30))).toBe('Couleur');
      expect(classifyColorMode(painted(128, 128, 128))).toBe('Niveaux de gris');
      expect(classifyColorMode(painted(0, 0, 0))).toBe('Noir & blanc');
      expect(classifyColorMode(painted(255, 255, 255))).toBe('Noir & blanc');
    });

    it('renvoie une chaîne vide si les pixels ne sont pas lisibles', () => {
      expect(classifyColorMode({ naturalWidth: 0, naturalHeight: 0 } as any)).toBe('');
    });
  });
});
