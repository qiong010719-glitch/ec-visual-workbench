import test from 'node:test';
import assert from 'node:assert/strict';
import {categoryMappingScope,suggestListingCategory,createConfirmedCategoryMapping} from '../src/listing-category-policy.mjs';

const scope={account:'fixture',platform:'shein',mode:'marketplace',storeBindingKey:'shop-1',site:'美国站'};
const sourceFacts={categoryPath:['家用电器','厨房电器','榨汁机'],categoryId:'temu-only-id'};
const option={id:'target-201',label:'榨汁机',path:['家用电器','厨房电器','榨汁机'],leaf:true};
const mappedOption={id:'target-301',label:'果汁机',path:['家居','电器','果汁机'],leaf:true};

test('only a unique observed full leaf path can be selected automatically',()=>{
  const match=suggestListingCategory({sourceFacts,scope,options:[option]});
  assert.equal(match.status,'matched');assert.equal(match.category.id,'target-201');assert.notEqual(match.category.id,sourceFacts.categoryId);
  assert.equal(suggestListingCategory({sourceFacts,scope,options:[{...option,leaf:false}]}).status,'needs-category');
  const sameName={...option,id:'target-202',path:['商用设备','榨汁机']};
  const leafOnly=suggestListingCategory({sourceFacts,scope,options:[sameName]});assert.equal(leafOnly.status,'needs-category');assert.equal(leafOnly.category,null);assert.equal(leafOnly.candidates[0].id,sameName.id);
  assert.equal(suggestListingCategory({sourceFacts,scope,options:[option,{...option,id:'other'}]}).status,'ambiguous');
  assert.equal(suggestListingCategory({sourceFacts:{categoryPath:[]},scope,options:[option]}).status,'needs-category');
  assert.equal(suggestListingCategory({sourceFacts:{categoryPath:['材质(PVC)']},scope,options:[{id:'material',label:'材质',path:['材质'],leaf:true}]}).status,'needs-category');
});

test('confirmed cross-platform mapping is scoped and revalidated against the current target catalog',()=>{
  const category={id:mappedOption.id,label:mappedOption.label,path:mappedOption.path};
  const mapping=createConfirmedCategoryMapping({sourceFacts,scope,category,options:[mappedOption]});
  assert.equal(suggestListingCategory({sourceFacts,scope,options:[mappedOption],mappings:[mapping]}).method,'confirmed-mapping');
  for(const changed of [{platform:'tiktok'},{mode:'semi-managed'},{account:'other'},{storeBindingKey:'shop-2'},{site:'英国站'}])assert.equal(suggestListingCategory({sourceFacts,scope:{...scope,...changed},options:[mappedOption],mappings:[mapping]}).status,'needs-category');
  assert.equal(suggestListingCategory({sourceFacts,scope,options:[{...mappedOption,id:'new-id'}],mappings:[mapping]}).status,'needs-category');
  assert.equal(suggestListingCategory({sourceFacts,scope,options:[{...mappedOption,path:['其他','果汁机']}],mappings:[mapping]}).status,'needs-category');
  assert.throws(()=>createConfirmedCategoryMapping({sourceFacts,scope,category,options:[{...mappedOption,leaf:false}]}),/当前唯一末级目录/);
});

test('contradictory confirmed mappings and missing scope never silently choose one',()=>{
  const first=createConfirmedCategoryMapping({sourceFacts,scope,category:{id:option.id,label:option.label,path:option.path},options:[option]});
  const second=createConfirmedCategoryMapping({sourceFacts,scope,category:{id:mappedOption.id,label:mappedOption.label,path:mappedOption.path},options:[mappedOption]});
  assert.equal(suggestListingCategory({sourceFacts,scope,options:[option,mappedOption],mappings:[first,second]}).status,'ambiguous');
  assert.throws(()=>categoryMappingScope({platform:'shein'}),/缺少账号/);
  assert.throws(()=>createConfirmedCategoryMapping({sourceFacts:{categoryPath:[]},scope,category:option,options:[option]}),/前端完整分类路径/);
});
