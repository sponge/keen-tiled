/// <reference types="@mapeditor/tiled-api" />

function decompressPlane(planeBuffer: ArrayBuffer) {
  const plane = new DataView(planeBuffer);
  
  const rlew = 0xCD + (0xAB << 8);
  var halfcompLen = plane.getUint16(0, true);
  var halfcomp = new Uint16Array(halfcompLen / 2); // RLEW-compressed data, extracted from the main Carmack compression
  var compPos = 2;
  var hcPos = 0;
  while (compPos < planeBuffer.byteLength) { // Carmack decompressor
    var bLow = plane.getUint8(compPos);
    var bHigh = plane.getUint8(compPos + 1);
    if (bHigh == 0xA7) { // Near pointer
      var shiftBack = plane.getUint8(compPos + 2);
      if (bLow == 0) { // Escape code
        halfcomp[hcPos] = (bHigh << 8) + shiftBack;
        hcPos++;
      } else {
        var startPos = hcPos - shiftBack;
        for (var k = 0; k < bLow; k++) {
          halfcomp[hcPos] = halfcomp[startPos + k];
          hcPos++;
        }
      }
      compPos += 3;
    } else if (bHigh == 0xA8) { // Far pointer
      if (bLow == 0) { // Escape code
        halfcomp[hcPos] = (bHigh << 8) + plane.getUint8(compPos + 2);
        hcPos++;
        compPos += 3;
      } else {
        var startPos = plane.getUint16(compPos + 2, true);
        for (var k = 0; k < bLow; k++) {
          halfcomp[hcPos] = halfcomp[startPos + k];
          hcPos++;
        }
        compPos += 4;
      }
    } else { // Literal
      halfcomp[hcPos] = (bHigh << 8) + bLow;
      hcPos++;
      compPos += 2;
    }
  }
  var decompLen = halfcomp[0];
  var decomp = new Uint16Array(decompLen / 2);
  hcPos = 1;
  var outPos = 0;
  while (outPos < decompLen / 2) { // RLEW decompressor
    var curWord = halfcomp[hcPos];
    if (curWord == rlew) {
      var runLen = halfcomp[hcPos + 1];
      var runVal = halfcomp[hcPos + 2];
      for (var k = 0; k < runLen; k++) {
        decomp[outPos] = runVal;
        outPos++;
      }
      hcPos += 3;
    } else { // Literal
      decomp[outPos] = curWord;
      outPos++;
      hcPos++;
    }
  }

  return decomp;
}

interface Plane {
  offset: number;
  length: number;
}

interface GalaxyMap {
  planes: ArrayBuffer[];
  width: number;
  height: number;
  name: string;
}

function loadMap(gamemaps: ArrayBuffer, maphead: ArrayBuffer, mapNum: number): GalaxyMap {
  const retMap = {'name': '', 'planes': [], 'width': 0, 'height': 0};
  const gamemapsView = new DataView(gamemaps);
  const mapheadView = new DataView(maphead);

  const mapOffset = mapheadView.getUint32(2 + (mapNum * 4), true);

  if (mapOffset == 0) {
    // invalid map
    return;
  }

  const planes: Plane[] = [];

  let curr = 0;
  // read plane data
  for (let i = 0; i < 3; i++) {
    const offset = gamemapsView.getUint32(mapOffset + (i * 4), true);
    curr = mapOffset + 12 + (i * 2);
    if (offset <= 0) continue;
    const length = gamemapsView.getUint16(curr, true);
    planes.push({ offset, length })
  }
  curr += 2;

  // map metadata is the next chunk
  retMap.width = gamemapsView.getUint16(curr, true);
  curr += 2;
  retMap.height = gamemapsView.getUint16(curr, true);
  curr += 2;

  // read map name as a null delimited string
  const chars: number[] = [];
  for (let i = 0; i < 16; i++) {
    chars.push(gamemapsView.getUint8(curr));
    curr += 1;
  }
  retMap.name = String.fromCharCode(...chars);

  const decompPlanes:ArrayBuffer[] = [];
  for (let plane of planes) {
    const planeBuffer = gamemapsView.buffer.slice(plane.offset, plane.offset + plane.length);
    const decompPlane = decompressPlane(planeBuffer);
    retMap.planes.push(decompPlane);
  }

  return retMap;
}

function customGalaxyMapFormat(name: string, extension: string, bgTilesetImgPath: string, fgTilesetImgPath: string) {
  return {
    name,
    extension,

    read: function(filename: string): TileMap {
      const gamemapsBuffer = new BinaryFile(filename).readAll();
      const mapheadBuffer = new BinaryFile("ext:maphead.ck4").readAll();
      tiled.log(`maphead length is ${mapheadBuffer.byteLength}`);

      const mapNumStr = tiled.prompt("Enter map number", "0", "Load Keen Map");
      const mapNum = parseInt(mapNumStr, 10);
      if (mapNum < 0 || mapNum > 100) {
        throw new Error("Invalid map number");
      }

      const map = loadMap(gamemapsBuffer, mapheadBuffer, mapNum);

      const tmap = new TileMap();
      tmap.setSize(map.width, map.height);
      tmap.setTileSize(16, 16);
      tmap.orientation = TileMap.Orthogonal;

      // background
      const bgTileset = new Tileset("bg");
      bgTileset.setTileSize(16, 16);
      bgTileset.image = bgTilesetImgPath;
      tmap.addTileset(bgTileset);

      const bgLayer = new TileLayer('bg');
      bgLayer.width = map.width;
      bgLayer.height = map.height
      const editBgLayer = bgLayer.edit();

      for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) {
          editBgLayer.setTile(x, y, bgTileset.tiles[map.planes[0][y * map.width + x]]);
        }
      }

      editBgLayer.apply();
      tmap.addLayer(bgLayer);

      // foreground
      const fgTileset = new Tileset("fg");
      fgTileset.setTileSize(16, 16);
      fgTileset.image = fgTilesetImgPath;
      tmap.addTileset(fgTileset);

      const fgLayer = new TileLayer('fg');
      fgLayer.width = map.width;
      fgLayer.height = map.height
      const editFgLayer = fgLayer.edit();

      for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) {
          editFgLayer.setTile(x, y, fgTileset.tiles[map.planes[1][y * map.width + x]]);
        }
      }

      editFgLayer.apply();
      tmap.addLayer(fgLayer);

      const spriteLayer = new ObjectGroup('sprites');
      for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) {
          const sprId = map.planes[2][y * map.width + x];
          if (sprId == 0) {
            continue;
          }
          const obj = new MapObject(sprId.toString());
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

if (tiled) {
  tiled.registerMapFormat("keen4", customGalaxyMapFormat("Commander Keen 4", "ck4", "ext:keen4_bg.png", "ext:keen4_fg.png"));
  tiled.registerMapFormat("keen5", customGalaxyMapFormat("Commander Keen 5", "ck5", "ext:keen5_bg.png", "ext:keen5_fg.png"));
  tiled.registerMapFormat("keen6", customGalaxyMapFormat("Commander Keen 6", "ck6", "ext:keen6_bg.png", "ext:keen6_fg.png"));
}