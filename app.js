const pupHelper = require('./puppeteerhelper');
const _ = require('underscore');
const fs = require('fs');
const pLimit = require('p-limit');
const {dealerLink} = require('./keys');
let browser;
let productsLinks = [];
productsLinks = JSON.parse(fs.readFileSync('productsLinks.json'));

const scrapeSite = () => new Promise(async (resolve, reject) => {
  try {
    console.log('Started Scraping...');
    // Launch The Browser
    browser = await pupHelper.launchBrowser(true);

    // Fetch Links to individual Products
    // await fetchProductsLinks();

    // Fetch Details of ads
    const limit = pLimit(1);
    const promises = [];
    // for (let i = 0; i < productsLinks.length; i++) {
    for (let i = 0; i < 1; i++) {
      promises.push(limit(() => fetchProductsDetails(i)));
    }
    await Promise.all(promises);

    // Close the Browser
    await browser.close();
    console.log('Finished Scraping...');
    resolve(true);
  } catch (error) {
    if (browser) await browser.close();
    console.log(`Run Error: ${error}`);
    reject(error);
  }
})

const fetchProductsLinks = () => new Promise(async (resolve, reject) => {
  let page;
  try {
    console.log('Fetching Ads Links...');
    page = await pupHelper.launchPage(browser);
    await page.goto(dealerLink, {timeout: 0, waitUntil: 'networkidle2'});
    await page.waitForSelector('ul.sc-pagination');
    const numberOfPages = Number(await pupHelper.getTxt('ul.sc-pagination > li:nth-last-child(2) > a', page));
    console.log(`Number of Pages found for Dealer: ${numberOfPages}`);
    await page.close();

    for (let i = 1; i <= numberOfPages; i++) {
      console.log(`Fetching Ads Links from page: ${i}/${numberOfPages}`);
      page = await pupHelper.launchPage(browser);
      await page.goto(`${dealerLink}?&page=${i}`, {timeout: 0, waitUntil: 'networkidle2'});
      await page.waitForSelector('.classified-list');
      let pageLinks = await pupHelper.getAttrMultiple('.classified-list > .cldt-summary-full-item-main a[data-item-name="detail-page-link"]', 'href', page);
      pageLinks = pageLinks.map(pl => 'https://www.autoscout24.nl/' + pl);
      
      productsLinks.push(...pageLinks);
      await page.close();
    }

    productsLinks = _.uniq(productsLinks);
    console.log(`Number of Products found with dealer: ${productsLinks.length}`);
    fs.writeFileSync('productsLinks.json', JSON.stringify(productsLinks));
    resolve(true);
  } catch (error) {
    if (page) await page.close();
    console.log('fetchProductsLinks Error: ', error);
    reject(error);
  }
});

const fetchProductsDetails = (prodIdx) => new Promise(async (resolve, reject) => {
  let page;
  try {
    const product = {};
    console.log(`${prodIdx+1}/${productsLinks.length} - Fetching Ad Details [${productsLinks[prodIdx]}]...`);
    page = await pupHelper.launchPage(browser);
    await page.goto(productsLinks[prodIdx], {timeout: 0, waitUntil: 'networkidle2'});
    await page.waitForSelector('.cldt-stage');

    const specs = await fetchSpecs(page);
    // console.log(specs);

    product.title = await pupHelper.getTxt('h1.cldt-detail-title', page);
    product.make = await getCellVal('merk', specs);
    product.model = await getCellVal('model', specs);
    product.year = await getCellVal('bouwjaar', specs);
    product.mileage = '';
    product.content = '';
    product.options = await pupHelper.getTxtMultiple('.cldt-equipment-block > span', page);
    await page.waitForSelector('.as24-pictures__slider .as24-carousel__item img');
    product.images = await pupHelper.getAttrMultiple('.as24-pictures__slider .as24-carousel__item img', 'data-fullscreen-src', page);
    product.engineCapacity = '';
    product.enginePower = '';
    product.bodyType = await getCellVal('carrosserietype', specs);
    product.transmission = await getCellVal('transmissie', specs);
    product.bodyColor = await getCellVal('kleur', specs);
    product.interiorColor = '';
    product.fuelType = await getCellVal('brandstof', specs);
    product.condition = await getCellVal('categorie', specs);
    product.licensePlateNumber = '';
    product.numbersOfDoors = await getCellVal('deuren', specs);

    console.log(product)
  
    await page.close();
    resolve(true);
  } catch (error) {
    if (page) await page.close();
    console.log(`fetchProductsDetails[${productsLinks[prodIdx]}] Error: `, error);
    reject(error);
  }
});

const fetchSpecs = (page) => new Promise(async (resolve, reject) => {
  try {
    const specs = {};
    await page.waitForSelector('.cldt-data-section > dl > dt');
    const specsCol = await page.$$('.cldt-data-section > dl > dt, .cldt-data-section > dl > dd');
    for (let i = 0; i < specsCol.length; i++) {
      const tagName = await page.evaluate(elm => elm.tagName, specsCol[i]);
      if (tagName == 'DT') {
        const specLabel = await page.evaluate(elm => elm.childNodes[0].nodeValue.toLowerCase(), specsCol[i]);
        const specValue = await page.evaluate(elm => elm.innerText.trim(), specsCol[i+1]);
        specs[specLabel] = specValue;
      }
    }

    resolve(specs);
  } catch (error) {
    console.log('fetchSpecs Error: ', error);
    reject(error);
  }
});

const getCellVal = (label, specs) =>
  new Promise(async (resolve, reject) => {
    try {
      let returnVal = '';
      for (const specLabel in specs) {
        if (specLabel == label.toLowerCase()) {
          returnVal = specs[specLabel];
        }
      }

      resolve(returnVal);
    } catch (error) {
      console.log(`getCellVal(${label}) Error: ${error}`);
      reject(error);
    }
  });

(async () => {
  await scrapeSite();
})()