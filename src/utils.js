const decodeImage = require('jimp').read;
const qrcodeReader = require('qrcode-reader');
const path = require('path');
const fs = require('fs');
const qrcode = require('qrcode-terminal');

const saveImageToLocal = async (url, page) => {
  const loginCodeRes = await page.waitForResponse(url);
  const buffer = await loginCodeRes.buffer();
  const imgBase64 = buffer.toString('base64');

  const savePath = path.resolve(__dirname, '../cache/login-qrcode/qr.png');

  fs.writeFileSync(
    savePath,
    imgBase64,
    'base64'
  );

  return savePath;
};

const decodeLoginCode = (savePath) => {
  return new Promise(async (resolve, reject) => {
    decodeImage(path.resolve(__dirname, '../cache/login-qrcode/qr.png'), (err, image) => {
      const decodeQR = new qrcodeReader();

      decodeQR.callback = (errorWhenDecodeQR, result) => {
        try {
          resolve(result.result);
        } catch (err) {
          reject(err);
        }
      };

      decodeQR.decode(image.bitmap);
    });
  });
};

const createTerminalCode = (text) => {
  return new Promise((resolve) => {
    qrcode.generate(text, { small: true, }, function (qrcode) {
      resolve(qrcode);
    });
  });
};

const wait = (condition, times = null) => {
  return new Promise((resolve, reject) => {
    const timer = setInterval(async () => {
      if ((times <= 0) && (times !== null)) {
        reject();
        return;
      }
      const result = await condition();
      if (result) {
        clearInterval(timer);
        resolve(result);
      }

      if (typeof times === 'number') {
        times--;
      }
    }, 100);
  });
};

const resolve = (...args) => {
  return path.resolve(...args);
};

const sleep = (time) => {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, time);
  });
};

const compareVersions = (versions) => {
  versions = versions.map((item) => {
    return item.split('.').map(Number);
  });

  let max = null;
  let compare = versions[0];

  const len = versions.length;

  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < len; j++) {
      const v = versions[j];

      if (v[i] > compare[i]) {
        compare = v;
        max = i;
      }
    }

    if (max) return max;
  }

  return 0;
};

module.exports = {
  saveImageToLocal,
  decodeLoginCode,
  createTerminalCode,
  wait,
  sleep,
  resolve,
  compareVersions,
};
