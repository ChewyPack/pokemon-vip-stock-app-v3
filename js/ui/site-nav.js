/* Shared PokePrizePool navigation. Used by all content and account pages. */
(function(){
 'use strict';
 var root=document.getElementById('site-navigation');
 if(!root)return;
 function el(tag,attrs,children){var n=document.createElement(tag);Object.keys(attrs||{}).forEach(function(k){if(k==='text')n.textContent=attrs[k];else n.setAttribute(k,attrs[k]);});(children||[]).filter(Boolean).forEach(function(c){n.appendChild(c);});return n;}
 function link(label,href,cls){return el('a',{class:cls||'site-nav__link',href:href,text:label});}
 function dropdown(label,items){var id='site-nav-'+label.toLowerCase().replace(/[^a-z0-9]+/g,'-');var b=el('button',{class:'site-nav__toggle',type:'button','aria-expanded':'false','aria-controls':id,text:label+' ▾'});var menu=el('div',{class:'site-nav__menu',id:id,hidden:'hidden'});items.forEach(function(item){var a=el('a',{class:'site-nav__item',href:item.href});a.appendChild(el('span',{class:'site-nav__item-title',text:item.title}));if(item.description)a.appendChild(el('span',{class:'site-nav__item-description',text:item.description}));menu.appendChild(a);});b.addEventListener('click',function(){var open=b.getAttribute('aria-expanded')!=='true';root.querySelectorAll('.site-nav__toggle').forEach(function(x){x.setAttribute('aria-expanded','false');});root.querySelectorAll('.site-nav__menu').forEach(function(x){x.hidden=true;});if(open){b.setAttribute('aria-expanded','true');menu.hidden=false;}});return el('div',{class:'site-nav__dropdown'},[b,menu]);}
 var inbox=el('a',{class:'site-nav__link site-nav__inbox-link',href:'/inbox.html','aria-label':'Offer inbox'});
 var inboxImage=el('img',{src:'/inbox-icon.png',alt:'',class:'site-nav__inbox-image'});
  var inboxBadge=el('span',{class:'site-nav__inbox-badge',hidden:'hidden','aria-live':'polite'});
 inbox.appendChild(inboxImage);inbox.appendChild(inboxBadge);
 var alertsItems=[
  {title:'Live Stock',description:'Community-reported in-store sightings',href:'/alerts.html'},
  {title:'Collector Notifications',description:'Browser alerts and your notification inbox',href:'/notifications.html'},
  {title:'Target Online Alerts · Coming Soon',description:'Online inventory alerts for Target',href:'/alerts.html?retailer=target'},
  {title:'Walmart Online Alerts · Coming Soon',description:'Online inventory alerts for Walmart',href:'/alerts.html?retailer=walmart'},
  {title:'Best Buy Online Alerts · Coming Soon',description:'Online inventory alerts for Best Buy',href:'/alerts.html?retailer=bestbuy'}
 ];
 var isCollectorProfile=!!document.getElementById('item-form')||/collector(?:\.html)?/.test(window.location.pathname);
 if(isCollectorProfile)alertsItems=alertsItems.filter(function(item){return item.title!=='Collector Notifications';});
 var nav=el('nav',{class:'site-nav','aria-label':'Main navigation'},[
  link('Home','/'),
  dropdown('Poke Report',[
   {title:'Report a Sighting',description:'Submit an in-store stock report',href:'/#report'},
   {title:'News & Exclusives',description:'Pokémon news and hobby updates',href:'/news.html'},
   {title:'Market Intelligence',description:'Market trends and product insights',href:'/market-intelligence.html'},
   {title:'Events Calendar',description:'Shows, trade nights, and releases',href:'/events.html'},
   {title:'Instant Cash Out',description:'Explore collection cash-out options',href:'/instant-buyout.html'}
  ]),
  dropdown('Alerts',alertsItems),
  link('Line Services','/line-services.html'),
  dropdown('Shop',[
   {title:'Shop All',description:'Browse the PokePrizePool shop',href:'/shop.html'},
   {title:'Sealed Cards',description:'Sealed Pokémon products',href:'/shop.html?category=sealed'},
   {title:'Slabs',description:'Graded cards',href:'/shop.html?category=slabs'},
   {title:'Singles',description:'Individual cards',href:'/shop.html?category=singles'},
   {title:'Clothing',description:'PokePrizePool clothing',href:'/shop.html?category=clothing'},
   {title:'Plushies',description:'Pokémon plushies',href:'/shop.html?category=plushies'},
   {title:'Other Merch',description:'More merchandise',href:'/shop.html?category=other'}
  ]),
  link('Giveaways','/giveaways.html'),
  link('Chat','/chat.html'),
  dropdown('Resources',[
   {title:'Collector Profiles',description:'Browse collector profiles and collections',href:'/collector.html'},
   {title:'Offer Inbox',description:'Cash offers and collection trades',href:'/inbox.html'},
   {title:'Account Settings',description:'Profile and privacy settings',href:'/account.html#nearby-collector-settings'},
   {title:'News & Exclusives',description:'Pokémon news and hobby updates',href:'/news.html'},
   {title:'Events Calendar',description:'Shows, trade nights, and releases',href:'/events.html'},
   {title:'Market Intelligence',description:'Pokémon TCG market trends',href:'/market-intelligence.html'},
   {title:'Securing Product',description:'Interactive Pokémon TCG drop-day playbook and route planner',href:'/resources/securing-product.html'}
  ]),
  link('Sign up / Log in','/account.html','site-nav__link account-nav-link'),
  inbox
 ]);
 var header=el('header',{class:'site-nav-header'},[el('div',{class:'wrap site-nav-header__inner'},[nav])]);
 root.replaceChildren(header);
 var inboxStyle=el('style',{},[]);inboxStyle.textContent='.site-nav__inbox-link{position:relative;display:inline-flex;align-items:center;justify-content:center;gap:0;padding:0;min-width:110px;min-height:110px;border:0!important;border-radius:0!important;background:transparent!important;box-shadow:none!important;outline-offset:3px}.site-nav__inbox-link:hover,.site-nav__inbox-link:focus-visible{border:0!important;background:transparent!important;box-shadow:none!important;transform:none!important}.site-nav__inbox-image{width:105px;height:105px;object-fit:contain;display:block;border:0!important;outline:0;box-shadow:none}.site-nav__inbox-badge:not([hidden]){position:absolute;top:auto;right:18px;bottom:16px;display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:22px;padding:0 6px;border-radius:999px;background:#ef233c;color:#fff;font-size:.72rem;font-weight:700;line-height:1;box-shadow:0 0 0 2px #06174a;z-index:2}.site-nav__inbox-badge[hidden]{display:none!important}@media(max-width:560px){.site-nav__inbox-link{min-width:94px;min-height:94px}.site-nav__inbox-image{width:90px;height:90px}}';root.prepend(inboxStyle);
 function refreshInboxBadge(){fetch('/api/collector/trades',{credentials:'include',cache:'no-store'}).then(function(r){return r.ok?r.json():null;}).then(function(d){if(!d||!d.ok)return;var count=(d.offers||[]).filter(function(o){return o.direction==='incoming'&&!o.recipient_read_at;}).length;inboxBadge.hidden=count<1;inboxBadge.textContent=count>99?'99+':String(count);inboxBadge.setAttribute('aria-label',count+' unread offer'+(count===1?'':'s'));inbox.setAttribute('aria-label',count+' unread offer'+(count===1?'':'s'));}).catch(function(){});}
 refreshInboxBadge();setInterval(refreshInboxBadge,60000);window.addEventListener('collector-offers-updated',refreshInboxBadge);
 fetch('/api/account/me',{credentials:'include',cache:'no-store'}).then(function(r){return r.ok?r.json():null;}).then(function(d){var a=root.querySelector('.account-nav-link');if(d&&d.ok&&d.authenticated){a.href='/collector.html';a.textContent='My Profile';a.setAttribute('aria-label','Open your collector profile');var wrap=el('div',{class:'site-nav__profile-wrap'});var trigger=el('button',{class:'site-nav__profile-menu-trigger',type:'button','aria-label':'My Profile options','aria-expanded':'false',text:'▾'});var menu=el('div',{class:'site-nav__profile-menu',hidden:'hidden'});var settings=el('a',{class:'site-nav__profile-menu-settings',href:'/account.html#nearby-collector-settings',text:'Settings'});menu.appendChild(settings);var logout=el('button',{type:'button',text:'Log Out'});logout.addEventListener('click',function(){logout.disabled=true;logout.textContent='Logging out…';fetch('/api/account/logout',{method:'POST',credentials:'include'}).then(function(r){if(!r.ok)throw new Error('Logout failed');location.href='/account.html';}).catch(function(){logout.disabled=false;logout.textContent='Log Out';});});menu.appendChild(logout);trigger.addEventListener('click',function(){var open=menu.hidden;menu.hidden=!open;trigger.setAttribute('aria-expanded',String(open));});wrap.appendChild(trigger);wrap.appendChild(menu);a.parentNode.insertBefore(wrap,a.nextSibling);var st=el('style',{});st.textContent='.site-nav__profile-wrap{position:relative;display:inline-flex;align-items:center;margin-left:-8px}.site-nav__profile-menu-trigger{min-height:40px;border:1px solid #b9c9e6;border-radius:8px;background:#f3f7ff;color:#17386c;font:900 1rem Nunito,system-ui,sans-serif;cursor:pointer}.site-nav__profile-menu{position:absolute;z-index:1000;right:0;top:calc(100% + 6px);min-width:130px;padding:5px;background:#fff;border:1px solid #d5e0f2;border-radius:9px;box-shadow:0 8px 22px #07194d22}.site-nav__profile-menu[hidden]{display:none!important}.site-nav__profile-menu button,.site-nav__profile-menu-settings{box-sizing:border-box;display:block;width:100%;padding:10px;border:0;border-radius:6px;background:#fff;color:#17386c;text-align:left;text-decoration:none;font:900 .9rem Nunito,system-ui,sans-serif;cursor:pointer}.site-nav__profile-menu-settings{border-bottom:1px solid #e2e9f5;border-radius:6px 6px 0 0}.site-nav__profile-menu-settings:hover{background:#f3f7ff}.site-nav__profile-menu button{color:#a32222}.site-nav__profile-menu button:hover{background:#fff0ef}';root.prepend(st);}}).catch(function(){});
 document.addEventListener('click',function(e){if(!root.contains(e.target)){root.querySelectorAll('.site-nav__toggle').forEach(function(b){b.setAttribute('aria-expanded','false');});root.querySelectorAll('.site-nav__menu').forEach(function(m){m.hidden=true;});}});
 root.addEventListener('keydown',function(e){if(e.key==='Escape'){root.querySelectorAll('.site-nav__toggle').forEach(function(b){b.setAttribute('aria-expanded','false');});root.querySelectorAll('.site-nav__menu').forEach(function(m){m.hidden=true;});}});
})();