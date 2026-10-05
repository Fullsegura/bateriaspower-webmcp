import { chromium } from 'playwright';
import assert from 'node:assert/strict';

// Browser transport shim only: catalog and payment tools call the actual local APIs.
// Requires PAYMENT_MODE=simulation. Never validates an actual provider charge.
const baseUrl = new URL(process.env.PAYMENT_TEST_URL ?? 'http://localhost:3000');
const mapMode = process.env.PAYMENT_MAP_TEST_MODE ?? 'live';
const liveAddressSmoke = process.env.PAYMENT_ADDRESS_LIVE_SMOKE === '1';
assert.ok(['live', 'fixture'].includes(mapMode));
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(baseUrl.hostname), 'Run this test only against a local server');
const browser = await chromium.launch({headless:true});
try {
 const context = await browser.newContext({ viewport:{width:1440,height:1000}, permissions:['geolocation'], geolocation:{latitude:-0.18065,longitude:-78.46783} });
 let geocodeMode = 'success';
 let geocodeCalls = 0;
 let failDeliverySave = false;
 let deliveryCalls = 0;
 const checkoutRequests = [];
 const simulationRequests = [];
 const paymentNotices = [];
 let nextSimulationOutcome = null;
 // The model wording is evaluated separately; this fixture checks event/tool transport and rendering.
 await context.route(new URL('/api/agent', baseUrl).href, async route => {
   const request = route.request().postDataJSON();
   assert.equal(request.event?.type,'payment_status_changed');
   if (!request.toolResult) return route.fulfill({json:{kind:'tool_call',toolName:'get_payment_status',arguments:{transactionId:request.event.transactionId}}});
   assert.equal(request.toolResult.toolName,'get_payment_status');
   const content = request.toolResult.result.content;
   const payment = JSON.parse(content[0].text);
   assert.equal(payment.id,request.event.transactionId);
   assert.equal(payment.status,'VALIDATED');
   const message = `Pago realizado para ${payment.productName}.`;
   paymentNotices.push({id:payment.id,message});
   return route.fulfill({json:{kind:'message',message}});
 });
 await context.route(new URL('/api/payments/simulate', baseUrl).href, async route => {
   const body = route.request().postDataJSON();
   simulationRequests.push(body);
   if (nextSimulationOutcome) {
     const outcome = nextSimulationOutcome;
     nextSimulationOutcome = null;
     return route.continue({postData:JSON.stringify({...body,outcome})});
   }
   return route.continue();
 });
 await context.route(new URL('/api/payments/pagoplux/checkout', baseUrl).href, async route => {
   checkoutRequests.push(route.request().postDataJSON());
   return route.continue();
 });
 await context.route(new URL('/api/payments/delivery', baseUrl).href, async route => {
   deliveryCalls++;
   if (failDeliverySave) {
     failDeliverySave = false;
     return route.fulfill({status:503,json:{detail:'No se pudo guardar la ubicación. Intenta nuevamente.'}});
   }
   return route.continue();
 });
 if (mapMode === 'fixture') {
   await context.route(new URL('/api/payments/maps/address', baseUrl).href, async route => {
     const mode = geocodeMode;
     const call = ++geocodeCalls;
     if (call === 1 && liveAddressSmoke) return route.continue();
     if (mode === 'slow') await new Promise(resolve => setTimeout(resolve, 700));
     try {
       await route.fulfill(mode === 'failure'
         ? { status: 503, json: { detail: 'No se pudo obtener la dirección de este punto. Escríbela para continuar.' } }
         : { json: { address: `Dirección del punto ${call}, Quito` } });
     } catch { /* A cancelled lookup may already have closed its request. */ }
   });
 }
 await context.addInitScript(() => {
   const registry=new Map();
   Object.defineProperty(document,'modelContext',{value:{registerTool(tool,{signal}={}){registry.set(tool.name,tool);signal?.addEventListener('abort',()=>{if(registry.get(tool.name)===tool)registry.delete(tool.name);});}, unregisterTool(name){registry.delete(name);},getTools(){return [...registry.values()];},executeTool(tool,input){return registry.get(tool.name).execute(JSON.parse(input));}}});
   window.qaExecute=async(name,input)=>{const result=await registry.get(name).execute(input);return JSON.parse(result.content[0].text);};
   window.qaTools=registry;
 });
 const page=await context.newPage();
 const errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(new URL('/search',baseUrl).href);
 await page.waitForFunction(()=>window.qaTools.has('discover_catalog'));
 const execute=async(name,args)=>{
   const value=await page.evaluate(async({name,args})=>window.qaExecute(name,args),{name,args});
   assert.notEqual(value?.ok,false,JSON.stringify(value));
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   return value;
 };
 const makes=await execute('discover_catalog',{productType:'battery',scope:'vehicle_makes'});
 const apps=await execute('discover_catalog',{productType:'battery',scope:'vehicle_applications',makeId:makes.options[0].id});
 const application=apps.options[0];
 const result=await execute('search_vehicle_batteries',{applicationId:application.id,year:application.metadata.yearFrom});
 const battery=result.batteries[0];
 const home=battery.locations.find(location=>location.fulfillment==='delivery');
 assert.ok(home);
 await execute('select_battery',{batteryId:battery.id,locationId:home.id});
 await execute('prepare_battery_quote',{batteryId:battery.id,locationId:home.id,quantity:1});
 assert.equal(await page.getByLabel('1 producto cotizado',{exact:true}).locator('b').textContent(),'1');
 await page.getByRole('button',{name:'Pagar con tarjeta',exact:true}).click();
 const dialog=page.getByRole('dialog');
 await dialog.waitFor();
 const map = page.getByLabel('Mapa para elegir el punto de entrega', { exact: true });
 await map.waitFor();
 try {await page.locator('.leaflet-marker-icon').waitFor({timeout:12000});} catch(error) {console.log(errors);await page.screenshot({path:'/tmp/payment-debug.png'});throw error;}
 const addressField = dialog.getByLabel('Dirección de entrega',{exact:true});
 await page.waitForFunction(()=>document.querySelector('input[autocomplete="street-address"]').value.length>0);
 const pay=dialog.getByRole('button',{name:/^Pagar \$/});
 const waitSaved=async(expected={})=>{
   const deadline = Date.now() + 10000;
   let saved = false;
   while (Date.now() < deadline) {
     const value = await execute('get_checkout_context',{});
     saved = Boolean(value.quote?.delivery) && Object.entries(expected).every(([key,item])=>value.quote.delivery[key]===item);
     if (saved) break;
     await page.waitForTimeout(50);
   }
   assert.ok(saved,`Delivery was not saved: ${JSON.stringify(expected)}`);
   await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(button=>/^Pagar \$/.test(button.textContent.trim())&&!button.disabled));
 };
 await waitSaved({latitude:-0.18065,longitude:-78.46783});
 assert.equal(await dialog.getByRole('button',{name:/Confirmar ubicación|Ubicación confirmada/}).count(),0);
 assert.equal((await execute('get_checkout_context',{})).transaction,null,'Automatic location saving must not initiate payment');
 assert.equal(checkoutRequests.length,0);
 assert.equal(simulationRequests.length,0,'Opening the form must not pay');
 let verifiedAddress = null;
 if (liveAddressSmoke) {
   verifiedAddress = await addressField.inputValue();
   assert.ok(!verifiedAddress.startsWith('Dirección del punto'), 'The live smoke must not use a fixture');
   await dialog.getByRole('heading',{name:'Ubicación de entrega'}).scrollIntoViewIfNeeded();
   await page.screenshot({path:'/tmp/powerauto-address-live-desktop.png'});
 }
 if (mapMode === 'fixture') {
   const recenter = async () => {
     const address = `Dirección del punto ${geocodeCalls + 1}, Quito`;
     await dialog.getByRole('button',{name:'Mi ubicación',exact:true}).click();
     await page.waitForFunction(expected=>document.querySelector('input[autocomplete="street-address"]').value===expected,address);
     await waitSaved({latitude:-0.18065,longitude:-78.46783,address});
   };
   if (!liveAddressSmoke) assert.equal(await addressField.inputValue(), `Dirección del punto ${geocodeCalls}, Quito`);
   geocodeMode = 'slow';
   const firstCount = geocodeCalls;
   await map.click({position:{x:110,y:110}});
   await page.waitForTimeout(100);
   assert.ok(geocodeCalls > firstCount);
   geocodeMode = 'success';
   await map.click({position:{x:150,y:130}});
   await page.waitForTimeout(850);
   assert.equal(await addressField.inputValue(), `Dirección del punto ${geocodeCalls}, Quito`, 'Old lookups must not replace the latest address');
   await waitSaved({address:await addressField.inputValue()});
   geocodeMode = 'slow';
   await map.click({position:{x:170,y:130}});
   await page.waitForTimeout(100);
   await addressField.fill('Dirección escrita por el cliente');
   await page.waitForTimeout(850);
   assert.equal(await addressField.inputValue(), 'Dirección escrita por el cliente', 'A lookup must not overwrite manual typing');
   await waitSaved({address:'Dirección escrita por el cliente'});
   geocodeMode = 'failure';
   await map.click({position:{x:180,y:140}});
   await dialog.getByRole('alert').waitFor();
   assert.equal(await addressField.inputValue(), '');
   assert.ok(await pay.isDisabled());
   await addressField.fill('Dirección manual después del error');
   await waitSaved({address:'Dirección manual después del error'});
   geocodeMode = 'success';
   await recenter();
   const pin = page.locator('.leaflet-marker-icon');
   const box = await pin.boundingBox();
   assert.ok(box);
   const beforeDrag = geocodeCalls;
   await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
   await page.mouse.down();
   await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2 + 10, { steps: 8 });
   await page.mouse.up();
   await page.waitForTimeout(150);
   assert.ok(geocodeCalls > beforeDrag, 'Dragging the actual Leaflet pin must query its address');
   await page.waitForFunction(()=>document.querySelector('input[autocomplete="street-address"]').value.length>0);
   await waitSaved({address:await addressField.inputValue()});
   await recenter();
 }
 await dialog.getByLabel('Dirección de entrega',{exact:true}).fill('Av. Amazonas 123, Quito');
 await dialog.getByLabel('Referencia',{exact:true}).fill('Puerta principal');
 assert.ok(await pay.isDisabled());
 await waitSaved({address:'Av. Amazonas 123, Quito',reference:'Puerta principal'});
 assert.ok(await pay.isEnabled());
 await dialog.getByLabel('Nombre completo',{exact:true}).fill('Cliente Prueba');
 await dialog.getByLabel('Cédula o RUC',{exact:true}).fill('1712345678');
 await dialog.getByLabel('Correo',{exact:true}).fill('cliente@example.com');
 await dialog.getByLabel('Teléfono',{exact:true}).fill('0991234567');
 assert.equal(await dialog.getByLabel('Dirección de facturación',{exact:true}).count(),0,'Delivery must not ask for the same address in billing');
 await dialog.getByRole('heading',{name:'Ubicación de entrega'}).scrollIntoViewIfNeeded();
 await page.waitForTimeout(1500);
 const renderedMaps=await map.locator('.leaflet-tile-loaded').count();
 assert.ok(renderedMaps>0,'OpenStreetMap tiles did not render');
 await page.screenshot({path:'/tmp/powerauto-payment-map-desktop.png'});
 assert.equal((await execute('get_checkout_context',{})).quote.delivery.address,'Av. Amazonas 123, Quito','The saved address must remain unchanged while filling billing');
 await pay.scrollIntoViewIfNeeded();
 assert.equal(await pay.count(),1,'Present only one payment action');
 assert.equal(await dialog.getByRole('button',{name:'Continuar al pago',exact:true}).count(),0);
 await page.screenshot({path:'/tmp/powerauto-payment-action-desktop.png'});
 await pay.click();
 await dialog.getByRole('heading',{name:'Pago aprobado',exact:true}).waitFor();
 assert.equal(checkoutRequests.at(-1).billing.address,'Av. Amazonas 123, Quito','Billing must reuse the latest saved delivery address');
 const approved=await execute('get_checkout_context',{});
 assert.equal(approved.transaction.status,'VALIDATED');
 await page.getByText(`Pago realizado para ${approved.transaction.productName}.`,{exact:true}).waitFor();
 assert.equal(paymentNotices.filter(notice=>notice.id===approved.transaction.id).length,1,'Announce an approved payment once');
 assert.equal(await page.getByLabel('1 producto cotizado',{exact:true}).count(),0,'An approved payment must clear the cart badge');
 assert.equal(await page.getByLabel('Sin cotización',{exact:true}).locator('b').count(),0);
 assert.equal(checkoutRequests.length,1,'One button click creates one checkout');
 assert.equal(simulationRequests.length,1,'One button click completes one simulated payment');
 assert.equal(approved.transaction.delivery.latitude,-0.18065);
 assert.equal(approved.transaction.totalAmountCents,Math.round(battery.price*100));
 const status=await execute('get_payment_status',{transactionId:approved.transaction.id});
 assert.equal(status.status,'VALIDATED');
 await page.waitForTimeout(100);
 assert.equal(paymentNotices.filter(notice=>notice.id===approved.transaction.id).length,1,'Repeated status queries must not duplicate the chat notice');
 await dialog.getByRole('heading',{name:'Pago aprobado',exact:true}).scrollIntoViewIfNeeded();
 await page.screenshot({path:'/tmp/powerauto-payment-receipt-desktop.png'});
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:'/tmp/powerauto-payment-receipt-mobile.png'});
 const dimensions=await dialog.evaluate(element=>({width:element.getBoundingClientRect().width,height:element.getBoundingClientRect().height,scroll:document.documentElement.scrollWidth,viewport:innerWidth}));
 assert.ok(dimensions.width<=390 && dimensions.height<=844 && dimensions.scroll<=390,JSON.stringify(dimensions));
 await dialog.getByRole('button',{name:'Continuar',exact:true}).click();
 await page.getByRole('button',{name:'Ver comprobante',exact:true}).click();
 assert.equal((await execute('get_checkout_context',{})).transaction.id,approved.transaction.id);
 await dialog.getByRole('button',{name:'Continuar',exact:true}).click();
 await execute('reset_catalog',{});
 const nextMakes=await execute('discover_catalog',{productType:'battery',scope:'vehicle_makes'});
 const nextApps=await execute('discover_catalog',{productType:'battery',scope:'vehicle_applications',makeId:nextMakes.options[0].id});
 const nextResult=await execute('search_vehicle_batteries',{applicationId:nextApps.options[0].id,year:nextApps.options[0].metadata.yearFrom});
 const nextBattery=nextResult.batteries[0];
 const nextHome=nextBattery.locations.find(location=>location.fulfillment==='delivery');
 await execute('prepare_battery_quote',{batteryId:nextBattery.id,locationId:nextHome.id,quantity:1});
 assert.equal(await page.getByLabel('1 producto cotizado',{exact:true}).locator('b').textContent(),'1','A new quote must restore the cart badge');
 assert.equal((await execute('get_checkout_context',{})).transaction,null,'A new search must not restore an earlier payment');
 await page.evaluate(()=>{navigator.geolocation.getCurrentPosition=(_success,error)=>error({code:1,message:'Geolocation failure'});});
 await page.getByRole('button',{name:'Pagar con tarjeta',exact:true}).click();
 await map.waitFor();
 await dialog.getByRole('alert').waitFor();
 assert.ok((await dialog.getByRole('alert').textContent()).includes('bloqueado'),'Opening the form must request GPS automatically');
 assert.equal((await execute('get_checkout_context',{})).quote.delivery,null);
 await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(button=>button.textContent.trim()==='Mi ubicación'&&!button.disabled));
 for(const [code,wording] of [[1,'bloqueado'],[2,'no pudo determinar'],[3,'tardó demasiado']]) {
   await page.evaluate(code=>{navigator.geolocation.getCurrentPosition=(_success,error)=>error({code,message:'Geolocation failure'});},code);
   await dialog.getByRole('button',{name:'Mi ubicación',exact:true}).click();
   await dialog.getByRole('alert').waitFor();
   const error=await dialog.getByRole('alert').textContent();
   assert.ok(error.includes(wording),error);
   if(code!==1) assert.ok(!error.includes('permiso'),error);
   assert.ok(await pay.isDisabled());
   assert.equal(await page.locator('.leaflet-marker-icon').count(),0,'A geolocation error must not fabricate a delivery point');
 }
 await map.click({position:{x:155,y:150}});
 await page.locator('.leaflet-marker-icon').waitFor();
 await page.waitForFunction(()=>document.querySelector('input[autocomplete="street-address"]').value.length>0);
 await waitSaved({address:await addressField.inputValue()});
 assert.equal(await dialog.getByRole('alert').count(),0,'Manual choice resolves the GPS error');
 await dialog.getByLabel('Dirección de entrega',{exact:true}).fill('Dirección de prueba manual');
 await waitSaved({address:'Dirección de prueba manual'});
 failDeliverySave = true;
 await dialog.getByLabel('Dirección de entrega',{exact:true}).fill('Dirección corregida');
 await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(button=>/^Pagar \$/.test(button.textContent.trim())&&button.disabled));
 await dialog.getByRole('button',{name:'Reintentar guardado',exact:true}).waitFor();
 assert.ok(await pay.isDisabled(),'A failed automatic save must not allow payment');
 const failedCalls = deliveryCalls;
 await page.waitForTimeout(900);
 assert.equal(deliveryCalls,failedCalls,'Do not silently retry a failed save in a loop');
 await dialog.getByRole('button',{name:'Reintentar guardado',exact:true}).click();
 await waitSaved({address:'Dirección corregida'});
 assert.equal((await execute('get_checkout_context',{})).transaction,null);
 assert.equal(await dialog.getByLabel('Dirección de facturación',{exact:true}).count(),0,'Mobile delivery must not show a duplicate billing address');
 await dialog.getByRole('heading',{name:'Ubicación de entrega'}).scrollIntoViewIfNeeded();
 await page.screenshot({path:'/tmp/powerauto-payment-map-mobile.png'});
 await dialog.getByRole('button',{name:'Cerrar pago',exact:true}).click();

 const pickup=nextBattery.locations.find(location=>location.fulfillment==='pickup');
 await execute('prepare_battery_quote',{batteryId:nextBattery.id,locationId:pickup.id,quantity:2});
 await page.getByRole('button',{name:'Pagar con tarjeta',exact:true}).click();
 await dialog.getByLabel('Nombre completo',{exact:true}).waitFor();
 assert.equal(await dialog.getByLabel('Mapa para elegir el punto de entrega',{exact:true}).count(),0,'Pickup does not require a map');
 assert.ok(await dialog.getByLabel('Dirección de facturación',{exact:true}).isVisible(),'Pickup still collects the billing address');
 const fillBilling=async()=>{
   await dialog.getByLabel('Nombre completo',{exact:true}).fill('Cliente Prueba');
   await dialog.getByLabel('Cédula o RUC',{exact:true}).fill('1712345678');
   await dialog.getByLabel('Correo',{exact:true}).fill('cliente@example.com');
   await dialog.getByLabel('Teléfono',{exact:true}).fill('0991234567');
   await dialog.getByLabel('Dirección de facturación',{exact:true}).fill('Dirección de facturación de prueba');
   await pay.scrollIntoViewIfNeeded();
   assert.equal(await pay.count(),1);
   await page.screenshot({path:'/tmp/powerauto-payment-action-mobile.png'});
   await pay.click();
 };
 nextSimulationOutcome = 'cancelled';
 await fillBilling();
 await dialog.getByRole('heading',{name:'Pago cancelado',exact:true}).waitFor();
 assert.equal(checkoutRequests.at(-1).billing.address,'Dirección de facturación de prueba','Pickup must preserve the user billing address');
 const cancelledId=(await execute('get_checkout_context',{})).transaction.id;
 await dialog.getByRole('button',{name:'Intentar nuevamente',exact:true}).click();
 await fillBilling();
 await dialog.getByRole('heading',{name:'Pago aprobado',exact:true}).waitFor();
 assert.notEqual((await execute('get_checkout_context',{})).transaction.id,cancelledId);
 await dialog.getByRole('button',{name:'Continuar',exact:true}).click();

 await execute('reset_catalog',{});
 const highlight=await page.evaluate(()=>fetch('/api/catalog/highlights').then(response=>response.json()));
 assert.ok(highlight.tire,'A priced tire is required for this integration test');
 const tires=await execute('search_tires',{mode:'measure',category:highlight.tire.category,width:highlight.tire.width,height:highlight.tire.height,rim:highlight.tire.rim});
 const tire=tires.tires.find(item=>item.price.status==='available'&&item.warehouses.some(warehouse=>warehouse.quantity>0));
 assert.ok(tire);
 const warehouse=tire.warehouses.find(item=>item.quantity>0);
 await execute('prepare_quote',{tireId:tire.id,quantity:1,quantityMode:'total',warehouseId:warehouse.warehouseId});
 await page.getByRole('button',{name:'Pagar con tarjeta',exact:true}).click();
 await dialog.getByRole('button',{name:'Retirar en local',exact:true}).click();
 await dialog.getByLabel('Nombre completo',{exact:true}).waitFor();
 await fillBilling();
 await dialog.getByRole('heading',{name:'Pago aprobado',exact:true}).waitFor();
 const tireContext=await execute('get_checkout_context',{});
 assert.equal(tireContext.quote.productType,'tire');
 assert.equal(tireContext.quote.warehouseId,warehouse.warehouseId);
 assert.equal(tireContext.transaction.mode,'simulation');
 assert.equal(tireContext.transaction.totalAmountCents,Math.round(tire.price.unitKnownChargesTotal*100));
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({pass:true,mapMode,addressLiveValidated:mapMode==='live'||liveAddressSmoke,verifiedAddress,scenarios:['battery-delivery-auto-gps','battery-delivery-manual','automatic-location-update','automatic-save-failure-retry','new-search-context','battery-pickup','cancel-retry','tire-pickup',...(mapMode==='fixture'?['address-autofill','latest-pin-wins','manual-address-preserved','geocoding-failure','drag-address-autofill']:[])],renderedMaps,dimensions,transactionId:approved.transaction.id,mode:approved.transaction.mode,screenshots:['/tmp/powerauto-payment-map-desktop.png','/tmp/powerauto-payment-map-mobile.png','/tmp/powerauto-payment-receipt-desktop.png','/tmp/powerauto-payment-receipt-mobile.png']}));
} finally {await browser.close();}
