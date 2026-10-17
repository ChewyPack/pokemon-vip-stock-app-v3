/* Shared PokePrizePool navigation. Used by all content and account pages. */
(function(){
 'use strict';
 var root=document.getElementById('site-navigation');
 if(!root)return;
 function el(tag,attrs,children){var n=document.createElement(tag);Object.keys(attrs||{}).forEach(function(k){if(k==='text')n.textContent=attrs[k];else n.setAttribute(k,attrs[k]);});(children||[]).filter(Boolean).forEach(function(c){n.appendChild(c);});return n;}
 function link(label,href,cls){return el('a',{class:cls||'site-nav__link',href:href,text:label});}
 function dropdown(label,items){var id='site-nav-'+label.toLowerCase().replace(/[^a-z0-9]+/g,'-');var b=el('button',{class:'site-nav__toggle',type:'button','aria-expanded':'false','aria-controls':id,text:label+' ▾'});var menu=el('div',{class:'site-nav__menu',id:id,hidden:'hidden'});items.forEach(function(item){var a=el('a',{class:'site-nav__item',href:item.href});a.appendChild(el('span',{class:'site-nav__item-title',text:item.title}));if(item.description)a.appendChild(el('span',{class:'site-nav__item-description',text:item.description}));menu.appendChild(a);});b.addEventListener('click',function(){var open=b.getAttribute('aria-expanded')!=='true';root.querySelectorAll('.site-nav__toggle').forEach(function(x){x.setAttribute('aria-expanded','false');});root.querySelectorAll('.site-nav__menu').forEach(function(x){x.hidden=true;});if(open){b.setAttribute('aria-expanded','true');menu.hidden=false;}});return el('div',{class:'site-nav__dropdown'},[b,menu]);}
 var nav=el('nav',{class:'site-nav','aria-label':'Main navigation'},[
  link('Home','/#home'),
  dropdown('Poke Report',[
   {title:'Report a Sighting',description:'Submit an in-store stock report',href:'/#report'},
   {title:'News & Exclusives',description:'Pokémon news and hobby updates',href:'/news.html'},
   {title:'Market Intelligence',description:'Market trends and product insights',href:'/market-intelligence.html'},
   {title:'Events Calendar',description:'Shows, trade nights, and releases',href:'/events.html'}
  ]),
  dropdown('Collectors',[
   {title:'Collector Profiles',description:'Browse your profile and collections',href:'/collector.html'},
   {title:'Offer Inbox',description:'Cash offers and collection trades',href:'/inbox.html'},
   {title:'Account Settings',description:'Profile, privacy, and nearby matching',href:'/account.html#nearby-collector-settings'}
  ]),
  link('Report a Sighting','/#report'),
  link('Sign up / Log in','/account.html','site-nav__link account-nav-link')
 ]);
 var header=el('header',{class:'site-nav-header'},[el('div',{class:'wrap site-nav-header__inner'},[link('PokePrizePool','/'),nav])]);
 root.replaceChildren(header);
 fetch('/api/account/me',{credentials:'include',cache:'no-store'}).then(function(r){return r.ok?r.json():null;}).then(function(d){var a=root.querySelector('.account-nav-link');if(d&&d.ok&&d.authenticated){a.href='/collector.html';a.textContent='My Profile';a.setAttribute('aria-label','Open your collector profile');}}).catch(function(){});
 document.addEventListener('click',function(e){if(!root.contains(e.target)){root.querySelectorAll('.site-nav__toggle').forEach(function(b){b.setAttribute('aria-expanded','false');});root.querySelectorAll('.site-nav__menu').forEach(function(m){m.hidden=true;});}});
 root.addEventListener('keydown',function(e){if(e.key==='Escape'){root.querySelectorAll('.site-nav__toggle').forEach(function(b){b.setAttribute('aria-expanded','false');});root.querySelectorAll('.site-nav__menu').forEach(function(m){m.hidden=true;});}});
})();