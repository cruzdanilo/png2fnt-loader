const { basename, parse: parsePath } = require('path').posix;
const { getOptions, interpolateName } = require('loader-utils');
const { create } = require('xmlbuilder2');
const optipng = require('imagemin-optipng')();
const sharp = require('sharp');

const extRegex = /\.png(?!.*\.png)/;

const build = async (content, self) => {
  const {
    webp = true,
    immutable = true,
    prettyPrint = false,
    ignoreColumns = [],
    name = '[name].[contenthash:8].[ext]',
    context = self.rootContext,
    chars: charString = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,;:?!-_~#"\'&()[]|`/\\@°+=*%€$£¢<>©®',
    charset: charsetString = ` ${charString}`,
  } = getOptions(self) || {};
  const { resourcePath } = self;

  const charset = new Set([...charsetString]);
  const channels = 4;
  const chars = [];
  const font = sharp(content).ensureAlpha().raw().rotate(90);
  const {
    data: fontBuffer,
    info: { width: height, height: width },
  } = await font.toBuffer({ resolveWithObject: true });
  const alpha = await font.clone().extractChannel(3).toBuffer({ resolveWithObject: false });
  const rowLength = height * channels;
  const emptyLine = Buffer.alloc(rowLength).fill(Buffer.from([0x00, 0x00, 0x00, 0xff]));
  const charSequence = [...charString];
  const xIgnoreSet = new Set(ignoreColumns);
  let x0 = 0;
  charSequence.forEach((char) => {
    for (let x = x0; x < width; x += 1) {
      if (!xIgnoreSet.has(x) && !emptyLine.compare(alpha, x * rowLength, (x + 1) * rowLength)) {
        if (charset.has(char)) chars.push({ id: char.charCodeAt(), x: x0, width: x - x0 });
        x0 = x + 1;
        break;
      }
    }
  });
  x0 = 0;
  const stripped = Buffer.concat(chars.map((char) => {
    const { x } = char;
    Object.assign(char, { x: x0 });
    const charWidth = char.width + 1;
    x0 += charWidth;
    return fontBuffer.slice(x * rowLength, (x + charWidth) * rowLength);
  }));
  if (charset.has(' ') && !charSequence.includes(' ')) {
    const avgWidth = Math.round(chars.reduce((sum, char) => sum + char.width, 0) / chars.length);
    chars.push({ id: ' '.charCodeAt(), x: -avgWidth, width: avgWidth });
  }

  const sharpline = sharp(stripped,
    { raw: { width: height, height: stripped.length / rowLength, channels } }).rotate(270);
  const textures = await Promise.all([
    ['.png', optipng, sharpline.clone().png({ compressionLevel: 0 })],
    ...webp ? [
      ['.webp', (b) => b, sharpline.clone().webp({ quality: 100, lossless: true, reductionEffort: 6 })],
    ] : [],
  ].map(async ([ext, optimizer, pipeline]) => {
    const data = await optimizer(await pipeline.toBuffer());
    const filepath = interpolateName({ ...self, resourcePath: resourcePath.replace(extRegex, ext) },
      name, { context, content: data });
    self.emitFile(filepath, data, false, { immutable });
    return filepath;
  }));

  const fontDataBuffer = chars.reduce(
    (xml, char) => {
      xml.ele('char', { id: char.id, x: char.x, y: 0, width: char.width, height, xoffset: 0, yoffset: 0, xadvance: char.width + 1, page: 0 }); // eslint-disable-line object-curly-newline
      return xml;
    },
    create().ele('font')
      .ele('info', { face: parsePath(resourcePath).name.split('.font')[0], size: height })
      .up()
      .ele('common', { lineHeight: height, base: height, scaleW: width, scaleH: height, pages: 1 }) // eslint-disable-line object-curly-newline
      .up()
      .ele('pages')
      .ele('page', { id: 0, file: basename(textures[0]) })
      .up()
      .up()
      .ele('chars', { count: chars.length }),
  ).end({ prettyPrint });
  const fontData = interpolateName({ ...self, resourcePath: resourcePath.replace(extRegex, '.xml') },
    name, { context, content: fontDataBuffer });
  self.emitFile(fontData, fontDataBuffer, false, { immutable });
  return { fontData, textures };
};

const done = new Map();

module.exports = async function loader(content) {
  this.async();
  const contenthash = interpolateName(this, '[contenthash]', { content });
  if (!done.has(contenthash)) done.set(contenthash, await build(content, this));
  const { fontData, textures } = done.get(contenthash);
  this.callback(null, `export default {
  fontData: __webpack_public_path__ + ${JSON.stringify(fontData)},
  textures: [${textures.map((t) => `__webpack_public_path__ + ${JSON.stringify(t)}`).join(', ')}],
};`);
};

module.exports.raw = true;
