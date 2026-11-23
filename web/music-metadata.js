"use strict";
// Read title metadata and the embedded front-cover image only. Artwork is accepted solely as
// size-limited PNG/JPEG bytes identified by file signature; no HTML, SVG or other content is read.
(() => {
  const safe = text => text.replace(/\0.*$/s, '').replace(/[\x00-\x1f]/g, '').trim().slice(0, 260);
  const synchsafe = (b, p) => (b[p] << 21) | (b[p+1] << 14) | (b[p+2] << 7) | b[p+3];
  function decode(bytes) {
    const encoding = bytes[0]; let data = bytes.subarray(1), label;
    if (encoding === 0) label = 'windows-1252';
    else if (encoding === 3) label = 'utf-8';
    else if (encoding === 2) label = 'utf-16be';
    else if (encoding === 1) { label = data[0] === 0xfe && data[1] === 0xff ? 'utf-16be' : 'utf-16le'; }
    else return '';
    return safe(new TextDecoder(label).decode(data));
  }
  async function title(file) {
    const bytes = new Uint8Array(await file.slice(0, 512 * 1024).arrayBuffer());
    try {
      if (String.fromCharCode(...bytes.subarray(0,3)) === 'ID3' && [2,3,4].includes(bytes[3]) && !(bytes[5] & 0x80)) {
        const version = bytes[3], end = Math.min(bytes.length, 10 + synchsafe(bytes,6));
        let p = 10;
        if (version >= 3 && (bytes[5] & 0x40)) p += version === 4 ? synchsafe(bytes,p) : 4 + new DataView(bytes.buffer).getUint32(p);
        const header = version === 2 ? 6 : 10;
        while (p + header <= end) {
          const id = String.fromCharCode(...bytes.subarray(p,p+(version===2?3:4)));
          if (!/^[A-Z0-9]+$/.test(id)) break;
          const size = version === 2 ? (bytes[p+3]<<16)|(bytes[p+4]<<8)|bytes[p+5] : version === 4 ? synchsafe(bytes,p+4) : new DataView(bytes.buffer).getUint32(p+4);
          if (!size || p + header + size > end) break;
          if (id === 'TIT2' || id === 'TT2') {
            if (version >= 3 && bytes[p+9]) break; // Unsupported frame transforms: fall back safely.
            const result = decode(bytes.subarray(p+header,p+header+size)); if (result) return result;
          }
          p += header + size;
        }
      }
      if (file.size >= 128) {
        const tail = new Uint8Array(await file.slice(-128).arrayBuffer());
        if (String.fromCharCode(...tail.subarray(0,3)) === 'TAG') { const result = safe(new TextDecoder('windows-1252').decode(tail.subarray(3,33))); if (result) return result; }
      }
    } catch { /* Malformed/oversized metadata must not prevent playing the song. */ }
    return safe(file.name.replace(/\.[^.]+$/, '')) || 'Untitled song';
  }
  const MAX_TAG = 16 * 1024 * 1024, MAX_ART = 8 * 1024 * 1024;
  const sniff = (b, p) => b[p] === 0x89 && b[p+1] === 0x50 && b[p+2] === 0x4e && b[p+3] === 0x47 && b[p+4] === 0x0d && b[p+5] === 0x0a && b[p+6] === 0x1a && b[p+7] === 0x0a ? 'image/png'
    : b[p] === 0xff && b[p+1] === 0xd8 && b[p+2] === 0xff ? 'image/jpeg' : '';
  // Returns the image as a Blob (PNG/JPEG) or null. Never throws: artwork must not block playback.
  async function cover(file) {
    try {
      const head = new Uint8Array(await file.slice(0, 10).arrayBuffer());
      if (String.fromCharCode(...head.subarray(0,3)) !== 'ID3' || ![2,3,4].includes(head[3]) || (head[5] & 0x80)) return null;
      const version = head[3], total = 10 + synchsafe(head,6);
      if (total > MAX_TAG || total > file.size) return null;
      const bytes = new Uint8Array(await file.slice(0, total).arrayBuffer()), view = new DataView(bytes.buffer);
      let p = 10;
      if (version >= 3 && (head[5] & 0x40)) p += version === 4 ? synchsafe(bytes,p) : 4 + view.getUint32(p);
      const header = version === 2 ? 6 : 10;
      let best = null;
      while (p + header <= total) {
        const id = String.fromCharCode(...bytes.subarray(p,p+(version===2?3:4)));
        if (!/^[A-Z0-9]+$/.test(id)) break;
        const size = version === 2 ? (bytes[p+3]<<16)|(bytes[p+4]<<8)|bytes[p+5] : version === 4 ? synchsafe(bytes,p+4) : view.getUint32(p+4);
        if (!size || p + header + size > total) break;
        if ((id === 'APIC' || id === 'PIC') && !(version >= 3 && bytes[p+9])) {
          let q = p + header; const end = q + size, encoding = bytes[q++];
          if (id === 'APIC') { while (q < end && bytes[q]) q++; q++; } else q += 3; // MIME type / 3-byte format
          const type = bytes[q++];
          if (encoding === 1 || encoding === 2) { while (q + 1 < end && (bytes[q] || bytes[q+1])) q += 2; q += 2; } else { while (q < end && bytes[q]) q++; q++; }
          const length = end - q, mime = q > 0 && q < end ? sniff(bytes, q) : '';
          if (mime && length > 0 && length <= MAX_ART && (!best || (type === 3 && best.type !== 3))) best = { type, mime, start: q, end };
        }
        p += header + size;
      }
      return best ? new Blob([bytes.slice(best.start, best.end)], { type: best.mime }) : null;
    } catch { return null; }
  }
  window.HotoriMusicMetadata = { title, cover };
})();
