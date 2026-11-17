import fs from 'node:fs';
import * as XLSX from 'xlsx';
export function readWorkbook(file,{products=false}={}){
  if(fs.statSync(file).size>10*1024*1024)throw new Error('Excel 超过 10 MB');
  const book=XLSX.read(fs.readFileSync(file),{type:'buffer',cellFormula:true,sheetRows:1002});
  const required=products?['货号','标题']:['货号','标题','英文标题'];
  const matches=book.SheetNames.map(name=>({name,sheet:book.Sheets[name],values:XLSX.utils.sheet_to_json(book.Sheets[name],{header:1,raw:false,defval:''})})).filter(s=>required.every(h=>s.values[0]?.map(h=>h==='产品标题'?'标题':String(h).trim()).includes(h)));
  if(matches.length!==1)throw new Error('需要恰好一张包含「'+required.join('、')+'」的工作表');
  const {name,sheet,values}=matches[0],header=values[0].map(h=>h==='产品标题'?'标题':String(h).trim());
  if(required.some(h=>header.filter(x=>x===h).length!==1))throw new Error('表格必需列名重复');
  const rows=[];
  values.slice(1).forEach((values,i)=>{
    if(!values.some(String))return;
    const row={};header.forEach((key,col)=>{if(key){if(sheet[XLSX.utils.encode_cell({r:i+1,c:col})]?.f)throw new Error(`第 ${i+2} 行请使用文本，不使用公式`);row[key]=String(values[col]??'').trim();}});
    rows.push({rowId:String(i+2),productCode:row['货号'],title:row['标题'],englishTitle:row['英文标题']||'',...(row['中文核对标题']?{chineseTitle:row['中文核对标题']}:{}),metadata:row});
  });
  if(!rows.length||rows.length>(products?20:100))throw new Error(products?'当前支持 1—20 个产品':'当前支持 1—100 条商品');
  return {sheet:name,rows};
}
export function writeWorkbook(rows,file){
  const book=XLSX.utils.book_new();const sheet=XLSX.utils.aoa_to_sheet([['货号','标题','英文标题','中文核对标题'],...rows.map(r=>[r.productCode,r.title,r.englishTitle,r.chineseTitle||''])]);
  sheet['!cols']=[{wch:32},{wch:65},{wch:95},{wch:65}];XLSX.utils.book_append_sheet(book,sheet,'商品');fs.writeFileSync(file,XLSX.write(book,{type:'buffer',bookType:'xlsx'}));
}
