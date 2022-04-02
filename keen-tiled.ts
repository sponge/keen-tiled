/// <reference types="@mapeditor/tiled-api" />

function decompress(buffer: ArrayBuffer): ArrayBuffer {
  const byteBuffer = new Uint8Array(buffer);
  const dataView = new DataView(buffer);

  const length = dataView.getUint32(0, true);
  let pos = 0;
  let out = [];

  // first dword is uncompressed size
  out = out.concat([...byteBuffer.slice(0, 4)])

  while (pos <= length) {
    console.log(`${pos} / ${length}`)

    // get a word
    const word = byteBuffer.slice(pos + 4, pos + 4 + 2);
    pos += 2;

    // is this word $FEFE?
    if (word[0] == 0xFE && word[1] == 0xFE) {
      // if yes, get the next two words
      const w1 = dataView.getUint16(pos + 4, true);
      pos += 2;
      const w2 = byteBuffer.slice(pos+4, pos+4+2);
      pos += 2;

      // copy word2 [word1] times and continue
      for (let i = 0; i < w1; i++) {
        out = out.concat([...w2]);
      }
    } else {
      // if no, copy the word and continue
      out = out.concat([...word]);
    }
  }

  return new Uint8Array(out).buffer;
}

interface KeenMap {
  tiles: Array<Array<number>>;
  sprites: Array<Array<number>>;
}

function encode(tmap : KeenMap): ArrayBuffer {
  const tiles = tmap.tiles.reduce((a, b) => a.concat(b), []);
  const sprites = tmap.sprites.reduce((a, b) => a.concat(b), []);

  const sz = tiles.length * 4 + 36;
  const buffer = new ArrayBuffer(sz);
  const dataView = new DataView(buffer);

  // first dword is uncompressed size
  dataView.setUint32(0, sz - 4, true);

  // write width, height and planesize
  dataView.setUint16(4, tmap.tiles[0].length, true);
  dataView.setUint16(6, tmap.tiles.length, true);
  dataView.setUint16(8, 2, true);
  let tilemapSz = tmap.tiles[0].length * tmap.tiles.length * 2;
  let planeSz = (tilemapSz + 15) & -16;
  dataView.setUint16(18, planeSz, true);

  // // write tiles
  let offset = 36;
  for (let t of tiles) {
    dataView.setUint16(offset, t, true);
    offset += 2;
  }

  offset = 32 + planeSz + 4;
  for (let t of sprites) {
    dataView.setUint16(offset, t, true);
    offset += 2;
  }

  return buffer;
}

function decode(buffer: ArrayBuffer): KeenMap {
  // pos  len   what
  // 0    4     data size
  // 4    2     height in tiles
  // 6    2     width in tiles
  // 8    2     num of planes (2)
  // 18   2     planesize. 2 (h * w) rounded to multiples of 16
  // each plane is 2 * planesize, read top left to bottom right
  // tiles first, sprites second

  const dataView = new DataView(buffer);
  console.log(dataView);

  // get some metadata
  const width = dataView.getUint16(4, true);
  const height = dataView.getUint16(6, true);
  const psize = dataView.getUint16(18, true);
  
  const tmapDataView = new DataView(buffer, 36);
  let offset = 0;

  const tiles = [];
  for (let y = 0; y < height; y++) {
    let inner = [];
    for (let x = 0; x < width; x++) {
      const tile = tmapDataView.getUint16(offset, true);
      offset += 2;
      inner.push(tile);
    }
    tiles.push(inner);
  }

  offset = psize;
  const sprites = [];
  for (let y = 0; y < height; y++) {
    let inner = [];
    for (let x = 0; x < width; x++) {
      const tile = tmapDataView.getUint16(offset, true);
      offset += 2;
      inner.push(tile);
    }
    sprites.push(inner);
  }

  return {tiles, sprites};
}

function getKey<K,V>(map: Map<K, V>, val: V ): K {
  return [...map].find(([k, v]) => val === v)[0];
}

