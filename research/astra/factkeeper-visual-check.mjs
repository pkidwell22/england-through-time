import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const dir=path.resolve('research/astra');
const temp=path.join(dir,'factkeeper-browser-tmp');
await fs.mkdir(temp,{recursive:true});
process.env.TMPDIR=temp;
const { chromium }=await import('playwright-core');
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-breakpad','--disable-crash-reporter','--disable-gpu-shader-disk-cache']});
try {
 const page=await browser.newPage({viewport:{width:1280,height:980}});
 await page.goto(pathToFileURL(path.join(dir,'factkeeper-report-preview.html')).href);
 await page.screenshot({path:path.join(dir,'factkeeper-report-top.png')});
 await page.getByRole('heading',{name:/L01 —/}).scrollIntoViewIfNeeded();
 await page.screenshot({path:path.join(dir,'factkeeper-report-finding.png')});
 await page.getByRole('heading',{name:'Disposition of all 77 imported disagreements',exact:true}).scrollIntoViewIfNeeded();
 await page.screenshot({path:path.join(dir,'factkeeper-report-comparisons.png')});
 const check=await page.evaluate(()=>({horizontalOverflow:document.documentElement.scrollWidth>innerWidth,tables:document.querySelectorAll('table').length,codeBlocks:document.querySelectorAll('pre').length,headings:document.querySelectorAll('h1,h2,h3,h4').length}));
 await fs.writeFile(path.join(dir,'factkeeper-report-visual-check.json'),JSON.stringify(check,null,2));
 console.log(JSON.stringify(check));
} finally {await browser.close();}
