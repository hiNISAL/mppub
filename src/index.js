const puppeteer = require('puppeteer');
const fs = require('fs');
const Rob = require('workwechat-bot').default;
const md5 = require('md5');
const {
  saveImageToLocal, decodeLoginCode, createTerminalCode, wait, sleep, resolve,
} = require('./utils');

class AuditTask {
  auditing = false;

  browser = null;

  currentPage = null;

  config = {};

  keepSessionTaskTimer = null;

  bot = {};

  constructor(config) {
    this.config = config;

    const bot = new Rob(config.wxCompanyRobots);

    this.bot = bot;
  }

  onGotLoginQrCode({
    qrSavePath,
  }) {
    const qrBase64 = fs.readFileSync(qrSavePath, 'base64');
    this.bot.image(qrBase64, md5(fs.readFileSync(qrSavePath))).send();
  }

  async bootstrap() {
    await this.stopKeepSession();

    await this.launchBrowser();
    await this.newPage();
    await this.openHomePage();

    if (!await this.checkLogin()) {
      await this.openHomePage();
      const [terminal, qrSavePath] = await this.waitForLogin();

      this.onGotLoginQrCode({
        terminal,
        qrSavePath,
      });

      console.log(terminal);
    }

    await this.waitForLoginRedirect();
    await this.redirectToVersionManagePage();

    const developerIndex = await this.getLatestVersion();

    await this.toAuditPage(developerIndex);
    await this.fillAuditForm();
    await this.submitAuditForm();
    const succeed = await this.checkSubmitAuditSuccess();

    if (succeed) {
      this.bot.text('提审成功').send();

      const qrBase64 = fs.readFileSync(resolve(__dirname, '../cache/audit_screenshot.png'), 'base64');
      this.bot.image(qrBase64, md5(fs.readFileSync(resolve(__dirname, '../cache/audit_screenshot.png')))).send();
    } else {
      this.bot.text('提审失败').send();
    }

    await this.keepSession();
  }

  // -------------------------------------------------------------------------
  // 停止刷新会话
  async stopKeepSession() {
    clearInterval(this.keepSessionTaskTimer);
  }

  // -------------------------------------------------------------------------
  // 开始刷新会话
  async keepSession() {
    await this.newPage();

    this.keepSessionTaskTimer = setInterval(() => {
      this.currentPage.reload();
    }, 10 * 60 * 1000);
  }

  // -------------------------------------------------------------------------
  // 打开浏览器
  async launchBrowser() {
    if (this.browser) {
      return;
    }

    this.browser = await puppeteer.launch({
      headless: this.config.headless ?? false,
      defaultViewport: {
        width: 1440,
        height: 900,
      },
    });
  }

  // -------------------------------------------------------------------------
  // 创建一个新的任务页面
  async newPage() {
    const browser = this.browser;

    const pages = await browser.pages();

    for (let i = 0, len = pages.length; i < len; i++) {
      if (!pages[i]?.url()?.includes('about:blank')) {
        await pages[i]?.close();
      }
    }

    const page = await browser.newPage();

    this.currentPage = page;
  }

  // -------------------------------------------------------------------------
  // 打开页面
  async openHomePage(options = {}) {
    const page = this.currentPage;

    await page.goto('https://mp.weixin.qq.com/', options);
  }

  // -------------------------------------------------------------------------
  // 打开页面并且等待资源加载完毕
  openPageAndWaitForReady() {
    return this.openHomePage({
      waitUntil: 'networkidle0',
    });
  }

  // -------------------------------------------------------------------------
  // 检查是否登入
  async checkLogin() {
    const page = this.currentPage;

    await this.openPageAndWaitForReady();

    return page.url().includes('/wxamp/index/index');
  }

