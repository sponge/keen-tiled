/// <reference types="@mapeditor/tiled-api" />
/// <reference types="@types/node" />
function decompressPlane(planeBuffer) {
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
            }
            else {
                var startPos = hcPos - shiftBack;
                for (var k = 0; k < bLow; k++) {
                    halfcomp[hcPos] = halfcomp[startPos + k];
                    hcPos++;
                }
            }
            compPos += 3;
        }
        else if (bHigh == 0xA8) { // Far pointer
            if (bLow == 0) { // Escape code
                halfcomp[hcPos] = (bHigh << 8) + plane.getUint8(compPos + 2);
                hcPos++;
                compPos += 3;
            }
            else {
                var startPos = plane.getUint16(compPos + 2, true);
                for (var k = 0; k < bLow; k++) {
                    halfcomp[hcPos] = halfcomp[startPos + k];
                    hcPos++;
                }
                compPos += 4;
            }
        }
        else { // Literal
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
        }
        else { // Literal
            decomp[outPos] = curWord;
            outPos++;
            hcPos++;
        }
    }
    return decomp;
}
function loadMap(gamemaps, maphead, mapNum) {
    const gamemapsView = new DataView(gamemaps);
    const mapheadView = new DataView(maphead);
    const mapOffset = mapheadView.getUint32(2 + (mapNum * 4), true);
    if (mapOffset == 0) {
        // invalid map
        return;
    }
    const planes = [];
    let curr = 0;
    // read plane data
    for (let i = 0; i < 3; i++) {
        const offset = gamemapsView.getUint32(mapOffset + (i * 4), true);
        curr = mapOffset + 12 + (i * 2);
        if (offset <= 0)
            continue;
        const length = gamemapsView.getUint16(curr, true);
        planes.push({ offset, length });
    }
    curr += 2;
    // map metadata is the next chunk
    const width = gamemapsView.getUint16(curr, true);
    curr += 2;
    const height = gamemapsView.getUint16(curr, true);
    curr += 2;
    // read map name as a null delimited string
    const chars = [];
    for (let i = 0; i < 16; i++) {
        chars.push(gamemapsView.getUint8(curr));
        curr += 1;
    }
    let name = String.fromCharCode(...chars);
    for (let plane of planes) {
        const planeBuffer = gamemapsView.buffer.slice(plane.offset, plane.offset + plane.length);
        const rawPlane = decompressPlane(planeBuffer);
    }
    console.log(name);
}
const fs = require('fs');
const fmaps = fs.readFileSync('./GAMEMAPS.CK4');
const gamemaps = new Uint8Array(fmaps).buffer;
const fhead = fs.readFileSync('./MAPHEAD.CK4');
const maphead = new Uint8Array(fhead).buffer;
for (let i = 0; i < 100; i++) {
    loadMap(gamemaps, maphead, i);
}
//# sourceMappingURL=galaxy-tiled.js.map