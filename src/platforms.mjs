export const platforms = Object.freeze({
  amazon: {id:'amazon',name:'Amazon 亚马逊',titleLimit:200,maxImages:9,maxProducts:20,maxListings:100,defaultLanguage:'English',destination:'content-library',publishEnabled:false,designEnabled:true},
  temu: {id:'temu',name:'Temu 半托管',titleLimit:250,maxImages:10,maxProducts:20,maxListings:100,defaultLanguage:'English',destination:'pending-draft',publishEnabled:true,designEnabled:true}
});
export function platformFor(id) {
  if(!Object.hasOwn(platforms,id))throw Object.assign(new Error('此平台尚未接入，请选择 Amazon 或 Temu'),{status:400});
  return platforms[id];
}
