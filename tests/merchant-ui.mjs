export const motherRow=(page,i)=>page.locator(`[data-template="${i}"]`);
export async function sourceStep(page,i){
 const row=motherRow(page,i);
 if(await row.locator('.mother-editor').isHidden())await row.locator('[data-edit-template]').click();
 else if(await row.locator('[data-source-step]').isHidden())await row.locator('[data-back-template]').click();
}
export async function bindingStep(page,i){
 const row=motherRow(page,i);
 if(await row.locator('.mother-editor').isHidden())await sourceStep(page,i);
 if(await row.locator('[data-binding-step]').isHidden())await row.locator('[data-next-template]').click();
 await page.waitForFunction(()=>!document.querySelector('#storeForm').inert);
}
export const storeIdle=page=>page.waitForFunction(()=>!document.querySelector('#storeForm').inert);
