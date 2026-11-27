// The collection page has independent source-platform, search-type and date
// filters. Each group can have an active item at the same time.
export const COLLECTION_QUERY_REVISION='source-mode-group-20261124-v2';
export const COLLECTION_SOURCE_MODE_SELECTOR='[data-content="搜索类型"] .search-item';

export function readCollectionSourceMode(){
  const visible=element=>!!element?.getClientRects().length&&getComputedStyle(element).visibility!=='hidden'&&getComputedStyle(element).display!=='none'&&!element.closest('[aria-hidden="true"],[inert]');
  const groups=[...document.querySelectorAll('[data-content="搜索类型"]')].filter(visible);
  const choices=groups.length===1?[...groups[0].querySelectorAll('.search-item')].filter(visible):[];
  const sources=choices.filter(element=>element.textContent.trim()==='来源URL');
  const active=choices.filter(element=>element.classList.contains('active'));
  return {groupCount:groups.length,sourceCount:sources.length,activeCount:active.length,selected:groups.length===1&&sources.length===1&&active.length===1&&sources[0]===active[0]};
}

// Serialize the same group check into a DOM read, so the query mode and its
// returned rows are checked together in the page, without separate CDP reads.
export function withCollectionSourceMode(reader){
  return new Function(`return function collectionQueryRead(args){return (${reader.toString()})(args,(${readCollectionSourceMode.toString()})());}`)();
}
