/*!
 * Compressor.js v1.4.0
 * https://github.com/NightfallAutomotive/compression_for_website#readme
 *
 * Copyright 2018-present Chen Fengyuan
 * Copyright 2026 Robert Remblance
 * Released under the MIT license
 *
 * Date: 2026-10-16T21:13:52.701Z
 */

var DEFAULTS = {
  /**
   * Indicates whether to output the original image instead of the compressed one
   * when the size of the compressed image is greater than the original one's
   * @type {boolean}
   */
  strict: true,
  /**
   * Indicates whether to read the image's Exif Orientation information,
   * and then rotate or flip the image automatically.
   * @type {boolean}
   */
  checkOrientation: true,
  /**
   * Indicates whether to retain the image's Exif information after compression.
   * @type {boolean}
  */
  retainExif: false,
  /**
   * The max width of the output image.
   * @type {number}
   */
  maxWidth: Infinity,
  /**
   * The max height of the output image.
   * @type {number}
   */
  maxHeight: Infinity,
  /**
   * The min width of the output image.
   * @type {number}
   */
  minWidth: 0,
  /**
   * The min height of the output image.
   * @type {number}
   */
  minHeight: 0,
  /**
   * The width of the output image.
   * If not specified, the natural width of the source image will be used.
   * @type {number}
   */
  width: undefined,
  /**
   * The height of the output image.
   * If not specified, the natural height of the source image will be used.
   * @type {number}
   */
  height: undefined,
  /**
   * Sets how the size of the image should be resized to the container
   * specified by the `width` and `height` options.
   * @type {string}
   */
  resize: 'none',
  /**
   * The quality of the output image.
   * It must be a number between `0` and `1`,
   * and only available for `image/jpeg` and `image/webp` images.
   * Check out {@link https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob canvas.toBlob}.
   * @type {number}
   */
  quality: 0.8,
  /**
   * The mime type of the output image.
   * By default, the original mime type of the source image file will be used.
   * @type {string}
   */
  mimeType: 'auto',
  /**
   * Files whose file type is included in this list,
   * and whose file size exceeds the `convertSize` value will be converted to JPEGs.
   * @type {string|string[]}
   */
  convertTypes: ['image/png'],
  /**
   * PNG files over this size (5 MB by default) will be converted to JPEGs.
   * To disable this, just set the value to `Infinity`.
   * @type {number}
   */
  convertSize: 5000000,
  /**
   * The hook function to execute before drawing the image into the canvas for compression.
   * @type {Function}
   * @param {CanvasRenderingContext2D} context - The 2D rendering context of the canvas.
   * @param {HTMLCanvasElement} canvas - The canvas for compression.
   * @example
   * function (context, canvas) {
   *   context.fillStyle = '#fff';
   * }
   */
  beforeDraw: null,
  /**
   * The hook function to execute after drawing the image into the canvas for compression.
   * @type {Function}
   * @param {CanvasRenderingContext2D} context - The 2D rendering context of the canvas.
   * @param {HTMLCanvasElement} canvas - The canvas for compression.
   * @example
   * function (context, canvas) {
   *   context.filter = 'grayscale(100%)';
   * }
   */
  drew: null,
  /**
   * The hook function to execute when the image is compressed successfully.
   * @type {Function}
   * @param {File} file - The compressed image File object.
   * @example
   * function (file) {
   *   console.log(file);
   * }
   */
  success: null,
  /**
   * The hook function to execute when fail to compress the image.
   * @type {Function}
   * @param {Error} err - An Error object.
   * @example
   * function (err) {
   *   console.log(err.message);
   * }
   */
  error: null
};

const IS_BROWSER = typeof window !== 'undefined' && typeof window.document !== 'undefined';
const WINDOW = IS_BROWSER ? window : {};

/**
 * Check if the given value is a positive number.
 * @param {*} value - The value to check.
 * @returns {boolean} Returns `true` if the given value is a positive number, else `false`.
 */
const isPositiveNumber = value => value > 0 && value < Infinity;

/**
 * Check if the given value is a Blob (or File) object.
 * @param {*} value - The value to check.
 * @returns {boolean} Returns `true` if the given value is a Blob object, else `false`.
 */
