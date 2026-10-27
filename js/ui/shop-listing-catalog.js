(function(){
'use strict';
const $=id=>document.getElementById(id),form=$('profile-listing-form');
if(!form)return;
const search=$('profile-listing-catalog-search'),type=$('profile-listing-catalog-type'),set=$('profile-listing-catalog-set');
const status=$('profile-listing-catalog-status'),results=$('profile-listing-catalog-results'),selected=$('profile-listing-catalog-selected'),clearButton=$('profile-listing-catalog-clear');
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
let timer=null,requestId=0,products=[];
function say(message){status.textContent=message||'';}
function priceLabel(value){if(value===null||value===undefined||value==='')return 'Market price unavailable';const price=Number(value);return Number.isFinite(price)?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(price):'Market price unavailable';}
function renderSelected(product){
 const productId=Number(product.product_id||product.tcgcsv_product_id||product.id)||0;
 form.elements.tcgcsv_product_id.value=productId?String(productId):'';
 if(product.name)form.elements.item_name.value=product.name;
 if(product.product_type){
  if(String(product.product_type).toLowerCase()==='sealed')form.elements.category.value='Sealed';
  else if(form.elements.category.value!=='Graded cards')form.elements.category.value='Singles';
 }
 selected.innerHTML='<div class="cp-catalog-result">'+(product.image_url?'<img loading="lazy" alt="" src="'+escapeHtml(product.image_url)+'">':'<span aria-hidden="true">TCGCSV</span>')+'<span><strong>'+escapeHtml(product.name||'Selected catalog product')+'</strong><small>'+escapeHtml(product.set_name||'TCGCSV catalog')+(product.card_number?' · #'+escapeHtml(product.card_number):'')+'</small><small>TCGCSV market reference: '+escapeHtml(priceLabel(product.market_price))+'</small><small>Upload your own item photo below; this reference does not set your asking price.</small></span></div>';
 selected.hidden=false;clearButton.hidden=false;
}
function clearSelection(){form.elements.tcgcsv_product_id.value='';selected.innerHTML='';selected.hidden=true;clearButton.hidden=true;say('Catalog selection removed. You can enter the item manually.');}
async function loadSets(){
 try{const response=await fetch('/api/collector/catalog?mode=sets',{credentials:'same-origin',cache:'no-store'});const data=await response.json().catch(()=>({}));if(!response.ok||!data.ok)throw new Error('Set filters are currently unavailable.');set.innerHTML='<option value="">All sets</option>'+(data.sets||[]).map(item=>'<option value="'+escapeHtml(item.id)+'">'+escapeHtml(item.name)+(item.abbreviation?' ('+escapeHtml(item.abbreviation)+')':'')+'</option>').join('');}
 catch(error){say(error.message||'Set filters are currently unavailable.');}
}
async function searchCatalog(){
 const query=search.value.trim(),request=++requestId;
 if(query.length<2){products=[];results.innerHTML='';say('Type at least 2 characters to search.');return;}
 const params=new URLSearchParams({q:query,type:type.value,limit:'30'});if(set.value)params.set('set_id',set.value);
 say('Searching TCGCSV…');results.innerHTML='';
 try{
  const response=await fetch('/api/collector/catalog?'+params.toString(),{credentials:'same-origin',cache:'no-store'});const data=await response.json().catch(()=>({}));
  if(request!==requestId)return;
  if(!response.ok||!data.ok){if(data.error==='tcgcsv_not_synced')throw new Error('The TCGCSV catalog is not ready yet. Please try again shortly.');throw new Error('Catalog search is unavailable right now. Please try again.');}
  products=Array.isArray(data.products)?data.products:[];
  results.innerHTML=products.map((product,index)=>'<button class="cp-catalog-result" type="button" data-catalog-result="'+index+'">'+(product.image_url?'<img loading="lazy" alt="" src="'+escapeHtml(product.image_url)+'">':'<span aria-hidden="true">TCGCSV</span>')+'<span><strong>'+escapeHtml(product.name||'Untitled product')+'</strong><small>'+escapeHtml(product.set_name||'Set not listed')+(product.card_number?' · #'+escapeHtml(product.card_number):'')+'</small><small>Market reference: '+escapeHtml(priceLabel(product.market_price))+(product.market_price_subtype?' · '+escapeHtml(product.market_price_subtype):'')+'</small></span></button>').join('');
  say(products.length?products.length+' result'+(products.length===1?'':'s')+' found. Select one to fill the listing.':'No matching products. Try a shorter name, card number, or another set.');
  if(data.partial&&products.length)say('Initial catalog import is in progress; results may be incomplete.');
 }catch(error){if(request===requestId){results.innerHTML='';say(error.message||'Catalog search failed.');}}
}
search.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(searchCatalog,400);});
search.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();clearTimeout(timer);searchCatalog();}});
type.addEventListener('change',()=>{if(search.value.trim().length>=2){clearTimeout(timer);searchCatalog();}});
set.addEventListener('change',()=>{if(search.value.trim().length>=2){clearTimeout(timer);searchCatalog();}});
results.addEventListener('click',event=>{const button=event.target.closest('[data-catalog-result]');if(!button)return;const product=products[Number(button.dataset.catalogResult)];if(!product)return;renderSelected(product);say('Catalog details selected. Set your own asking price and upload your photo below.');});
clearButton.addEventListener('click',clearSelection);
window.addEventListener('shop-listing-catalog-edit',event=>{const item=event.detail||{};if(item.tcgcsv_product_id){renderSelected(item);say('Saved catalog details loaded for this listing.');}else{selected.innerHTML='';selected.hidden=true;clearButton.hidden=true;}});
form.addEventListener('reset',()=>{setTimeout(()=>{clearTimeout(timer);requestId++;products=[];results.innerHTML='';selected.innerHTML='';selected.hidden=true;clearButton.hidden=true;search.value='';say('Type at least 2 characters to search.');},0);});
loadSets();
})();