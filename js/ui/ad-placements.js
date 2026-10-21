(function(){
'use strict';
var path=(window.location.pathname||'/').replace(/\/$/,'')||'/';
var page=path==='/'||path==='/index.html'?'home':path==='/chat.html'?'chat':path==='/events.html'?'events':path==='/giveaways.html'?'giveaways':'';
if(!page)return;
var css=`
.ppp-ad-slot{position:relative;box-sizing:border-box;display:flex;align-items:center;justify-content:center;text-align:center;overflow:hidden;color:#8898b8;background:rgba(12,23,48,.88);border:1px dashed rgba(130,157,202,.52);font:700 12px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;letter-spacing:.08em;text-transform:uppercase;z-index:30}
.ppp-ad-slot::before{content:"Advertisement";position:absolute;top:5px;left:8px;font-size:9px;letter-spacing:.12em;color:#7183a7}
.ppp-ad-slot--top{width:min(970px,calc(100% - 32px));min-height:100px;margin:18px auto 24px;padding:24px 12px 12px;border-radius:10px}
.ppp-ad-slot--rail{position:fixed;top:170px;width:160px;height:600px;padding:24px 8px 8px;border-radius:10px}
.ppp-ad-slot--left{left:12px}
.ppp-ad-slot--right{right:12px}
@media(max-width:1499px){.ppp-ad-slot--rail{display:none!important}}
@media(max-width:600px){.ppp-ad-slot--top{min-height:70px;margin:12px auto 18px;font-size:10px}}
`;
var style=document.createElement('style');style.setAttribute('data-ppp-ad-style','');style.textContent=css;document.head.appendChild(style);
function make(slot,kind,label){
 var el=document.createElement('aside');
 el.className='ppp-ad-slot ppp-ad-slot--'+kind;
 if(kind==='rail')el.classList.add('ppp-ad-slot--'+label);
 el.dataset.adSlot=page+'-'+label;
 el.setAttribute('aria-label','Advertisement placement: '+page+' '+label);
 el.textContent='Ad placement · '+page+' · '+label;
 return el;
}
function addSlots(){
 var header=document.querySelector('header.site-nav-header');
 if(!document.querySelector('[data-ad-slot="'+page+'-top"]')){
  var top=make('top','top','top');
  if(header&&header.parentNode)header.parentNode.insertBefore(top,header.nextSibling);
  else{
   var navRoot=document.getElementById('site-navigation');
   var main=document.querySelector('main')||document.getElementById('app');
   if(navRoot&&navRoot.parentNode)navRoot.parentNode.insertBefore(top,navRoot.nextSibling);
   else if(main&&main.parentNode)main.parentNode.insertBefore(top,main);
   else document.body.insertBefore(top,document.body.firstChild);
  }
 }
 if(!document.querySelector('[data-ad-slot="'+page+'-left"]'))document.body.appendChild(make('left','rail','left'));
 if(!document.querySelector('[data-ad-slot="'+page+'-right"]'))document.body.appendChild(make('right','rail','right'));
}
addSlots();
var observer=new MutationObserver(function(){addSlots();});
observer.observe(document.body,{childList:true,subtree:true});
window.addEventListener('load',addSlots,{once:true});
})();