function isBlob(value) {
  const {
    Blob
  } = WINDOW;
  if (!Blob) {
    return false;
  }

  // The `toString` check also matches Blobs created in another realm, such as an iframe
  return value instanceof Blob || Object.prototype.toString.call(value) === '[object Blob]';
}
const REGEXP_IMAGE_TYPE = /^image\/.+$/;

/**
 * Check if the given value is an image MIME type.
 * @param {*} value - The value to check.
 * @returns {boolean} Returns `true` if the given value is an image MIME type, else `false`.
 */
function isImageType(value) {
  return REGEXP_IMAGE_TYPE.test(value);
}

/**
 * Convert image type to extension.
 * @param {string} value - The image type to convert.
 * @returns {string} Returns the image extension.
 */
function imageTypeToExtension(value) {
  let extension = isImageType(value) ? value.slice(6) : '';
  if (extension === 'jpeg') {
    extension = 'jpg';
  }
  return `.${extension}`;
}
const {
  fromCharCode
} = String;

/**
 * Get string from char code in data view.
 * @param {DataView} dataView - The data view for read.
 * @param {number} start - The start index.
 * @param {number} length - The read length.
 * @returns {string} The read result.
 */
function getStringFromCharCode(dataView, start, length) {
  let str = '';
  let i;
  length += start;
  for (i = start; i < length; i += 1) {
    str += fromCharCode(dataView.getUint8(i));
  }
  return str;
}

/**
 * Check if `canvas.getContext('2d').getImageData` is available,
 * Firefox randomizes the output of that function in `privacy.resistFingerprinting` mode (#137)
 * @link https://github.com/nodeca/pica/blob/master/lib/utils.js
 * @returns {boolean} Returns `true` if it is available, else `false`.
 */
function isCanvasAvailable() {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 1;
    const context = canvas.getContext('2d');
    if (!context) return false;

    // Create 2x1 image data containing RGBA values for two pixels
    const imageData = context.createImageData(2, 1);

    // First pixel: R=12, G=23, B=34, A=255
    imageData.data[0] = 12;
    imageData.data[1] = 23;
    imageData.data[2] = 34;
    imageData.data[3] = 255;

    // Second pixel: R=45, G=56, B=67, A=255
    imageData.data[4] = 45;
    imageData.data[5] = 56;
    imageData.data[6] = 67;
    imageData.data[7] = 255;
    context.putImageData(imageData, 0, 0);
    const readBack = context.getImageData(0, 0, 2, 1);

    // Expected pixel data (matching the written values)
    const expected = [12, 23, 34, 255, 45, 56, 67, 255];

    // Compare element by element to ensure write and read consistency
    return readBack.data.every((value, index) => value === expected[index]);
  } catch (error) {
    return false;
  }
}
const {
  btoa
} = WINDOW;

/**
 * Transform array buffer to Data URL.
 * @param {ArrayBuffer} arrayBuffer - The array buffer to transform.
 * @param {string} mimeType - The MIME type of the Data URL.
 * @returns {string} The result Data URL.
 */
function arrayBufferToDataURL(arrayBuffer, mimeType) {
  const chunks = [];
  const chunkSize = 8192;
  let uint8 = new Uint8Array(arrayBuffer);
  while (uint8.length > 0) {
    chunks.push(fromCharCode(...uint8.subarray(0, chunkSize)));
    uint8 = uint8.subarray(chunkSize);
  }
  return `data:${mimeType};base64,${btoa(chunks.join(''))}`;
}

/**
 * Get orientation value from given array buffer.
 * @param {ArrayBuffer} arrayBuffer - The array buffer to read.
 * @returns {number} The read orientation value.
 */