  // -------------------------------------------------------------------------
  // 等待登入，返回登入二维码
  async waitForLogin() {
    const page = this.currentPage;

    const loginCodeImageLink = await wait(() => {
      return page.evaluate(() => {
        const el = document.querySelector('.login_frame .login__type__container__scan__qrcode');

        if (el.src === 'https://mp.weixin.qq.com/') return false;

        return el.src;
      });
    });

    // 保存到本地
    const savePath = await saveImageToLocal(loginCodeImageLink, page);

    // const qrBase64 = fs.readFileSync(savePath, 'base64');
    // bot.image(qrBase64, md5(fs.readFileSync(savePath)));
    // bot.text('开始提审，请扫码登录公众平台').send();

    // 解码
    let decodeText = null;
    try {
      decodeText = await decodeLoginCode(savePath);
    } catch (err) {
      console.log('获取二维码失败，重新加载页面');

      await this.openHomePage();
      return (await this.waitForLogin());
    }

    // 生码
    const terminalCode = await createTerminalCode(decodeText);

    return [terminalCode, savePath];
  }

  // -------------------------------------------------------------------------
  // 等待登入完毕后的跳转
  async waitForLoginRedirect() {
    const page = this.currentPage;

    // 页面跳转
    await wait(() => {
      return page.url().includes('mp.weixin.qq.com/wxamp/index/index');
    });

    // 等待目录初始化完毕
    await wait(() => {
      return page.evaluate(() => {
        return document.querySelectorAll('.menu_item').length;
      });
    });
  }

  // -------------------------------------------------------------------------
  // 获取版本管理页面的URL并跳转，等待加载完毕
  async redirectToVersionManagePage() {
    const page = this.currentPage;

    const versionMgrPagePath = await page.evaluate(() => {
      const menuItems = document.querySelectorAll('.menu_item');

      let url = '';

      menuItems.forEach((item) => {
        const link = item.querySelector('a');

        if (link.href.includes('/wxamp/wacodepage/getcodepage?')) {
          url = link.href;
        }
      });

      return url;
    });

    // 跳转到版本管理页面
    await page.goto(versionMgrPagePath);

    // 等待加载完
    await wait(() => {
      return page.evaluate(() => {
        return document.querySelectorAll('.code_version_log').length;
      });
    });
  }

  // -------------------------------------------------------------------------
  // 获取最新提交的版本
  async getLatestVersion() {
    const page = this.currentPage;

    const dateList = await page.evaluate(() => {
      return [...document.querySelectorAll('.code_version_dev .code_version_log .code_version_log_bd')].map((item) => {
        let d = null;

        [...item.querySelectorAll('.simple_preview_item')].forEach((set) => {
          const date = set.querySelector('.simple_preview_label').innerText;

          if (date === '提交时间') {
            d = new Date(set.querySelector('.simple_preview_value').innerText).getTime();
          }
        })

        return d;
      });
    });

    const [index] = dateList.reduce(([maxIndex, maxValue], current, currentIndex) => {
      const timestamp = new Date(current).getTime();

      if (current > maxValue) {
        return [currentIndex, timestamp];
      }

      return [maxIndex, maxValue];
    }, [0, 0]);

    return index;
  }

