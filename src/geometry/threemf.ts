import { indexMesh } from './indexMesh';

export interface Part {
  name: string;
  /** Triangle soup, 9 floats per triangle. */
  tris: Float32Array;
}

const esc = (s: string) => s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);
const num = (v: number) => String(Math.round(v * 1000) / 1000);

const CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8"?>\n'
  + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
  + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
  + '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>';

const RELS = '<?xml version="1.0" encoding="UTF-8"?>\n'
  + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + '<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>';

/** The 3D model part as UTF-8 bytes. Chunked so no single huge string is ever built. */
export function model3mf(parts: Part[]): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  const push = (s: string) => { const b = enc.encode(s); chunks.push(b); bytes += b.length; };

  push('<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources>');
  parts.forEach((p, i) => {
    const { positions, indices } = indexMesh(p.tris);
    push(`<object id="${i + 1}" name="${esc(p.name)}" type="model"><mesh><vertices>`);
    for (let v = 0; v < positions.length; v += 3 * 4000) {
      let s = '';
      for (let k = v; k < Math.min(positions.length, v + 3 * 4000); k += 3) {
        s += `<vertex x="${num(positions[k])}" y="${num(positions[k + 1])}" z="${num(positions[k + 2])}"/>`;
      }
      push(s);
    }
    push('</vertices><triangles>');
    for (let t = 0; t < indices.length; t += 3 * 4000) {
      let s = '';
      for (let k = t; k < Math.min(indices.length, t + 3 * 4000); k += 3) {
        s += `<triangle v1="${indices[k]}" v2="${indices[k + 1]}" v3="${indices[k + 2]}"/>`;
      }
      push(s);
    }
    push('</triangles></mesh></object>');
  });
  push('</resources><build>' + parts.map((_, i) => `<item objectid="${i + 1}"/>`).join('') + '</build></model>');

  const out = new Uint8Array(bytes);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

/** A 3MF file: a zip holding one indexed, compressed model. Slicers open it directly. */
export async function build3MF(parts: Part[]): Promise<Blob> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  zip.file('[Content_Types].xml', CONTENT_TYPES);
  zip.file('_rels/.rels', RELS);
  zip.file('3D/3dmodel.model', model3mf(parts));
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 }, mimeType: 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml' });
}