function resetAndGetOrientation(arrayBuffer) {
  const dataView = new DataView(arrayBuffer);
  let orientation;

  // Ignores range error when the image does not have correct Exif information
  try {
    let littleEndian;
    let app1Start;
    let ifdStart;

    // Only handle JPEG image (start by 0xFFD8)
    if (dataView.getUint8(0) === 0xFF && dataView.getUint8(1) === 0xD8) {
      const length = dataView.byteLength;
      let offset = 2;
      while (offset + 1 < length) {
        if (dataView.getUint8(offset) === 0xFF && dataView.getUint8(offset + 1) === 0xE1) {
          app1Start = offset;
          break;
        }
        offset += 1;
      }
    }
    if (app1Start) {
      const exifIDCode = app1Start + 4;
      const tiffOffset = app1Start + 10;
      if (getStringFromCharCode(dataView, exifIDCode, 4) === 'Exif') {
        const endianness = dataView.getUint16(tiffOffset);
        littleEndian = endianness === 0x4949;
        if (littleEndian || endianness === 0x4D4D /* bigEndian */) {
          if (dataView.getUint16(tiffOffset + 2, littleEndian) === 0x002A) {
            const firstIFDOffset = dataView.getUint32(tiffOffset + 4, littleEndian);
            if (firstIFDOffset >= 0x00000008) {
              ifdStart = tiffOffset + firstIFDOffset;
            }
          }
        }
      }
    }
    if (ifdStart) {
      const length = dataView.getUint16(ifdStart, littleEndian);
      let offset;
      let i;
      for (i = 0; i < length; i += 1) {
        offset = ifdStart + i * 12 + 2;
        if (dataView.getUint16(offset, littleEndian) === 0x0112 /* Orientation */) {
          // 8 is the offset of the current tag's value
          offset += 8;

          // Get the original orientation value
          orientation = dataView.getUint16(offset, littleEndian);

          // Override the orientation with its default value
          dataView.setUint16(offset, 1, littleEndian);
          break;
        }
      }
    }
  } catch (e) {
    orientation = 1;
  }
  return orientation;
}

/**
 * Parse Exif Orientation value.
 * @param {number} orientation - The orientation to parse.
 * @returns {Object} The parsed result.
 */
function parseOrientation(orientation) {
  let rotate = 0;
  let scaleX = 1;
  let scaleY = 1;
  switch (orientation) {
    // Flip horizontal
    case 2:
      scaleX = -1;
      break;

    // Rotate left 180°
    case 3:
      rotate = -180;
      break;

    // Flip vertical
    case 4:
      scaleY = -1;
      break;

    // Flip vertical and rotate right 90°
    case 5:
      rotate = 90;
      scaleY = -1;
      break;

    // Rotate right 90°
    case 6:
      rotate = 90;
      break;

    // Flip horizontal and rotate right 90°
    case 7:
      rotate = 90;
      scaleX = -1;
      break;

    // Rotate left 90°
    case 8:
      rotate = -90;
      break;
  }
  return {
    rotate,
    scaleX,
    scaleY
  };
}
const REGEXP_DECIMALS = /\.\d*(?:0|9){12}\d*$/;

/**
 * Normalize decimal number.
 * Check out {@link https://0.30000000000000004.com/}
 * @param {number} value - The value to normalize.
 * @param {number} [times=100000000000] - The times for normalizing.
 * @returns {number} Returns the normalized number.
 */
function normalizeDecimalNumber(value, times = 100000000000) {
  return REGEXP_DECIMALS.test(value) ? Math.round(value * times) / times : value;
}

/**
 * Get the max sizes in a rectangle under the given aspect ratio.
 * @param {Object} data - The original sizes.
 * @param {string} [type='contain'] - The adjust type.
 * @returns {Object} The result sizes.
 */
function getAdjustedSizes({
  aspectRatio,
  height,
  width
},
// 'none' | 'contain' | 'cover'
type = 'none') {
  const isValidWidth = isPositiveNumber(width);
  const isValidHeight = isPositiveNumber(height);
  if (isValidWidth && isValidHeight) {
    const adjustedWidth = height * aspectRatio;
    if ((type === 'contain' || type === 'none') && adjustedWidth > width || type === 'cover' && adjustedWidth < width) {
      height = width / aspectRatio;
    } else {
      width = height * aspectRatio;
    }
  } else if (isValidWidth) {
    height = width / aspectRatio;
  } else if (isValidHeight) {
    width = height * aspectRatio;
  }
  return {
    width,
    height
  };
}

