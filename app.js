const pupHelper = require('./puppeteerhelper');
const _ = require('underscore');
const fs = require('fs');
const pLimit = require('p-limit');
const moment = require('moment');
const {dealerLink} = require('./keys');
let browser;
let productsLinks = [];
// productsLinks = JSON.parse(fs.readFileSync('productsLinks.json'));
let products = [];
// products = JSON.parse(fs.readFileSync('products.json'));

const scrapeSite = () => new Promise(async (resolve, reject) => {
  try {
    console.log('Started Scraping...');
    // Launch The Browser
    browser = await pupHelper.launchBrowser();

    // Fetch Links to individual Products
    await fetchProductsLinks();

    // Fetch Details of ads
    const limit = pLimit(5);
    const promises = [];
    for (let i = 0; i < productsLinks.length; i++) {
      promises.push(limit(() => fetchProductsDetails(i)));
    }
    await Promise.all(promises);
    fs.writeFileSync('products.json', JSON.stringify(products));

    // Save to Csv
    await saveToCsv();

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
    const facts = await pupHelper.getTxtMultiple('.cldt-stage-data .cldt-stage-basic-data > div .cldt-stage-primary-keyfact', page);

    product.url = productsLinks[prodIdx];
    product.title = await pupHelper.getTxt('h1.cldt-detail-title', page);
    product.make = await getCellVal('merk', specs);
    product.model = await getCellVal('model', specs);
    product.year = await getCellVal('bouwjaar', specs);
    product.dealerName = await pupHelper.getTxt('.cldt-stage-vendor-name-rating > span', page);
    product.phoneNumber = await pupHelper.getTxt('.cldt-stage-vendor-buttons a[data-type="cldt-call-button"]', page);
    product.price = await pupHelper.getTxt('.cldt-stage-headline .cldt-price > h2', page);
    product.price = product.price.replace(/^€/gi, '').trim().replace(/\./gi, '').trim().replace(/,-$/gi, '').trim()
    product.mileage = facts[0];
    product.location = await pupHelper.getTxt('.cldt-stage-vendor-data > .cldt-stage-vendor-text > div:first-child', page);
    product.content = await pupHelper.getTxt('div[data-type="description"]', page);
    product.options = await pupHelper.getTxtMultiple('.cldt-equipment-block > span', page);
    const hasImages = await page.$('.as24-pictures__slider .as24-carousel__item img');
    if (hasImages) {
      product.images = await pupHelper.getAttrMultiple('.as24-pictures__slider .as24-carousel__item img', 'data-fullscreen-src', page);
    } else {
      product.images = [];
      product.images.push(await pupHelper.getAttr('.cldt-stage-gallery-holder .single-picture > img', 'src', page));
    }
    product.engineCapacity = await getCellVal('Cilinderinhoud', specs);
    product.enginePower = facts[2] + ' ' + facts[3];
    product.bodyType = await getCellVal('carrosserietype', specs);
    product.transmission = await getCellVal('transmissie', specs);
    product.bodyColor = await getCellVal('kleur', specs);
    product.interiorColor = await getCellVal('Interieurinrichting', specs);
    product.fuelType = await getCellVal('brandstof', specs);
    product.condition = await getCellVal('categorie', specs);
    product.licensePlateNumber = await getCellVal('advertentienr.', specs);
    product.numbersOfDoors = await getCellVal('deuren', specs);
    
    for (const key in product) {
      if (typeof product[key] != 'object') {
        product[key] = product[key].replace(/\"/gi, "'");
      } 
    }
  
    products.push(product);
    await page.close();
    resolve(true);
  } catch (error) {
    if (page) await page.close();
    console.log(`fetchProductsDetails[${productsLinks[prodIdx]}] Error: `, error.message);
    resolve(false);
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

const getCellVal = (label, specs) => new Promise(async (resolve, reject) => {
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

const saveToCsv = () => new Promise(async (resolve, reject) => {
  try {
    console.log("Saving to csv...");
    const fileName = `results ${moment().format('MM-DD-YYYY HH-mm')}.csv`;
    const csvHeader = '"URL","Title","Make","Model","Year","Dealer Name","Phone Number","Price","Location","Mileage","Options","Engine Capacity","Engine Power","Body Type","Transmission","Body Color","Interior Color","Fuel Type","Condition","License Plate Number","Numbers Of Doors","Image 1","Image 2","Image 3","Image 4","Image 5","Image 6","Image 7","Image 8","Image 9","Image 10","Image 11","Image 12","Image 13","Image 14","Content"\r\n';
    fs.writeFileSync(fileName, csvHeader);

    for (let i = 0; i < products.length; i++) {
      let csvLine = '';
      csvLine += `"${products[i].url}"`;
      csvLine += `,"${products[i].title}"`;
      csvLine += `,"${products[i].make}"`;
      csvLine += `,"${products[i].model}"`;
      csvLine += `,"${products[i].year}"`;
      csvLine += `,"${products[i].dealerName}"`;
      csvLine += `,"${products[i].phoneNumber}"`;
      csvLine += `,"${products[i].price}"`;
      csvLine += `,"${products[i].location}"`;
      csvLine += `,"${products[i].mileage}"`;
      csvLine += `,"${products[i].options.join(' | ')}"`;
      csvLine += `,"${products[i].engineCapacity}"`;
      csvLine += `,"${products[i].enginePower}"`;
      csvLine += `,"${products[i].bodyType}"`;
      csvLine += `,"${products[i].transmission}"`;
      csvLine += `,"${products[i].bodyColor}"`;
      csvLine += `,"${products[i].interiorColor}"`;
      csvLine += `,"${products[i].fuelType}"`;
      csvLine += `,"${products[i].condition}"`;
      csvLine += `,"${products[i].licensePlateNumber}"`;
      csvLine += `,"${products[i].numbersOfDoors}"`;
      csvLine +=  products[i].images[0] ? `,"${products[i].images[0]}"` : ',""';
      csvLine +=  products[i].images[1] ? `,"${products[i].images[1]}"` : ',""';
      csvLine +=  products[i].images[2] ? `,"${products[i].images[2]}"` : ',""';
      csvLine +=  products[i].images[3] ? `,"${products[i].images[3]}"` : ',""';
      csvLine +=  products[i].images[4] ? `,"${products[i].images[4]}"` : ',""';
      csvLine +=  products[i].images[5] ? `,"${products[i].images[5]}"` : ',""';
      csvLine +=  products[i].images[6] ? `,"${products[i].images[6]}"` : ',""';
      csvLine +=  products[i].images[7] ? `,"${products[i].images[7]}"` : ',""';
      csvLine +=  products[i].images[8] ? `,"${products[i].images[8]}"` : ',""';
      csvLine +=  products[i].images[9] ? `,"${products[i].images[9]}"` : ',""';
      csvLine +=  products[i].images[10] ? `,"${products[i].images[10]}"` : ',""';
      csvLine +=  products[i].images[11] ? `,"${products[i].images[11]}"` : ',""';
      csvLine +=  products[i].images[12] ? `,"${products[i].images[12]}"` : ',""';
      csvLine +=  products[i].images[13] ? `,"${products[i].images[13]}"` : ',""';
      csvLine += `,"${products[i].content}"\r\n`;
      fs.appendFileSync(fileName, csvLine);
    }

    resolve(true);
  } catch (error) {
    console.log('saveToCsv Error: ', error);
    reject(error);
  }
});

(async () => {
  await scrapeSite();
})()