  // -------------------------------------------------------------------------
  // 提交审核按钮流程
  async toAuditPage(index) {
    const page = this.currentPage;
    const browser = this.browser;

    const developerList = await page.$$('.code_version_dev .code_version_log');

    // 执行提交发布按钮点击
    await (await developerList[index].$('.weui-desktop-btn_primary')).click();

    // 找到提交审核弹框
    // 点击提交审核
    await wait(() => {
      return page.evaluate(() => {
        const modals = document.querySelectorAll('.weui-desktop-dialog__wrp');

        const modalIndex = [...modals].findIndex((item) => item.querySelector('.weui-desktop-dialog__title').innerText === '提交审核');
        const btn = modals[modalIndex]?.querySelector('.weui-desktop-btn_primary');

        if (btn) {
          btn.click();

          return true;
        }

        return false;
      });
    });


    // 勾选提交审核须知，并下一步
    await wait(() => {
      return page.evaluate(() => {
        const modals = document.querySelectorAll('.weui-desktop-dialog__wrp');

        const modalIndex = [...modals].findIndex((item) => item.querySelector('.weui-desktop-dialog__title').innerText === '提交审核的相关须知');
        if (modals[modalIndex]) {
          modals[modalIndex]?.querySelector('.weui-desktop-form__check-label')?.click()
          setTimeout(() => {
            modals[modalIndex]?.querySelector('.weui-desktop-btn_primary')?.click()
          });
          return true;
        }

        return false;
      });
    });

    // 通过代码安全提醒，并下一步
    await wait(() => {
      return page.evaluate(() => {
        const modals = document.querySelectorAll('.weui-desktop-dialog__wrp');

        const modalIndex = [...modals].findIndex((item) => item.querySelector('h4')?.innerText === '代码审核进行安全测试提醒');

        modals[modalIndex]?.querySelector('.weui-desktop-btn_primary')?.click()

        return !!modals[modalIndex];
      });
    });

    // 检测是否两小时极速审核，并下一步
    try {
      await wait(() => {
        return page.evaluate(() => {
          const modals = document.querySelectorAll('.weui-desktop-dialog__wrp');

          const modalIndex = [...modals].findIndex((item) => item.querySelector('h3')?.innerText === '达标小程序奖励');

          modals[modalIndex]?.querySelector('.weui-desktop-btn_primary')?.click()

          return !!modals[modalIndex];
        });
      }, 10);
    } catch (e) {
      console.log('未检测到两小时极速审核');
    }

    await page.close();

    // const applyPage: puppeteer.Page = await wait(async () => {
    const applyPage = await wait(async () => {
      const pages = await browser.pages();

      for (let i = 0, len = pages.length; i < len; i++) {
        const url = await pages[i].url();

        if (url.includes('/wxamp/wadevelopcode/get_class')) {
          return pages[i];
        }
      }
    });

    await wait(async () => {
      return (await applyPage.$$('.webuploader-container label')).length;
    });

    this.currentPage = applyPage;
  }

  // -------------------------------------------------------------------------
  // 填充审核信息
  async fillAuditForm() {
    const applyPage = this.currentPage;
    const config = this.config;

    const uploadInput = await applyPage.$$('.webuploader-container input');
    const uploadLabel = await applyPage.$$('.webuploader-container label');

    const videoUploader = uploadInput[1];

    for(let i = 0, len = config.uploadImageLocalPath.length; i < len; i++) {
      const filepath = config.uploadImageLocalPath[i];

      const [fileChooser] = await Promise.all([
        applyPage.waitForFileChooser(),
        uploadLabel[0].click(),
      ]);

      await fileChooser.accept([filepath]);
      await applyPage.waitForTimeout(500);

      await wait(() => {
        return applyPage.evaluate((index) => {
          return document.querySelectorAll('#js_preview_pic li').length === (index + 1);
        }, i);
      });
    }

    await Promise.all(config.uploadVideoLocalPath.map((i) => {
      return videoUploader.uploadFile(i);
    }));

    await wait(() => {
      return applyPage.evaluate(() => {
        return document.querySelectorAll('.video-item a').length;
      });
    });
  }

  // -------------------------------------------------------------------------
  // 提交审核
  async submitAuditForm() {
    const page = this.currentPage;

    const doActionBtn = await page.$('.tool_bar a');

    await doActionBtn.click();
  }

  // -------------------------------------------------------------------------
  // 确认是否审核成功
  async checkSubmitAuditSuccess() {
    try {
      const page = this.currentPage;

      await sleep(10000);

      await this.openHomePage();
      await this.waitForLoginRedirect();
      await this.redirectToVersionManagePage();

      await wait(() => {
        return page.evaluate(() => {
          return document.querySelectorAll('.code_mod').length;
        });
      });

      await page.screenshot({
        path: resolve(__dirname, '../cache/audit_screenshot.png'),
      });

      return true;
    } catch (err) {
      return false
    }
  }
}

module.exports = AuditTask;