/**
 * Get Exif information from the given array buffer.
 * @param {ArrayBuffer} arrayBuffer - The array buffer to read.
 * @returns {Array} The read Exif information.
 */
function getExif(arrayBuffer) {
  const array = Array.from(new Uint8Array(arrayBuffer));
  const {
    length
  } = array;
  const segments = [];
  let start = 0;
  while (start + 3 < length) {
    const value = array[start];
    const next = array[start + 1];

    // SOS (Start of Scan)
    if (value === 0xFF && next === 0xDA) {
      break;
    }

    // SOI (Start of Image)
    if (value === 0xFF && next === 0xD8) {
      start += 2;
    } else {
      const offset = array[start + 2] * 256 + array[start + 3];
      const end = start + offset + 2;
      const segment = array.slice(start, end);
      segments.push(segment);
      start = end;
    }
  }
  return segments.reduce((exifArray, current) => {
    if (current[0] === 0xFF && current[1] === 0xE1) {
      return exifArray.concat(current);
    }
    return exifArray;
  }, []);
}

/**
 * Insert Exif information into the given array buffer.
 * @param {ArrayBuffer} arrayBuffer - The array buffer to transform.
 * @param {Array} exifArray - The Exif information to insert.
 * @returns {ArrayBuffer} The transformed array buffer.
 */
function insertExif(arrayBuffer, exifArray) {
  const array = Array.from(new Uint8Array(arrayBuffer));
  if (array[2] !== 0xFF || array[3] !== 0xE0) {
    return arrayBuffer;
  }
  const app0Length = array[4] * 256 + array[5];
  const newArrayBuffer = [0xFF, 0xD8].concat(exifArray, array.slice(4 + app0Length));
  return new Uint8Array(newArrayBuffer);
}

const {
  FileReader,
  URL
} = WINDOW;
const REGEXP_EXTENSION = /\.\w+$/;
const AnotherCompressor = WINDOW.Compressor;

/**
 * Creates a new image compressor.
 * @class
 */
