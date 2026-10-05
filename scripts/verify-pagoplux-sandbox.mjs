import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseUrl = new URL(process.env.PAYMENT_TEST_URL ?? 'http://localhost:3000');
const providerMode = process.env.PAYMENT_PROVIDER_TEST_MODE ?? 'fixture';
assert.ok(['fixture','live'].includes(providerMode));
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(baseUrl.hostname));
const browser = await chromium.launch({headless:true});
try {
  const context = await browser.newContext({viewport:{width:1440,height:1000}});
  if (providerMode === 'fixture') {
    await context.route('https://sandbox-paybox.pagoplux.com/**',route=>route.fulfill({
      contentType:'text/html',body:'<html><body>Proveedor interceptado: prueba local sin envío de datos.</body></html>',
    }));
  }
  await context.addInitScript(() => {
    const registry = new Map();
    Object.defineProperty(document, 'modelContext', {value:{
      registerTool(tool,{signal}={}) {
        registry.set(tool.name,tool);
        signal?.addEventListener('abort',()=>{if(registry.get(tool.name)===tool)registry.delete(tool.name);});
      },
      unregisterTool(name) {registry.delete(name);},
    }});
    window.qaTools = registry;
    window.qaExecute = async(name,input) => {
      const result = await registry.get(name).execute(input);
      return JSON.parse(result.content[0].text);
    };
  });
  const page = await context.newPage();
  const errors = [];
  let simulations = 0;
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(new URL(request.url()).pathname==='/api/payments/simulate') simulations++;});
  await page.goto(new URL('/search',baseUrl).href);
  await page.waitForFunction(()=>window.qaTools.has('discover_catalog'));
  const execute = async(name,args) => {
    const value = await page.evaluate(({name,args})=>window.qaExecute(name,args),{name,args});
    assert.notEqual(value?.ok,false,JSON.stringify(value));
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    return value;
  };
  const makes = await execute('discover_catalog',{productType:'battery',scope:'vehicle_makes'});
  const apps = await execute('discover_catalog',{productType:'battery',scope:'vehicle_applications',makeId:makes.options[0].id});
  const app = apps.options[0];
  const result = await execute('search_vehicle_batteries',{applicationId:app.id,year:app.metadata.yearFrom});
  const battery = result.batteries[0];
  const pickup = battery.locations.find(location=>location.fulfillment==='pickup');
  await execute('prepare_battery_quote',{batteryId:battery.id,locationId:pickup.id,quantity:1});
  await execute('start_card_checkout',{productType:'battery',productId:battery.id,fulfillment:'pickup'});
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nombre completo',{exact:true}).fill('Cliente Prueba');
  await dialog.getByLabel('Cédula o RUC',{exact:true}).fill('1712345678');
  await dialog.getByLabel('Correo',{exact:true}).fill('cliente@example.com');
  await dialog.getByLabel('Teléfono',{exact:true}).fill('0991234567');
  await dialog.getByLabel('Dirección de facturación',{exact:true}).fill('Dirección de prueba, Quito');
  assert.equal((await execute('get_checkout_context',{})).transaction,null);
  const checkoutResponse = page.waitForResponse(response=>new URL(response.url()).pathname==='/api/payments/pagoplux/checkout');
  const providerResponse = page.waitForResponse(response=>response.url().startsWith('https://sandbox-paybox.pagoplux.com/movil.html'),{timeout:30000});
  await dialog.getByRole('button',{name:/^Pagar \$/}).click();
  const response = await checkoutResponse;
  assert.equal(response.status(),200);
  const payment = await response.json();
  assert.equal(payment.transaction.mode,'pagoplux_sandbox','Server must load PagoPlux configuration, not simulation');
  assert.equal(payment.transaction.status,'PENDING');
  assert.equal(payment.form.action,'https://sandbox-paybox.pagoplux.com/movil.html');
  const provider = await providerResponse;
  const frame = await page.getByTitle('PagoPlux',{exact:true}).elementHandle().then(element=>element.contentFrame());
  await frame.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(3000);
  await page.getByTitle('PagoPlux',{exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({path:'/tmp/powerauto-pagoplux-sandbox.png'});
  assert.equal(simulations,0,'Sandbox must never execute simulation');
  assert.equal((await execute('get_checkout_context',{})).transaction.status,'PENDING','Opening provider must not approve payment');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({providerMode,providerExternallyValidated:providerMode==='live',mode:payment.transaction.mode,status:payment.transaction.status,providerHttpStatus:providerMode==='live'?provider.status():null,providerFrameOrigin:new URL(frame.url()).origin,providerInputs:await frame.locator('input').count(),simulationCalls:simulations,screenshot:'/tmp/powerauto-pagoplux-sandbox.png'}));
} finally {
  await browser.close();
}
