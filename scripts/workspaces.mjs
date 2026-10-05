import { buildProducts, products, typecheckProducts } from './build.mjs';
import { runTests } from './test.mjs';
import { testOptions } from './test-options.mjs';
import { verifyTestResources } from './test-resources.mjs';
const action = process.argv[2];
if (!['typecheck', 'build', 'test'].includes(action)) throw new Error('Expected typecheck, build or test');
if (action === 'test') testOptions(process.argv.slice(3));
if (action !== 'test' && process.argv.length > 3) throw new Error('Build and typecheck take no flags');
if (action === 'typecheck') await typecheckProducts(products);
else if (action === 'build') await buildProducts(products);
else { verifyTestResources(); await buildProducts(products); await runTests(products, 'all'); }