class Compressor {
  /**
   * Create a new Compressor.
   * @param {File|Blob} file - The target image file to compress.
   * @param {Object} [options={}] - The configuration options.
   */
  constructor(file, options = {}) {
    this.file = file;
    this.exif = [];
    this.image = new Image();
    this.options = {
      ...DEFAULTS,
      ...options
    };
    this.aborted = false;
    this.result = null;
    this.init();
  }
  init() {
    const {
      file,
      options
    } = this;
    if (!isBlob(file)) {
      this.fail(new Error('The first argument must be a File or Blob object.'));
      return;
    }
    const mimeType = file.type;
    if (!isImageType(mimeType)) {
      this.fail(new Error('The first argument must be an image File or Blob object.'));
      return;
    }
    if (!URL || !FileReader) {
      this.fail(new Error('The current browser does not support image compression.'));
      return;
    }
    const isJPEGImage = mimeType === 'image/jpeg';
    const checkOrientation = isJPEGImage && options.checkOrientation;
    const retainExif = isJPEGImage && options.retainExif;
    if (!checkOrientation && !retainExif) {
      this.load({
        url: URL.createObjectURL(file)
      });
    } else {
      const reader = new FileReader();
      this.reader = reader;
      reader.onload = ({
        target
      }) => {
        const {
          result
        } = target;
        const data = {};
        let orientation = 1;
        if (checkOrientation) {
          // Reset the orientation value to its default value 1
          // as some iOS browsers will render image with its orientation
          orientation = resetAndGetOrientation(result);
          if (orientation > 1) {
            Object.assign(data, parseOrientation(orientation));
          }
        }
        if (retainExif) {
          this.exif = getExif(result);
        }

        // Generate a new URL with the default orientation value 1.
        if (orientation > 1) {
          data.url = arrayBufferToDataURL(result, mimeType);
        } else {
          data.url = URL.createObjectURL(file);
        }
        this.load(data);
      };
      reader.onabort = () => {
        this.fail(new Error('Aborted to read the image with FileReader.'));
      };
      reader.onerror = () => {
        this.fail(new Error('Failed to read the image with FileReader.'));
      };
      reader.onloadend = () => {
        this.reader = null;
      };
      reader.readAsArrayBuffer(file);
    }
  }
  load(data) {
    const {
      file,
      image
    } = this;
    image.onload = () => {
      if (isCanvasAvailable()) {
        this.draw({
          ...data,
          naturalWidth: image.naturalWidth,
          naturalHeight: image.naturalHeight
        });
      } else {
        this.done({
          naturalWidth: image.naturalWidth,
          naturalHeight: image.naturalHeight,
          result: null
        });
      }
    };
    image.onabort = () => {
      this.fail(new Error('Aborted to load the image.'));
    };
    image.onerror = () => {
      this.fail(new Error('Failed to load the image.'));
    };

    // Match all browsers that use WebKit as the layout engine in iOS devices,
    // such as Safari for iOS, Chrome for iOS, and in-app browsers.
    if (WINDOW.navigator && /(?:iPad|iPhone|iPod).*?AppleWebKit/i.test(WINDOW.navigator.userAgent)) {
      // Fix the `The operation is insecure` error (#57)
      image.crossOrigin = 'anonymous';
    }
    image.alt = file.name;
    image.src = data.url;
  }
  draw({
    naturalWidth,
    naturalHeight,
    rotate = 0,
    scaleX = 1,
    scaleY = 1
  }) {
    const {
      file,
      image,
      options
    } = this;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    const is90DegreesRotated = Math.abs(rotate) % 180 === 90;
    const resizable = (options.resize === 'contain' || options.resize === 'cover') && isPositiveNumber(options.width) && isPositiveNumber(options.height);
    let maxWidth = Math.max(options.maxWidth, 0) || Infinity;
    let maxHeight = Math.max(options.maxHeight, 0) || Infinity;
    let minWidth = Math.max(options.minWidth, 0) || 0;
    let minHeight = Math.max(options.minHeight, 0) || 0;
    let aspectRatio = naturalWidth / naturalHeight;
    let {
      width,
      height
    } = options;
    if (is90DegreesRotated) {
      [maxWidth, maxHeight] = [maxHeight, maxWidth];
      [minWidth, minHeight] = [minHeight, minWidth];
      [width, height] = [height, width];
    }
    if (resizable) {
      aspectRatio = width / height;
    }
    ({
      width: maxWidth,
      height: maxHeight
    } = getAdjustedSizes({
      aspectRatio,
      width: maxWidth,
      height: maxHeight
    }, 'contain'));
    ({
      width: minWidth,
      height: minHeight
    } = getAdjustedSizes({
      aspectRatio,
      width: minWidth,
      height: minHeight
    }, 'cover'));
    if (resizable) {
      ({
        width,
        height
      } = getAdjustedSizes({
        aspectRatio,
        width,
        height
      }, options.resize));
    } else {
      ({
        width = naturalWidth,
        height = naturalHeight
      } = getAdjustedSizes({
        aspectRatio,
        width,
        height
      }));
    }
    width = Math.floor(normalizeDecimalNumber(Math.min(Math.max(width, minWidth), maxWidth)));
    height = Math.floor(normalizeDecimalNumber(Math.min(Math.max(height, minHeight), maxHeight)));
    const destX = -width / 2;
    const destY = -height / 2;
    const destWidth = width;
    const destHeight = height;
    const params = [];
    if (resizable) {
      const {
        width: srcWidth,
        height: srcHeight
      } = getAdjustedSizes({
        aspectRatio,
        width: naturalWidth,
        height: naturalHeight
      }, {
        contain: 'cover',
        cover: 'contain'
      }[options.resize]);
      const srcX = (naturalWidth - srcWidth) / 2;
      const srcY = (naturalHeight - srcHeight) / 2;
      params.push(srcX, srcY, srcWidth, srcHeight);
    }
    params.push(destX, destY, destWidth, destHeight);
    if (is90DegreesRotated) {
      [width, height] = [height, width];
    }
    canvas.width = width;
    canvas.height = height;
    if (!isImageType(options.mimeType)) {
      options.mimeType = file.type;
    }
    let fillStyle = 'transparent';

    // Converts PNG files over the `convertSize` to JPEGs.
    if (file.size > options.convertSize && options.convertTypes.indexOf(options.mimeType) >= 0) {
      options.mimeType = 'image/jpeg';
    }
    const isJPEGImage = options.mimeType === 'image/jpeg';
    if (isJPEGImage) {
      fillStyle = '#fff';
    }

    // Override the default fill color (#000, black)
    context.fillStyle = fillStyle;
    context.fillRect(0, 0, width, height);
    if (options.beforeDraw) {
      options.beforeDraw.call(this, context, canvas);
    }
    if (this.aborted) {
      return;
    }
    context.save();
    context.translate(width / 2, height / 2);
    context.rotate(rotate * Math.PI / 180);
    context.scale(scaleX, scaleY);
    context.drawImage(image, ...params);
    context.restore();
    if (options.drew) {
      options.drew.call(this, context, canvas);
    }
    if (this.aborted) {
      return;
    }
    const callback = blob => {
      if (!this.aborted) {
        const done = result => this.done({
          naturalWidth,
          naturalHeight,
          result
        });
        if (blob && isJPEGImage && options.retainExif && this.exif && this.exif.length > 0) {
          blob.arrayBuffer().then(arrayBuffer => {
            done(new Blob([insertExif(arrayBuffer, this.exif)], {
              type: options.mimeType
            }));
          }).catch(() => {
            this.fail(new Error('Failed to read the compressed image with Blob.arrayBuffer().'));
          });
        } else {
          done(blob);
        }
      }
    };
    canvas.toBlob(callback, options.mimeType, options.quality);
  }
  done({
    naturalWidth,
    naturalHeight,
    result
  }) {
    const {
      file,
      options
    } = this;
    this.releaseImage();
    if (result) {
      // Returns original file if the result is greater than it and without size related options
      if (options.strict && !options.retainExif && result.size > file.size && options.mimeType === file.type && !(options.width > naturalWidth || options.height > naturalHeight || options.minWidth > naturalWidth || options.minHeight > naturalHeight || options.maxWidth < naturalWidth || options.maxHeight < naturalHeight)) {
        result = file;
      } else {
        let fileName = file.name;

        // Convert the extension to match its type
        if (fileName && result.type !== file.type) {
          fileName = fileName.replace(REGEXP_EXTENSION, imageTypeToExtension(result.type));
        }

        // Convert the resulting Blob object into a File object.
        result = new File([result], fileName, {
          type: result.type
        });
      }
    } else {
      // Returns original file if the result is null in some cases.
      result = file;
    }
    this.result = result;
    if (options.success) {
      options.success.call(this, result);
    }
  }
  fail(err) {
    const {
      options
    } = this;
    this.releaseImage();
    if (options.error) {
      options.error.call(this, err);
    } else {
      throw err;
    }
  }

