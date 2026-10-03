// Reads a Mixamo FBX in Node with three's FBXLoader. Embedded textures are
// captured as raw bytes (the loader turns them into blob URLs; there is no DOM
// to decode images here) and returned by URL on `texture.userData.url`.
import fs from 'node:fs';
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

const blobs = new Map();
const createObjectURL = URL.createObjectURL.bind(URL);
URL.createObjectURL = (blob) => {
  const url = createObjectURL(blob);
  blobs.set(url, blob);
  return url;
};
THREE.TextureLoader.prototype.load = function (url) {
  const t = new THREE.Texture();
  t.userData.url = url;
  return t;
};

/** Parsed FBX scene (with animations on `.animations`) from a path or the file's bytes. */
export function readFbx(file) {
  const buf = trimFooter(Buffer.isBuffer(file) ? file : fs.readFileSync(file));
  return new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
}

/**
 * Some Mixamo exports carry a footer FBXLoader's end-of-content guess misreads
 * (it then parses the footer as a node and throws). Cut binary files after the
 * top-level null record and append a zeroed footer of the size it expects.
 */
function trimFooter(buf) {
  if (buf.toString('latin1', 0, 18) !== 'Kaydara FBX Binary') return buf;
  const version = buf.readUInt32LE(23);
  const wide = version >= 7500;
  let off = 27;
  while (off < buf.length) {
    const end = wide ? Number(buf.readBigUInt64LE(off)) : buf.readUInt32LE(off);
    if (end === 0) {
      const nullEnd = off + (wide ? 25 : 13);
      return Buffer.concat([buf.subarray(0, nullEnd), Buffer.alloc(176)]);
    }
    off = end;
  }
  return buf;
}

/** Bytes of an embedded texture captured during parsing, or null. */
export async function textureBytes(tex) {
  const blob = tex?.userData?.url && blobs.get(tex.userData.url);
  return blob ? Buffer.from(await blob.arrayBuffer()) : null;
}
