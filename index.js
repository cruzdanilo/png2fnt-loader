const path = require('path');
const loaderUtils = require('loader-utils');
const imagemin = require('imagemin');
const optipng = require('imagemin-optipng');
const sharp = require('sharp');
const xmlbuilder = require('xmlbuilder');

const done = new Set();

module.exports = async function loader(content) {
  this.async();
  const options = loaderUtils.getOptions(this) || {};
  const outputPath = options.outputPath || path.posix.relative(this.rootContext, this.context);
  const charSequence = [...(options.chars || 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,;:?!-_~#"\'&()[]|`/\\@°+=*%€$£¢<>©®')];
  const charset = new Set([...(options.charset || ` ${charSequence}`)]);
  const ignoreColumns = new Set([...(options.ignoreColumns || [])]);
  const channels = 4;
  const font = sharp(content).ensureAlpha().raw().rotate(90);
  const {
    data: fontBuffer,
    info: { width: height, height: width },
  } = await font.toBuffer({ resolveWithObject: true });
  const alpha = await font.clone().extractChannel(3).toBuffer({ resolveWithObject: false });
  const rowLength = height * channels;
  const emptyLine = Buffer.alloc(rowLength).fill(Buffer.from([0x00, 0x00, 0x00, 0xff]));
  const chars = [];
  let x0 = 0;
  charSequence.forEach((char) => {
    for (let x = x0; x < width; x += 1) {
      if (!ignoreColumns.has(x) && !emptyLine.compare(alpha, x * rowLength, (x + 1) * rowLength)) {
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
  const texture = await imagemin.buffer(await sharp(
    stripped,
    { raw: { width: height, height: stripped.length / rowLength, channels } },
  ).rotate(270).png().toBuffer(), { use: [optipng()] });
  const textureName = loaderUtils.interpolateName(this, options.name || '[name].[hash:8].png', { content: texture });
  const fontData = chars.reduce(
    (xml, char) => {
      xml.ele('char', { id: char.id, x: char.x, y: 0, width: char.width, height, xoffset: 0, yoffset: 0, xadvance: char.width + 1, page: 0 }); // eslint-disable-line object-curly-newline
      return xml;
    },
    xmlbuilder.create('font')
      .ele('info', { face: path.parse(this.resourcePath).name, size: height })
      .up()
      .ele('common', { lineHeight: height, base: height, scaleW: width, scaleH: height, pages: 1 }) // eslint-disable-line object-curly-newline
      .up()
      .ele('pages')
      .ele('page', { id: 0, file: textureName })
      .up()
      .up()
      .ele('chars', { count: chars.length }),
  ).end({ pretty: true });
  const texturePath = path.posix.join(outputPath, textureName);
  const fontDataPath = path.posix.join(outputPath, loaderUtils.interpolateName(this, '[name].[hash:8].xml', { content: fontData }));
  if (!done.has(textureName)) {
    done.add(textureName);
    this.emitFile(texturePath, texture);
    this.emitFile(fontDataPath, fontData);
  }
  this.callback(null, `export default { texture: __webpack_public_path__ + ${JSON.stringify(texturePath)}, fontData: __webpack_public_path__ + ${JSON.stringify(fontDataPath)} };`);
};

module.exports.raw = true;
