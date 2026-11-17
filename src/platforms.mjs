export const platforms = Object.freeze({
  temu: {id:'temu',name:'Temu 半托管',titleLimit:250,maxImages:10,maxProducts:20,maxListings:100,defaultLanguage:'English',destination:'pending-draft',publishEnabled:true}
});
export function platformFor(id) {
  if(!Object.hasOwn(platforms,id))throw Object.assign(new Error('此平台尚未接入，请选择 Temu'),{status:400});
  return platforms[id];
}