  /**
   * Detach the source image's handlers and release its object URL, if any.
   */
  releaseImage() {
    const {
      image
    } = this;
    if (!image) {
      return;
    }

    // Revoking the URL of an image that is still loading fires its `error` event,
    // so detach the handlers first to avoid reporting the failure twice.
    image.onload = null;
    image.onabort = null;
    image.onerror = null;
    if (image.src.startsWith('blob:')) {
      URL.revokeObjectURL(image.src);
    }
  }
  abort() {
    if (!this.aborted) {
      this.aborted = true;
      if (this.reader) {
        this.reader.abort();
      } else if (!this.image.complete) {
        this.image.onload = null;
        this.image.onabort();
      } else {
        this.fail(new Error('The compression process has been aborted.'));
      }
    }
  }

  /**
   * Creates a new Compressor instance.
   * @param {File|Blob} file - The target image file to compress.
   * @param {Object} [options={}] - The configuration options.
   * @returns {Compressor} A new Compressor instance.
   */
  static create(file, options) {
    return new Compressor(file, options);
  }

  /**
   * Change the default options.
   * @param {Object} options - The new default options.
   */
  static setDefaults(options) {
    Object.assign(DEFAULTS, options);
  }

  /**
   * Get the no conflict compressor class.
   * @returns {Compressor} The compressor class.
   */
  static noConflict() {
    window.Compressor = AnotherCompressor;
    return Compressor;
  }
}

export { Compressor as default };
