import { Injectable } from '@angular/core';

/** Un document PDF ouvert : nombre de pages et rendu d'une page dans un canvas. */
export interface PdfDocumentHandle {
  numPages: number;
  /** Rend la page `pageNumber` (1-indexée) à la largeur `targetWidth` (px), rotation
   * supplémentaire `rotation` (0/90/180/270) appliquée par pdf.js. */
  renderPage(pageNumber: number, targetWidth: number, rotation?: number): Promise<HTMLCanvasElement>;
  destroy(): void;
}

/**
 * Rendu de PDF dans le navigateur (pdf.js), chargé À LA DEMANDE : la bibliothèque pèse
 * plusieurs centaines de Ko et ne sert qu'à l'import d'un PDF d'images — elle ne doit pas
 * alourdir le chargement de l'application. Le worker est servi depuis
 * `assets/pdfjs/pdf.worker.min.js` (copié par `angular.json`).
 *
 * Pourquoi côté navigateur : le serveur ne sait pas rendre une page PDF en image (pypdf
 * lit la structure, pas le rendu). Rendre ici permet en plus à l'opérateur de VOIR les
 * pages et de les trier AVANT tout envoi — seules les pages retenues partent, déjà en
 * images, dans le circuit d'upload existant.
 */
@Injectable({ providedIn: 'root' })
export class PdfRenderService {
  private lib: Promise<any> | null = null;

  private load(): Promise<any> {
    if (!this.lib) {
      this.lib = import('pdfjs-dist/legacy/build/pdf').then((m: any) => {
        const pdfjs = m.default ?? m;
        pdfjs.GlobalWorkerOptions.workerSrc = 'assets/pdfjs/pdf.worker.min.js';
        return pdfjs;
      });
    }
    return this.lib;
  }

  static isPdf(file: File): boolean {
    return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  }

  async open(file: File): Promise<PdfDocumentHandle> {
    const pdfjs = await this.load();
    const data = new Uint8Array(await file.arrayBuffer());
    const doc = await pdfjs.getDocument({ data }).promise;
    return {
      numPages: doc.numPages,
      async renderPage(pageNumber: number, targetWidth: number, rotation = 0): Promise<HTMLCanvasElement> {
        const page = await doc.getPage(pageNumber);
        const rot = ((page.rotate || 0) + rotation) % 360;
        const base = page.getViewport({ scale: 1, rotation: rot });
        const viewport = page.getViewport({ scale: targetWidth / base.width, rotation: rot });
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#ffffff';                     // pages transparentes → fond blanc
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        // Intention « print » : le rendu « display » est cadencé par requestAnimationFrame,
        // suspendu par le navigateur dans un onglet en arrière-plan — la conversion se
        // figeait dès que l'opérateur changeait d'onglet. On produit des images, pas un
        // affichage interactif : l'intention d'impression est la bonne.
        await page.render({ canvasContext: ctx, viewport, intent: 'print' }).promise;
        page.cleanup();
        return canvas;
      },
      destroy: () => { doc.destroy(); },
    };
  }
}

/** Boîte englobante du contenu non blanc d'un canvas (pour rogner les marges). */
export function contentBounds(canvas: HTMLCanvasElement, threshold = 245): { x: number; y: number; w: number; h: number } {
  const { width, height } = canvas;
  const data = canvas.getContext('2d')!.getImageData(0, 0, width, height).data;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i] < threshold || data[i + 1] < threshold || data[i + 2] < threshold) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return { x: 0, y: 0, w: width, h: height };   // page blanche : on garde tout
  const pad = Math.round(Math.min(width, height) * 0.01);
  const x = Math.max(0, minX - pad), y = Math.max(0, minY - pad);
  return { x, y, w: Math.min(width, maxX + pad + 1) - x, h: Math.min(height, maxY + pad + 1) - y };
}

/** Encode un canvas en JPEG sous `maxBytes` : baisse la qualité, puis la taille. */
export async function canvasToJpeg(canvas: HTMLCanvasElement, name: string, maxBytes: number): Promise<File> {
  const toBlob = (c: HTMLCanvasElement, q: number) =>
    new Promise<Blob>((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('Encodage impossible'))), 'image/jpeg', q));
  let current = canvas;
  for (let attempt = 0; attempt < 6; attempt++) {
    for (const q of [0.92, 0.85, 0.75, 0.65]) {
      const blob = await toBlob(current, q);
      if (blob.size <= maxBytes) return new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() });
    }
    const smaller = document.createElement('canvas');
    smaller.width = Math.round(current.width * 0.8);
    smaller.height = Math.round(current.height * 0.8);
    smaller.getContext('2d')!.drawImage(current, 0, 0, smaller.width, smaller.height);
    current = smaller;
  }
  const blob = await toBlob(current, 0.6);
  return new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() });
}
