// A valid, deterministic PNG over Chromium's CSS variable size limit, without
// storing a multi-megabyte image fixture or depending on personal wallpapers.
module.exports = function largeWallpaper(png) {
  const data = Buffer.concat([Buffer.from('Comment\0'), Buffer.alloc(2 * 1024 * 1024, 65)]);
  const type = Buffer.from('tEXt');
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([type, data])) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length, 0); type.copy(chunk, 4); data.copy(chunk, 8);
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, chunk.length - 4);
  return Buffer.concat([png.subarray(0, -12), chunk, png.subarray(-12)]);
};
