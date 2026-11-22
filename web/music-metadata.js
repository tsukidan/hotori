"use strict";
// Read only title metadata, never artwork or executable/HTML content.
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
  window.HotoriMusicMetadata = { title };
})();
