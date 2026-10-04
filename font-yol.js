'use strict';
const fs = require('fs');
function font(bold = false) {
  const candidates = [
    process.env[bold ? 'VIDEO_FONT_BOLD' : 'VIDEO_FONT'],
    bold ? 'C:/Windows/Fonts/arialbd.ttf' : 'C:/Windows/Fonts/arial.ttf',
    `/System/Library/Fonts/Supplemental/Arial${bold ? ' Bold' : ''}.ttf`,
    `/usr/share/fonts/truetype/dejavu/DejaVuSans${bold ? '-Bold' : ''}.ttf`,
  ].filter(Boolean);
  const selected = candidates.find(p => fs.existsSync(p));
  if (!selected) throw new Error('Set VIDEO_FONT and VIDEO_FONT_BOLD to installed font paths.');
  return selected.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}
module.exports = font;
