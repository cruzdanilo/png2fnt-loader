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
  const charset = new Set([...(options.charset || ' ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz.0123456789')]);
  const font = sharp(content).ensureAlpha().raw();
  const { data: alpha, info: { width: height, height: width } } = await font
    .clone().extractChannel(3).rotate(90).toBuffer({ resolveWithObject: true });
  const channels = 4;
  const lineLength = height * channels;
  const emptyLine = Buffer.alloc(lineLength).fill(Buffer.from([0x00, 0x00, 0x00, 0xff]));
  const chars = [];
  let x0 = 0;
  charSequence.forEach((char) => {
    for (let x = x0; x < width; x += 1) {
      if (!emptyLine.compare(alpha, x * lineLength, (x + 1) * lineLength)) {
        if (charset.has(char)) chars.push({ id: char.charCodeAt(), x: x0, width: x - x0 });
        x0 = x + 1;
        break;
      }
    }
  });
  const texture = await imagemin.buffer(await font.png().toBuffer(), { use: [optipng()] });
  const textureName = loaderUtils.interpolateName(this, options.name || '[name].[hash:8].png', { content: texture });
  const fontData = chars.reduce(
    (xml, char) => {
      xml.ele('char', {
        id: char.id,
        x: char.x,
        y: 0,
        width: char.width,
        height,
        xoffset: 0,
        yoffset: 0,
        xadvance: char.width + 1,
        page: 0,
      });
      return xml;
    },
    xmlbuilder.create('font')
      .ele('info', { face: path.parse(this.resourcePath).name, size: height })
      .up()
      .ele('common', {
        lineHeight: height,
        base: height,
        scaleW: width,
        scaleH: height,
        pages: 1,
      })
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
