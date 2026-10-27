(function(){
'use strict';
var path=(window.location.pathname||'/').replace(/\/$/,'')||'/';
var page=path==='/'||path==='/index.html'?'home':path==='/chat.html'?'chat':path==='/events.html'?'events':path==='/giveaways.html'?'giveaways':'';
if(!page)return;
var css=`
.ppp-ad-slot{position:relative;box-sizing:border-box;display:flex;align-items:stretch;justify-content:center;overflow:hidden;color:#eaf1ff;background:linear-gradient(120deg,#061336,#102b62);border:1px solid rgba(130,157,202,.62);font:600 12px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;z-index:30;min-width:0;text-transform:none}
.ppp-ad-slot::before{content:none!important}.ppp-ad-slot *{box-sizing:border-box;text-transform:none}
.ppp-ad-slot a{color:inherit;text-decoration:none}
.ppp-ad-inner{display:flex;align-items:center;justify-content:center;gap:16px;width:100%;min-width:0;padding:20px 18px 13px}
.ppp-ad-copy{display:grid;gap:5px;min-width:0;max-width:690px;text-align:left}
.ppp-ad-label{font-size:9px;letter-spacing:.13em;text-transform:uppercase;color:#b8c8eb;font-weight:900}
.ppp-ad-headline{font-weight:1000;font-size:clamp(15px,2vw,21px);line-height:1.15;color:#fff;overflow-wrap:anywhere}
.ppp-ad-description{font-size:12px;color:#d8e4ff;line-height:1.4;overflow-wrap:anywhere}
.ppp-ad-cta{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:34px;padding:7px 11px;border:1px solid #ffd54a;border-radius:8px;background:#ffd54a;color:#10234c!important;font-weight:1000;font-size:11px;text-align:center;white-space:normal;flex-shrink:0}
.ppp-ad-art{display:block;width:100%;max-height:70px;object-fit:contain;border-radius:5px}
.ppp-ad-art-wrap{width:135px;max-width:24%;flex-shrink:0}
.ppp-ad-slot--top{width:min(970px,calc(100% - 32px));min-height:100px;margin:18px auto 24px;border-radius:10px}
.ppp-ad-slot--affiliate-banner{display:block!important;min-height:0!important;padding:0!important;border:0!important;border-radius:0!important;background:transparent!important;overflow:visible!important}
.ppp-amazon-banner-link{display:block;width:100%;line-height:0;border-radius:8px;overflow:hidden}
.ppp-amazon-banner-image{display:block;width:100%;height:auto;max-width:100%;border:0}
.ppp-amazon-affiliate-disclosure{margin:5px 0 0;text-align:center;color:#8fa2c6;font:10px/1.4 system-ui,-apple-system,\"Segoe UI\",sans-serif;letter-spacing:0;text-transform:none}
.ppp-ad-slot--inline{width:min(100%,920px);min-height:82px;margin:12px auto 16px;border-radius:10px}
.ppp-ad-slot--inline .ppp-ad-inner{padding:12px 15px}
.ppp-ad-slot--top .ppp-ad-inner{padding-top:23px}
.ppp-ad-slot--rail{position:fixed;top:175px;display:none;width:200px;height:440px;border-radius:10px}
.ppp-ad-slot--left{left:12px}
.ppp-ad-slot--right{right:12px}
.ppp-ad-slot--rail .ppp-ad-inner{flex-direction:column;align-items:center;justify-content:flex-start;gap:10px;padding:25px 8px 10px;text-align:center}
.ppp-ad-slot--rail .ppp-ad-copy{text-align:center;gap:9px;max-width:100%}
.ppp-ad-slot--rail .ppp-ad-headline{font-size:13px;line-height:1.25;overflow-wrap:anywhere}
.ppp-ad-slot--rail .ppp-ad-description{font-size:11px}
.ppp-ad-slot--rail .ppp-ad-cta{width:100%;white-space:normal;padding:7px 5px;font-size:10px}
.ppp-ad-slot--rail .ppp-ad-art-wrap{width:110px;max-width:100%}
.ppp-ad-slot--rail .ppp-ad-art{max-height:150px}
/* Uploaded artwork becomes the full clickable ad in the left and right rails. */
.ppp-ad-slot--image-creative{padding:0!important;background:#061336!important;align-items:stretch!important;justify-content:stretch!important}
.ppp-ad-slot--image-creative .ppp-ad-inner{display:block;width:100%;height:100%;padding:0!important}
.ppp-ad-slot--image-creative .ppp-ad-copy,.ppp-ad-slot--image-creative .ppp-ad-cta{display:none!important}
.ppp-ad-slot--image-creative .ppp-ad-art-wrap{display:block;width:100%;height:100%;max-height:none;max-width:100%;margin:0}
.ppp-ad-slot--image-creative .ppp-ad-art-link{display:flex;width:100%;height:100%;max-height:none;align-items:stretch;justify-content:stretch;overflow:hidden}
.ppp-ad-slot--image-creative .ppp-ad-art{display:block;width:100%;height:100%;max-height:none;object-fit:fill;object-position:center;border-radius:0}
@media(min-width:1280px){
 .ppp-ad-slot--rail{display:flex}
 body[data-view="home"] .wrap{max-width:min(1180px,calc(100% - 480px))}
 body .chat-wrap{width:min(1260px,calc(100% - 480px))}
 body .events-main{width:min(1180px,calc(100% - 480px))}
 body[data-page="giveaways"] .wrap{max-width:min(1180px,calc(100% - 480px))}
}
@media(max-width:1279px){.ppp-ad-slot--rail{display:none!important}}
@media(max-width:600px){.ppp-ad-slot--inline{min-height:64px;margin:8px auto 12px}.ppp-ad-slot--inline .ppp-ad-inner{gap:8px;padding:9px 8px}.ppp-ad-slot--top{min-height:70px;margin:12px auto 18px}.ppp-ad-slot--top .ppp-ad-inner{gap:9px;padding:21px 9px 8px}.ppp-ad-slot--top .ppp-ad-art-wrap{width:70px;max-width:24%}.ppp-ad-slot--top .ppp-ad-art{max-height:46px}.ppp-ad-slot--top .ppp-ad-headline{font-size:14px}.ppp-ad-slot--top .ppp-ad-description{font-size:10px}.ppp-ad-slot--top .ppp-ad-cta{min-height:30px;padding:6px 7px;font-size:10px}.ppp-ad-slot--top .ppp-ad-label{font-size:8px}}
`;
var style=document.createElement('style');style.setAttribute('data-ppp-ad-style','');style.textContent=css;document.head.appendChild(style);
function element(tag,className,text){
 var node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;
}
function validLink(raw){
 try{var url=new URL(raw,location.origin);if(url.protocol!=='https:'&&url.origin!==location.origin)return '';return url.href;}catch(_){return '';}
}
function make(slot,kind,label){
 var el=element('aside','ppp-ad-slot ppp-ad-slot--'+kind+(kind==='rail'?' ppp-ad-slot--'+label:''));
 el.dataset.adSlot=page+'-'+label;
 el.setAttribute('aria-label','Advertisement placement: '+page+' '+label);
 var inner=element('div','ppp-ad-inner');
 var copy=element('div','ppp-ad-copy');
 var kicker=element('span','ppp-ad-label','Advertising opportunity');
 var headline=element('strong','ppp-ad-headline','Reach Pokémon TCG collectors');
 var description=element('span','ppp-ad-description','Promote your shop, show, product launch, or hobby business on PokePrizePool.');
 var cta=element('a','ppp-ad-cta','Advertise with us ↗');cta.href='/advertise.html';
 copy.append(kicker,headline,description);
 inner.appendChild(copy);inner.appendChild(cta);el.appendChild(inner);
 el._pppAd={inner:inner,copy:copy,kicker:kicker,headline:headline,description:description,cta:cta};
 return el;
}
function houseAd(slot){
 var el=document.querySelector('[data-ad-slot="'+slot+'"]');if(!el||!el._pppAd)return;
 var ui=el._pppAd;el.classList.remove('ppp-ad-slot--image-creative');ui.kicker.textContent='Advertising opportunity';
 ui.headline.textContent='Reach Pokémon TCG collectors';
 ui.description.textContent='Promote your shop, show, product launch, or hobby business.';
 ui.cta.textContent='Advertise with us ↗';ui.cta.href='/advertise.html';
 var art=ui.inner.querySelector('.ppp-ad-art-wrap');if(art)art.remove();
}
function campaignAd(slot,campaign){
 var el=document.querySelector('[data-ad-slot="'+slot+'"]');if(!el||!el._pppAd||!campaign)return;
 var destination=validLink(campaign.destination_url);if(!destination)return;
 var ui=el._pppAd;
 ui.kicker.textContent=campaign.advertiser_name||'Sponsored';
 ui.headline.textContent=campaign.headline||campaign.advertiser_name||'Sponsored message';
 ui.description.textContent=campaign.body||'';
 ui.cta.textContent='Learn more ↗';ui.cta.href=destination;
 var existing=ui.inner.querySelector('.ppp-ad-art-wrap');if(existing)existing.remove();
 el.classList.remove('ppp-ad-slot--image-creative');
 var imageUrl=validLink(campaign.image_url||'');
 if(imageUrl){
  var wrap=element('div','ppp-ad-art-wrap');
  var isSideRail=/-left$|-right$/.test(slot);
  var img=element('img','ppp-ad-art');
  img.src=imageUrl;img.alt=String(campaign.headline||campaign.advertiser_name||'Sponsored advertisement');img.loading='lazy';img.referrerPolicy='no-referrer';
  if(isSideRail){
   el.classList.add('ppp-ad-slot--image-creative');
   var imageLink=element('a','ppp-ad-art-link');imageLink.href=destination;
   imageLink.setAttribute('aria-label','Open sponsored ad: '+String(campaign.headline||campaign.advertiser_name||'advertisement'));
   imageLink.title=String(campaign.headline||campaign.advertiser_name||'Sponsored advertisement');
   imageLink.appendChild(img);wrap.appendChild(imageLink);
  }else{
   wrap.appendChild(img);
  }
  img.addEventListener('error',function(){wrap.remove();el.classList.remove('ppp-ad-slot--image-creative');houseAd(slot);},{once:true});
  ui.inner.insertBefore(wrap,ui.inner.firstChild);
 }
}
function initializeSlot(el,slot,kind,label){
 if(el._pppAd)return;
 var prepared=make(slot,kind,label);
 el.className=prepared.className;
 el.replaceChildren(prepared._pppAd.inner);
 el._pppAd=prepared._pppAd;
 el.dataset.adSlot=slot;
 el.setAttribute('aria-label','Advertisement placement: '+page+' '+label);
}
function renderAmazonAffiliateBanner(slot){
 var el=document.querySelector('[data-ad-slot="'+slot+'"]');if(!el||el.dataset.pppAffiliateBanner==='1')return;
 el.dataset.pppAffiliateBanner='1';el.dataset.pppCampaignRequested='1';
 el.className='ppp-ad-slot ppp-ad-slot--top ppp-ad-slot--affiliate-banner';
 el.setAttribute('aria-label','Amazon affiliate banner');
 var link=element('a','ppp-amazon-banner-link');
 link.href='https://link.amazon/B07M8pu0H';link.target='_blank';link.rel='sponsored nofollow noopener noreferrer';
 link.setAttribute('aria-label','Shop on Amazon (opens in a new tab)');
 var img=element('img','ppp-amazon-banner-image');img.src='/images/amazon-banner.jpg';img.alt='Shop on Amazon';img.loading='eager';img.decoding='async';
 link.appendChild(img);
 var disclosure=element('p','ppp-amazon-affiliate-disclosure','As an Amazon Associate, PokePrizePool earns from qualifying purchases.');
 el.replaceChildren(link,disclosure);
 img.addEventListener('error',function(){el.dataset.pppAffiliateBanner='';el.classList.remove('ppp-ad-slot--affiliate-banner');houseAd(slot);},{once:true});
}
function renderLeftAmazonAffiliate(slot){
 var el=document.querySelector('[data-ad-slot="'+slot+'"]');if(!el||el.dataset.pppAffiliateLeftRail==='1'||!el._pppAd)return;
 el.dataset.pppAffiliateLeftRail='1';el.dataset.pppCampaignRequested='1';
 el.classList.add('ppp-ad-slot--image-creative');
 el.setAttribute('aria-label','Amazon affiliate advertisement');
 var link=element('a','ppp-ad-art-link');
 link.href='https://link.amazon/B06dqBzHt';link.target='_blank';link.rel='sponsored nofollow noopener noreferrer';
 link.setAttribute('aria-label','Shop on Amazon (opens in a new tab)');
 var img=element('img','ppp-ad-art');img.src='/images/leftsiderail.jpg';img.alt='Shop on Amazon';img.loading='lazy';img.decoding='async';img.referrerPolicy='no-referrer';
 link.appendChild(img);el._pppAd.inner.replaceChildren(link);
 img.addEventListener('error',function(){el.dataset.pppAffiliateLeftRail='';el.classList.remove('ppp-ad-slot--image-creative');houseAd(slot);},{once:true});
}
function renderRightAmazonAffiliate(slot){
 var el=document.querySelector('[data-ad-slot="'+slot+'"]');if(!el||el.dataset.pppAffiliateRightRail==='1'||!el._pppAd)return;
 el.dataset.pppAffiliateRightRail='1';el.dataset.pppCampaignRequested='1';
 el.classList.add('ppp-ad-slot--image-creative');
 el.setAttribute('aria-label','Amazon affiliate advertisement');
 var link=element('a','ppp-ad-art-link');
 link.href='https://link.amazon/B0hz4IRqX';link.target='_blank';link.rel='sponsored nofollow noopener noreferrer';
 link.setAttribute('aria-label','Shop on Amazon (opens in a new tab)');
 var img=element('img','ppp-ad-art');img.src='/images/ritesiderail.jpg';img.alt='Shop on Amazon';img.loading='lazy';img.decoding='async';img.referrerPolicy='no-referrer';
 link.appendChild(img);el._pppAd.inner.replaceChildren(link);
 img.addEventListener('error',function(){el.dataset.pppAffiliateRightRail='';el.classList.remove('ppp-ad-slot--image-creative');houseAd(slot);},{once:true});
}
function loadCampaign(slot){
 if(/-left$/.test(slot)){renderLeftAmazonAffiliate(slot);return;}
 if(/-right$/.test(slot)){renderRightAmazonAffiliate(slot);return;}
 if(slot==='home-top'){renderAmazonAffiliateBanner(slot);return;}
 var slotElement=document.querySelector('[data-ad-slot="'+slot+'"]');
 if(!slotElement||slotElement.dataset.pppCampaignRequested==='1')return;
 slotElement.dataset.pppCampaignRequested='1';
 fetch('/api/advertising?slot='+encodeURIComponent(slot),{credentials:'same-origin',cache:'no-store'})
  .then(function(response){if(!response.ok)throw new Error('Ad service unavailable');return response.json();})
  .then(function(data){if(data&&data.ok&&data.campaign)campaignAd(slot,data.campaign);})
  .catch(function(){/* The built-in house ad remains visible if campaign loading fails. */});
}
function addSlots(){
 var header=document.querySelector('header.site-nav-header');
 var topSlot=page+'-top',top=document.querySelector('[data-ad-slot="'+topSlot+'"]');
 if(!top){
  top=make(topSlot,'top','top');
  if(header&&header.parentNode)header.parentNode.insertBefore(top,header.nextSibling);
  else{
   var navRoot=document.getElementById('site-navigation');
   var main=document.querySelector('main')||document.getElementById('app');
   if(navRoot&&navRoot.parentNode)navRoot.parentNode.insertBefore(top,navRoot.nextSibling);
   else if(main&&main.parentNode)main.parentNode.insertBefore(top,main);
   else document.body.insertBefore(top,document.body.firstChild);
  }
 }else initializeSlot(top,topSlot,'top','top');
 loadCampaign(topSlot);
 ['left','right'].forEach(function(side){
  var slot=page+'-'+side,el=document.querySelector('[data-ad-slot="'+slot+'"]');
  if(!el){el=make(slot,'rail',side);document.body.appendChild(el);}
  else initializeSlot(el,slot,'rail',side);
  loadCampaign(slot);
 });
 if(page==='chat'){
  var inlineSlot='chat-inline',inline=document.querySelector('[data-ad-slot="'+inlineSlot+'"]');
  if(!inline){
   inline=make(inlineSlot,'inline','inline');
   var chatHero=document.querySelector('.chat-hero');
   if(chatHero&&chatHero.parentNode)chatHero.parentNode.insertBefore(inline,chatHero.nextSibling);
   else document.body.appendChild(inline);
  }else initializeSlot(inline,inlineSlot,'inline','inline');
  loadCampaign(inlineSlot);
 }
}
addSlots();
var observer=new MutationObserver(function(){addSlots();});
observer.observe(document.body,{childList:true,subtree:true});
window.addEventListener('load',addSlots,{once:true});
})();
