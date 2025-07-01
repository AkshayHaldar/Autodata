const puppeteer = require('puppeteer');
const fs = require('fs');
const fetch = require('node-fetch');
const { JSDOM } = require('jsdom');
const readline = require('readline');

// Helper to sanitize filenames
function sanitizeFilename(name) {
  return name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
}

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    defaultViewport: null,
    args: ['--start-maximized']
  });
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(30000);
  page.setDefaultTimeout(15000);
  await page.goto('https://receiveramrapali.in/residential/subvention-scheme.php');

  const projectSelector = '#project';
  const towerSelector = '#tower';
  const unitSelector = '#unit';

  // Helper to get dropdown options
  async function getOptions(selector) {
    return await page.$$eval(`${selector} option`, opts =>
      opts.filter(opt => opt.value !== '').map(opt => ({ value: opt.value, text: opt.textContent.trim() }))
    );
  }

  // Helper to wait for dropdown population
  async function waitForDropdown(selector, timeout = 5000) {
    try {
      await page.waitForFunction(
        (sel) => {
          const select = document.querySelector(sel);
          return select && select.options.length > 1;
        },
        { timeout },
        selector
      );
      return true;
    } catch (error) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      const options = await page.$$eval(`${selector} option`, opts =>
        opts.filter(opt => opt.value !== '').map(opt => ({ value: opt.value, text: opt.textContent.trim() }))
      );
      return options.length > 0;
    }
  }

  // Display project options to the user
  const projectOptions = await getOptions(projectSelector);
  console.log('Available Projects:');
  projectOptions.forEach((project, idx) => {
    console.log(`${idx + 1}. ${project.text}`);
  });

  // Prompt user to select a project
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  function askQuestion(query) {
    return new Promise(resolve => rl.question(query, resolve));
  }

  let selectedIdx = -1;
  while (selectedIdx < 0 || selectedIdx >= projectOptions.length) {
    const answer = await askQuestion('Enter the number of the project you want to fetch data for: ');
    const idx = parseInt(answer, 10) - 1;
    if (!isNaN(idx) && idx >= 0 && idx < projectOptions.length) {
      selectedIdx = idx;
    } else {
      console.log('Invalid selection. Please try again.');
    }
  }
  rl.close();
  const project = projectOptions[selectedIdx];
  console.log(`Selected project: ${project.text}`);

  // Sanitize project name for filenames
  const projectPrefix = sanitizeFilename(project.text);
  const dataFilename = `${projectPrefix}_amrapali_data.json`;
  const rejectedFilename = `${projectPrefix}_rejected_entries.json`;

  // Streaming write setup
  const writeStream = fs.createWriteStream(dataFilename);
  writeStream.write('[\n');
  let isFirstEntry = true;
  let entryCount = 0;

  const rejectedStream = fs.createWriteStream(rejectedFilename);
  rejectedStream.write('[\n');
  let isFirstRejected = true;
  let rejectedCount = 0;

  // Helper to log rejected entries
  function logRejectedEntry(rejectedEntry) {
    const jsonString = JSON.stringify(rejectedEntry, null, 2);
    if (!isFirstRejected) {
      rejectedStream.write(',\n');
    }
    rejectedStream.write(jsonString);
    isFirstRejected = false;
    rejectedCount++;
  }

  await page.select(projectSelector, project.value);
  await waitForDropdown(towerSelector);
  const towerOptions = await getOptions(towerSelector);
  for (const tower of towerOptions) {
    await page.select(towerSelector, tower.value);
    await waitForDropdown(unitSelector);
    const unitOptions = await getOptions(unitSelector);
    for (const unit of unitOptions) {
      // Prepare POST body
      const body = `project_id=${encodeURIComponent(project.value)}&tower_id=${encodeURIComponent(tower.value)}&unit_id=${encodeURIComponent(unit.value)}&action=getdetails_subvention`;
      try {
        const response = await fetch('https://receiveramrapali.in/residential/ajax_add_mobile_change.php', {
          method: 'POST',
          headers: {
            'accept': '*/*',
            'accept-language': 'en-US,en;q=0.9',
            'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'x-requested-with': 'XMLHttpRequest',
            'Referer': 'https://receiveramrapali.in/residential/subvention-scheme.php'
          },
          body
        });
        const html = await response.text();
        // Parse table from HTML
        const dom = new JSDOM(html);
        const table = dom.window.document.querySelector('.table-bordered');
        if (!table) {
          logRejectedEntry({ project: project.text, tower: tower.text, unit: unit.text, reason: 'No table found', details: html });
          continue;
        }
        const rows = Array.from(table.querySelectorAll('tr'));
        const data = {};
        rows.forEach(row => {
          const cells = Array.from(row.querySelectorAll('td'));
          if (cells.length === 4) {
            data[cells[0].textContent.trim()] = cells[1].textContent.trim();
            data[cells[2].textContent.trim()] = cells[3].textContent.trim();
          }
        });
        const flatNo = data['Flat No.'];
        const hasData = Object.keys(data).length > 0;
        if (!hasData) {
          logRejectedEntry({ project: project.text, tower: tower.text, unit: unit.text, reason: 'Empty table - no data found', details: data });
          continue;
        }
        if (flatNo && unit.text !== flatNo) {
          logRejectedEntry({ project: project.text, tower: tower.text, unit: unit.text, reason: `Unit name mismatch - expected: ${unit.text}, got: ${flatNo}`, details: data });
          continue;
        }
        // Write result
        const result = { project: project.text, tower: tower.text, unit: unit.text, details: data };
        const jsonString = JSON.stringify(result, null, 2);
        if (!isFirstEntry) {
          writeStream.write(',\n');
        }
        writeStream.write(jsonString);
        isFirstEntry = false;
        entryCount++;
        console.log(`Saved entry ${entryCount}: ${project.text} / ${tower.text} / ${unit.text}`);
      } catch (err) {
        logRejectedEntry({ project: project.text, tower: tower.text, unit: unit.text, reason: 'Fetch or parse error', details: err.message });
      }
    }
  }
  writeStream.write('\n]');
  writeStream.end();
  rejectedStream.write('\n]');
  rejectedStream.end();
  console.log(`Done. Saved ${entryCount} entries, rejected ${rejectedCount}.`);
  await browser.close();
})();