function customMapFormat(name: string, extension: string, tilesetImgPath: string, objMap: Map<number, string>) {
  return {
    name,
    extension,

    write: function(map: TileMap, fileName: string) : undefined | string {
      const kmap:KeenMap = { tiles: [], sprites: [] };

      const tileLayer:TileLayer = map.layerAt(0) as TileLayer;
      for (let y = 0; y < map.height; y++) {
        const inner = [];
        for (let x = 0; x < map.width; x++) {
          inner.push(tileLayer.tileAt(x, y).id);
        }
        kmap.tiles.push(inner);
      }

      if (map.layerAt(1).name != 'sprites' || !map.layerAt(1).isObjectLayer) {
        return 'the second layer must be an object layer called "sprites"';
      }
      
      const spriteLayer = map.layerAt(1) as ObjectGroup;
      for (let y = 0; y < map.height; y++) {
        const inner = [];
        for (let x = 0; x < map.width; x++) {
          inner.push(0);
        }
        kmap.sprites.push(inner);
      }

      for (let obj of spriteLayer.objects) {
        kmap.sprites[Math.floor(obj.y/16)][Math.floor(obj.x/16)] = getKey(objMap, obj.name) ?? 0;
      }

      const f = new BinaryFile(fileName, BinaryFile.WriteOnly);
      f.write(encode(kmap));
      f.commit();
    },

    read: function(filename: string): TileMap {
      const buffer = new BinaryFile(filename).readAll();
      const dec = decompress(buffer);
      const map = decode(dec);

      const tmap = new TileMap();
      tmap.setSize(map.tiles[0].length, map.tiles.length);
      tmap.setTileSize(16, 16);
      tmap.orientation = TileMap.Orthogonal;

      const img = new Image(tilesetImgPath);

      const tileset = new Tileset(name);
      tileset.setTileSize(16, 16);
      tileset.loadFromImage(img);
      tmap.addTileset(tileset);

      const tilelayer = new TileLayer('tiles');
      tilelayer.width = map.tiles[0].length;
      tilelayer.height = map.tiles.length;
      const editLayer = tilelayer.edit();

      for (let y = 0; y < map.tiles.length; y++) {
        for (let x = 0; x < map.tiles[y].length; x++) {
          editLayer.setTile(x, y, tileset.tiles[map.tiles[y][x]]);
        }
      }
      editLayer.apply();
      tmap.addLayer(tilelayer);

      const spriteLayer = new ObjectGroup('sprites');
      for (let y = 0; y < map.sprites.length; y++) {
        for (let x = 0; x < map.sprites[y].length; x++) {
          if (map.sprites[y][x] == 0) {
            continue;
          }
          const sprId = map.sprites[y][x];
          const obj = new MapObject(objMap.get(sprId) ?? sprId.toString());
          obj.size.width = 16;
          obj.size.height = 16;
          obj.x = x * 16;
          obj.y = y * 16;
          spriteLayer.addObject(obj);
        }
      }
      tmap.addLayer(spriteLayer);

      return tmap;
    }
  }
}

const k1obj = new Map<number, string>([
  [1, 'Yorp'],
  [2, 'Garg'],
  [3, 'Vort'],
  [4, 'Can'],
  [5, 'Tank'],
  [6, 'CannonUpRight'],
  [7, 'CannonUp'],
  [8, 'CannonDown'],
  [9, 'CannonUpLeft'],
  [10, 'Thread'],
  [255, 'Keen'],
]);

const k2obj = new Map<number, string>([
  [1, 'Grunt'],
  [2, 'Youth'],
  [3, 'Elite'],
  [4, 'Scrub'],
  [5, 'Guard'],
  [6, 'Platform'],
  [7, 'Spark'],
  [255, 'Keen'],
]);

const k3obj = new Map<number, string>([
  [1, 'Grunt'],
  [2, 'Youth'],
  [3, 'Woman'],
  [4, 'Meep'],
  [5, 'Ninja'],
  [6, 'Foob'],
  [7, 'Ball'],
  [8, 'Cube'],
  [9, 'Platform'],
  [10, 'Elevator'],
  [11, 'Grunt'],
  [12, 'Spark'],
  [13, 'Heart'],
  [14, 'WestTurret'],
  [15, 'NorthTurret'],
  [16, 'Arm'],
  [17, 'LeftLeg'],
  [18, 'RightLeg'],
  [255, 'Keen'],
]);

if (tiled) {
  tiled.registerMapFormat("keen1", customMapFormat("Commander Keen 1", "ck1", "ext:keen1.png", k1obj));
  tiled.registerMapFormat("keen2", customMapFormat("Commander Keen 2", "ck2", "ext:keen2.png", k2obj));
  tiled.registerMapFormat("keen3", customMapFormat("Commander Keen 3", "ck3", "ext:keen3.png", k3obj));
}

// import fs from 'fs';
// import crypto from 'crypto';

// const f = fs.readFileSync('/Users/sponge/source/keen-tiled/LEVEL01.CK1');
// const dec = decompress(new Uint8Array(f).buffer);
// console.log(crypto.createHash('md5').update(JSON.stringify(Array.from(new Uint8Array(dec).slice(36)))).digest('hex')  );
// const map = decode(dec);
// const map2 = encode(map);
// console.log(crypto.createHash('md5').update(JSON.stringify(Array.from(new Uint8Array(map2).slice(36)))).digest('hex')  );
// console.log('done');