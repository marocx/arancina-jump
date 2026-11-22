/* Oggetti estetici del personaggio: skin disegnate a pixel sopra lo sprite.
   Sblocchi in ordine di altezza: orecchie di gatto a 350 m, cappello a 1000 m, elmo a 10000 m.
   Gli oggetti bloccati appaiono come sagome nere. Ogni skin ha una griglia px con coordinate assolute nel fotogramma dello sprite (16×20). */
(() => {
  'use strict';

  const ITEMS = {
    // Skin ricreate a pixel dai disegni caricati (assets/skins/*.png)
    hat: {
      name: 'Cappello rosso', slot: 0,
      px: [[5,8,'#000000'],[6,8,'#000000'],[7,8,'#000000'],[8,8,'#000000'],[9,8,'#000000'],[10,8,'#000000'],[4,9,'#000000'],[5,9,'#ac3232'],[6,9,'#a62727'],[7,9,'#a62727'],[8,9,'#a62727'],[9,9,'#860303'],[10,9,'#860303'],[11,9,'#000000'],[4,10,'#000000'],[5,10,'#ac3232'],[6,10,'#ffffff'],[7,10,'#bcb7b7'],[8,10,'#bcb7b7'],[9,10,'#bcb7b7'],[10,10,'#860303'],[11,10,'#000000'],[4,11,'#000000'],[5,11,'#000000'],[6,11,'#000000'],[7,11,'#000000'],[8,11,'#000000'],[9,11,'#000000'],[10,11,'#000000'],[11,11,'#000000'],[12,11,'#000000'],[13,11,'#000000']],
      need: { type: 'best', value: 1000 }, needText: 'Raggiungi 1000 m',
    },
    knight: {
      name: 'Elmo', slot: 1,
      px: [[6,10,'#0d0d0d'],[7,10,'#0d0d0d'],[8,10,'#0d0d0d'],[9,10,'#0d0d0d'],[10,10,'#0d0d0d'],[5,11,'#0d0d0d'],[6,11,'#a4a4a4'],[7,11,'#737373'],[8,11,'#737373'],[9,11,'#737373'],[10,11,'#737373'],[11,11,'#0d0d0d'],[5,12,'#0d0d0d'],[6,12,'#a4a4a4'],[7,12,'#737373'],[8,12,'#737373'],[9,12,'#737373'],[10,12,'#737373'],[11,12,'#0d0d0d'],[5,13,'#0d0d0d'],[6,13,'#737373'],[7,13,'#000000'],[8,13,'#111111'],[9,13,'#000000'],[10,13,'#111111'],[11,13,'#0d0d0d'],[5,14,'#0d0d0d'],[6,14,'#737373'],[7,14,'#737373'],[8,14,'#737373'],[9,14,'#737373'],[10,14,'#4e4e4e'],[11,14,'#0d0d0d'],[5,15,'#0d0d0d'],[6,15,'#737373'],[7,15,'#737373'],[8,15,'#737373'],[9,15,'#737373'],[10,15,'#4e4e4e'],[11,15,'#0d0d0d'],[5,16,'#0d0d0d'],[6,16,'#737373'],[7,16,'#737373'],[8,16,'#737373'],[9,16,'#737373'],[10,16,'#4e4e4e'],[11,16,'#0d0d0d'],[6,17,'#0d0d0d'],[7,17,'#0d0d0d'],[8,17,'#0d0d0d'],[9,17,'#0d0d0d'],[10,17,'#0d0d0d']],
      need: { type: 'best', value: 10000 }, needText: 'Raggiungi 10000 m',
    },
    cat: {
      name: 'Orecchie di gatto', slot: 0,
      px: [[5,8,'#020202'],[4,9,'#020202'],[5,9,'#b67171'],[6,9,'#020202'],[11,9,'#020202'],[12,9,'#020202'],[4,10,'#020202'],[5,10,'#ad7171'],[6,10,'#000000'],[11,10,'#ad7171'],[12,10,'#020202'],[4,11,'#020202'],[5,11,'#000000']],
      need: { type: 'best', value: 350 }, needText: 'Raggiungi 350 m',
    },
  };

  // Ordine degli oggetti per slot (la stringa vuota = nessun oggetto)
  const SLOTS = [
    { label: 'Extra', ids: ['', 'cat'] },
    { label: 'Cappello', ids: ['', 'hat'] },
    { label: 'Elmo', ids: ['', 'knight'] },
  ];

  function isUnlocked(id, stats) {
    if (!id) return true;
    const it = ITEMS[id];
    if (!it) return false;
    const v = stats[it.need.type] || 0;
    return v >= it.need.value;
  }

  // Disegna l'oggetto con (x0, y0) = angolo in alto a sinistra del fotogramma dello sprite, s = scala.
  // warp (opzionale) = { top, refTop, k }: adatta le righe al fotogramma corrente dello sprite,
  // che può essere schiacciato, allungato o più in alto (salto, atterraggio, respiro), così la skin
  // segue il corpo invece di restare a coordinate fisse.
  function drawItem(c, id, x0, y0, s, warp) {
    const it = ITEMS[id];
    if (!it) return;
    c.save();
    for (const [px, py, color] of it.px) {
      c.fillStyle = color;
      if (warp) {
        const top = Math.round(warp.top + (py - warp.refTop) * warp.k);
        const bottom = Math.round(warp.top + (py + 1 - warp.refTop) * warp.k);
        c.fillRect(x0 + px * s, y0 + top * s, s, Math.max(1, bottom - top) * s);
      } else {
        c.fillRect(x0 + px * s, y0 + py * s, s, s);
      }
    }
    c.restore();
  }

  // Punto interrogativo pixel art (7×8) per gli oggetti ancora bloccati
  const UNKNOWN_ROWS = [
    '.#####.',
    '##...##',
    '....##.',
    '...##..',
    '..##...',
    '.......',
    '..##...',
    '..##...',
  ];
  function drawUnknown(c, x0, y0, s) {
    c.save();
    c.fillStyle = '#3a6d8a';
    UNKNOWN_ROWS.forEach((row, ry) => {
      for (let col = 0; col < row.length; col++) {
        if (row[col] === '#') c.fillRect(x0 + col * s, y0 + ry * s, s, s);
      }
    });
    c.restore();
  }

  // Disegna tutti gli oggetti equipaggiati (cos = [id per slot])
  function drawEquipped(c, cos, x0, y0, s, warp) {
    (cos || []).forEach((id) => { if (id && ITEMS[id]) drawItem(c, id, x0, y0, s, warp); });
  }

  window.Cosmetics = { ITEMS, SLOTS, isUnlocked, drawItem, drawEquipped, drawUnknown };
})();
