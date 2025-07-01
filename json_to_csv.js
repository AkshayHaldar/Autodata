const fs = require('fs');
const path = require('path');
const { parser } = require('stream-json');
const { streamArray } = require('stream-json/streamers/StreamArray');

// Get input file from command line or use default
const inputFile = process.argv[2] || 'amrapali_adarsh_awas_yojna_noida_amrapali_data.json';
const baseName = path.basename(inputFile, path.extname(inputFile));
const outputFile = baseName + '.csv';

// CSV header
const header = 'Name,Mobile,Project Name,Flat No.';

// Create write stream
const writeStream = fs.createWriteStream(outputFile);
writeStream.write(header + '\n');

const pipeline = fs.createReadStream(inputFile)
  .pipe(parser())
  .pipe(streamArray());

pipeline.on('data', ({ value: obj }) => {
  const details = obj.details || {};
  const row = [
    details['Name'] || '',
    details['Mobile'] || '',
    obj['project'] || '',
    details['Flat No.'] || ''
  ].map(field => '"' + String(field).replace(/"/g, '""') + '"').join(',');
  writeStream.write(row + '\n');
});

pipeline.on('end', () => {
  writeStream.end();
  console.log('CSV conversion complete:', outputFile);
});

pipeline.on('error', err => {
  console.error('Error reading input file:', err);
});

writeStream.on('error', err => {
  console.error('Error writing output file:', err);
}); 