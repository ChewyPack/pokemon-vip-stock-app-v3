/* Shared PokePrizePool navigation. Used by all content and account pages. */
(function(){
 'use strict';
 var root=document.getElementById('site-navigation');
 if(!root)return;
 function el(tag,attrs,children){var n=document.createElement(tag);Object.keys(attrs||{}).forEach(function(k){if(k==='text')n.textContent=attrs[k];else n.setAttribute(k,attrs[k]);});(children||[]).filter(Boolean).forEach(function(c){n.appendChild(c);});return n;}
 function link(label,href,cls){return el('a',{class:cls||'site-nav__link',href:href,text:label});}
 function dropdown(label,items){
  var id='site-nav-'+label.toLowerCase().replace(/[^a-z0-9]+/g,'-');
  var b=el('button',{class:'site-nav__toggle',type:'button','aria-expanded':'false','aria-controls':id,text:label+' ▾'});
  var menu=el('div',{class:'site-nav__menu',id:id,hidden:'hidden'});
  items.forEach(function(item){
   if(item.children&&item.children.length){
    var subId=id+'-'+item.title.toLowerCase().replace(/[^a-z0-9]+/g,'-');
    var subButton=el('button',{class:'site-nav__item site-nav__submenu-toggle',type:'button','aria-expanded':'false','aria-controls':subId});
    subButton.appendChild(el('span',{class:'site-nav__item-title',text:item.title}));
    subButton.appendChild(el('span',{class:'site-nav__submenu-arrow',text:'›','aria-hidden':'true'}));
    var subMenu=el('div',{class:'site-nav__menu site-nav__submenu',id:subId,hidden:'hidden'});
    item.children.forEach(function(child){
     var childLink=el('a',{class:'site-nav__item',href:child.href});
     childLink.appendChild(el('span',{class:'site-nav__item-title',text:child.title}));
     subMenu.appendChild(childLink);
    });
    subButton.addEventListener('click',function(event){
     event.preventDefault();event.stopPropagation();
     var open=subButton.getAttribute('aria-expanded')!=='true';
     menu.querySelectorAll('.site-nav__submenu-toggle').forEach(function(other){other.setAttribute('aria-expanded','false');});
     menu.querySelectorAll('.site-nav__submenu').forEach(function(other){other.hidden=true;});
     if(open){subButton.setAttribute('aria-expanded','true');subMenu.hidden=false;}
    });
    menu.appendChild(el('div',{class:'site-nav__nested-dropdown'},[subButton,subMenu]));
   }else{
    var a=el('a',{class:'site-nav__item',href:item.href});
    a.appendChild(el('span',{class:'site-nav__item-title',text:item.title}));
    if(item.description)a.appendChild(el('span',{class:'site-nav__item-description',text:item.description}));
    menu.appendChild(a);
   }
  });
  b.addEventListener('click',function(){
   var open=b.getAttribute('aria-expanded')!=='true';
   root.querySelectorAll('.site-nav__toggle').forEach(function(x){x.setAttribute('aria-expanded','false');});
   root.querySelectorAll('.site-nav__menu').forEach(function(x){x.hidden=true;});
   root.querySelectorAll('.site-nav__submenu-toggle').forEach(function(x){x.setAttribute('aria-expanded','false');});
   if(open){b.setAttribute('aria-expanded','true');menu.hidden=false;}
  });
  return el('div',{class:'site-nav__dropdown'},[b,menu]);
 }
 var inboxWrap=el('div',{class:'site-nav__inbox-wrap'});
 var inbox=el('button',{class:'site-nav__link site-nav__inbox-link',type:'button','aria-label':'Open Notifications or Inbox','aria-expanded':'false','aria-controls':'site-nav-inbox-menu'});
 var inboxImage=el('img',{src:'/inbox-icon.png',alt:'',class:'site-nav__inbox-image'});
 var inboxBadge=el('span',{class:'site-nav__inbox-badge',hidden:'hidden','aria-live':'polite'});
 inbox.appendChild(inboxImage);inbox.appendChild(inboxBadge);
 var notificationMenuBadge=el('span',{class:'site-nav__menu-count site-nav__notification-count',hidden:'hidden','aria-label':'0 unread notifications'});
 var inboxMenuBadge=el('span',{class:'site-nav__menu-count site-nav__inbox-count',hidden:'hidden','aria-label':'0 unread Inbox items'});
 var notificationMenuLink=el('a',{class:'site-nav__inbox-menu-link',href:'/notifications.html'},[
  el('span',{class:'site-nav__inbox-menu-label',text:'Notifications'}),
  notificationMenuBadge
 ]);
 var inboxMenuLink=el('a',{class:'site-nav__inbox-menu-link',href:'/inbox.html'},[
  el('span',{class:'site-nav__inbox-menu-label',text:'Inbox'}),
  inboxMenuBadge
 ]);
 var inboxMenu=el('div',{class:'site-nav__inbox-menu',id:'site-nav-inbox-menu',hidden:'hidden'},[
  notificationMenuLink,
  inboxMenuLink
 ]);
 inboxWrap.appendChild(inbox);inboxWrap.appendChild(inboxMenu);
 inbox.addEventListener('click',function(event){event.stopPropagation();var open=inboxMenu.hidden;inboxMenu.hidden=!open;inbox.setAttribute('aria-expanded',String(open));});
 document.addEventListener('click',function(event){if(!inboxWrap.contains(event.target)){inboxMenu.hidden=true;inbox.setAttribute('aria-expanded','false');}});
 document.addEventListener('keydown',function(event){if(event.key==='Escape'){inboxMenu.hidden=true;inbox.setAttribute('aria-expanded','false');}});
 var alertsItems=[
  {title:'Live Stock',description:'Community-reported in-store sightings',href:'/alerts.html'},
  {title:'Target',description:'Target stock alerts',href:'/alerts.html?retailer=target'},
  {title:'Walmart',description:'Walmart stock alerts',href:'/alerts.html?retailer=walmart'},
  {title:'BestBuy',description:'Best Buy stock alerts',href:'/alerts.html?retailer=bestbuy'}
 ];
 var isCollectorProfile=!!document.getElementById('item-form')||/collector(?:\.html)?/.test(window.location.pathname);
 if(isCollectorProfile)alertsItems=alertsItems.filter(function(item){return item.title!=='Collector Notifications';});
 var nav=el('nav',{class:'site-nav','aria-label':'Main navigation'},[
  link('Home','/'),
  dropdown('Poke Report',[
   {title:'News',description:'Pokémon news and hobby coverage',href:'/news.html'},
   {title:'Updates',description:'Platform updates and announcements',href:'/updates.html'},
   {title:'Market Intelligence',description:'Market trends and product insights',href:'/market-intelligence.html'},
   {title:'Events',description:'Shows, trade nights, and releases',href:'/events.html'},
   {title:'Submit an Event',description:'Send an event to PokePrizePool for review',href:'/submit-event.html'},
   {title:'Instant Cashout',description:'Explore collection cash-out options',href:'/instant-buyout.html'}
  ]),
  dropdown('Alerts',alertsItems),
  link('Line Services','/line-services.html'),
  dropdown('Shop',[
   {title:'PokePrizePool Store',description:'Shop cards and merchandise sold directly by PokePrizePool',href:'/store.html'},
   {title:'Cards',description:'Browse official PokePrizePool cards',children:[
    {title:'Singles',href:'/store.html?category=Singles'},
    {title:'Sealed',href:'/store.html?category=Sealed'},
    {title:'Graded',href:'/store.html?category=Graded%20cards'}
   ]},
   {title:'Merch',description:'Shop official PokePrizePool merchandise',children:[
    {title:'Clothing',href:'/store.html?category=Clothing'},
    {title:'Plushies',href:'/store.html?category=Plushies'},
    {title:'Accessories',href:'/store.html?category=Accessories'},
    {title:'Other',href:'/store.html?category=Other'}
   ]},
   {title:'Collector Marketplace',description:'Browse listings posted by member shops',href:'/marketplace.html'},
   {title:'Manage My Shop',description:'Create or edit your member shop profile and listings',href:'/collector.html#shop'}
  ]),
  link('Giveaways','/giveaways.html'),
  link('Chat','/chat.html'),
  dropdown('Resources',[
   {title:'Securing Product',href:'/resources/securing-product.html'},
   {title:'Spotting Fakes',href:'/resources/spotting-fakes.html'},
   {title:'Pricing Cards',href:'/resources/pricing-cards.html'}
  ]),
  el('div',{class:'site-nav__account-actions'},[
   link('Log In / Sign Up','/account.html','site-nav__link account-nav-link'),
   inboxWrap
  ])
 ]);
 var installPromptEvent=null;
 var installButton=el('button',{class:'site-nav__link pwa-install-button',type:'button',text:'Install App'});
 installButton.hidden=true;
 installButton.addEventListener('click',async function(){
  if(installPromptEvent){
   var promptEvent=installPromptEvent;installPromptEvent=null;installButton.disabled=true;
   try{await promptEvent.prompt();var choice=await promptEvent.userChoice;if(choice&&choice.outcome==='accepted')installButton.hidden=true;}
   catch(error){console.warn('PWA install prompt failed:',error);}
   finally{installButton.disabled=false;}
   return;
  }
  if(/iPhone|iPad|iPod/i.test(navigator.userAgent)){
   window.alert('To install PokePrizePool on iPhone or iPad, open the Share menu in Safari and choose “Add to Home Screen.”');
  }
 });
 window.addEventListener('beforeinstallprompt',function(event){
  event.preventDefault();installPromptEvent=event;installButton.hidden=false;
 });
 window.addEventListener('appinstalled',function(){installPromptEvent=null;installButton.hidden=true;});
 if(/iPhone|iPad|iPod/i.test(navigator.userAgent))installButton.hidden=false;
 nav.appendChild(installButton);
 var header=el('header',{class:'site-nav-header'},[el('div',{class:'wrap site-nav-header__inner'},[nav])]);
 root.replaceChildren(header);
 if('serviceWorker' in navigator){
  window.addEventListener('load',function(){
   navigator.serviceWorker.register('/service-worker.js',{scope:'/'}).catch(function(error){console.warn('PokePrizePool offline support could not be registered:',error);});
  });
 }
 var inboxStyle=el('style',{},[]);inboxStyle.textContent='.site-nav__inbox-link{position:relative;display:inline-flex;flex:0 0 48px;align-items:center;justify-content:center;gap:0;width:48px;min-width:48px;height:48px;min-height:48px;padding:0!important;margin:0 2px;border:0!important;border-radius:0!important;background:transparent!important;box-shadow:none!important;outline-offset:3px;vertical-align:middle}.site-nav__inbox-link:hover,.site-nav__inbox-link:focus-visible{border:0!important;background:transparent!important;box-shadow:none!important;transform:none!important}.site-nav__inbox-image{width:48px;height:48px;object-fit:contain;display:block;border:0!important;outline:0;box-shadow:none}.site-nav .site-nav__inbox-link:last-child{flex:0 0 48px!important;width:48px;min-width:48px;padding:0!important;border:0!important;border-radius:0!important;background:transparent!important;color:inherit!important}.site-nav__inbox-badge:not([hidden]){position:absolute;top:auto;right:0;bottom:0;display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 5px;border-radius:999px;background:#ef233c;color:#fff;font-size:.7rem;font-weight:700;line-height:1;box-shadow:0 0 0 2px #06174a;z-index:2}.site-nav__inbox-badge[hidden]{display:none!important}@media(max-width:560px){.site-nav__inbox-link{flex:0 0 96px;width:44px;min-width:44px;height:44px;min-height:44px}.site-nav__inbox-image{width:44px;height:44px}.site-nav .site-nav__inbox-link:last-child{flex-basis:44px!important;width:44px;min-width:44px}}';inboxStyle.textContent += '.site-nav__inbox-wrap{position:relative;display:inline-flex;align-items:center;flex:0 0 auto}.site-nav .site-nav__inbox-wrap .site-nav__inbox-link{font:inherit;color:inherit;cursor:pointer;flex:0 0 48px;width:48px;min-width:48px;height:48px;min-height:48px}.site-nav__inbox-menu{position:absolute;z-index:1100;right:0;top:calc(100% + 6px);min-width:170px;padding:6px;background:#fff;border:1px solid #d5e0f2;border-radius:10px;box-shadow:0 8px 24px #07194d22}.site-nav__inbox-menu[hidden]{display:none!important}.site-nav__inbox-menu-link{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:10px;border-radius:7px;color:#17386c!important;text-decoration:none;font:900 .9rem Nunito,system-ui,sans-serif;white-space:nowrap}.site-nav__inbox-menu-link:hover,.site-nav__inbox-menu-link:focus-visible{background:#f3f7ff}.site-nav__menu-count:not([hidden]){display:inline-flex;align-items:center;justify-content:center;min-width:21px;height:21px;padding:0 6px;border-radius:999px;background:#ef233c;color:#fff;font:900 .72rem/1 Nunito,system-ui,sans-serif;box-shadow:0 1px 3px #07194d22}.site-nav__menu-count[hidden]{display:none!important}@media(max-width:560px){.site-nav .site-nav__inbox-wrap .site-nav__inbox-link{flex:0 0 96px;width:44px;min-width:44px;height:44px;min-height:44px}.site-nav__inbox-menu{min-width:160px}}';root.prepend(inboxStyle);
 function refreshInboxBadge(){
  Promise.all([
   fetch('/api/collector/trades',{credentials:'include',cache:'no-store'}).then(function(r){return r.ok?r.json():null;}).catch(function(){return null;}),
   fetch('/api/notifications',{credentials:'include',cache:'no-store'}).then(function(r){return r.ok?r.json():null;}).catch(function(){return null;}),
   fetch('/api/collector/direct-messages',{credentials:'include',cache:'no-store'}).then(function(r){return r.ok?r.json():null;}).catch(function(){return null;})
  ]).then(function(results){
   var offers=results[0]&&results[0].ok?(results[0].offers||[]).filter(function(o){return o.direction==='incoming'&&!o.recipient_read_at&&o.status==='pending';}).length:0;
   var notes=results[1]&&results[1].ok?(results[1].notifications||[]).filter(function(n){return !n.read_at&&n.notification_type!=='direct_message';}).length:0;
   var messages=results[2]&&results[2].ok?(results[2].conversations||[]).reduce(function(sum,m){return sum+Number(m.unread_count||0);},0):0;
   var inboxCount=offers+messages;
   var count=inboxCount+notes;
   function setMenuCount(badge,value,label){
    badge.hidden=value<1;badge.textContent=value>99?'99+':String(value);
    badge.setAttribute('aria-label',value+' unread '+label);
   }
   setMenuCount(notificationMenuBadge,notes,'notifications');
   setMenuCount(inboxMenuBadge,inboxCount,'Inbox items');
   inboxBadge.hidden=count<1;inboxBadge.textContent=count>99?'99+':String(count);
   inboxBadge.setAttribute('aria-label',count+' unread items in Notifications and Inbox');
   inbox.setAttribute('aria-label','Open Notifications or Inbox'+(count?' ('+count+' unread)':''));
  });
 }
 refreshInboxBadge();setInterval(refreshInboxBadge,60000);window.addEventListener('collector-offers-updated',refreshInboxBadge);
 fetch('/api/account/me',{credentials:'include',cache:'no-store'}).then(function(r){return r.ok?r.json():null;}).then(function(d){var a=root.querySelector('.account-nav-link');if(d&&d.ok&&d.authenticated){a.href='/collector.html';a.textContent='Profile';a.setAttribute('aria-label','Open your collector profile');var wrap=el('div',{class:'site-nav__profile-wrap'});var trigger=el('button',{class:'site-nav__profile-menu-trigger',type:'button','aria-label':'My Profile options','aria-expanded':'false',text:'▾'});var menu=el('div',{class:'site-nav__profile-menu',hidden:'hidden'});var settings=el('a',{class:'site-nav__profile-menu-settings',href:'/account.html#nearby-collector-settings',text:'Settings'});var newsFeed=el('a',{class:'site-nav__profile-menu-settings site-nav__profile-menu-newsfeed',href:'/newsfeed',text:'News Feed'});menu.appendChild(newsFeed);menu.appendChild(settings);var logout=el('button',{type:'button',text:'Log Out'});logout.addEventListener('click',function(){logout.disabled=true;logout.textContent='Logging out…';fetch('/api/account/logout',{method:'POST',credentials:'include'}).then(function(r){if(!r.ok)throw new Error('Logout failed');location.href='/account.html';}).catch(function(){logout.disabled=false;logout.textContent='Log Out';});});menu.appendChild(logout);trigger.addEventListener('click',function(){var open=menu.hidden;menu.hidden=!open;trigger.setAttribute('aria-expanded',String(open));});var accountParent=a.parentNode;accountParent.insertBefore(wrap,a);wrap.appendChild(a);wrap.appendChild(trigger);wrap.appendChild(menu);var st=el('style',{});st.textContent='.site-nav__profile-wrap{position:relative;display:inline-flex;align-items:center;gap:4px}.site-nav__profile-menu-trigger{min-height:40px;border:1px solid #b9c9e6;border-radius:8px;background:#f3f7ff;color:#17386c;font:900 1rem Nunito,system-ui,sans-serif;cursor:pointer}.site-nav__profile-menu{position:absolute;z-index:1000;right:0;top:calc(100% + 6px);min-width:130px;padding:5px;background:#fff;border:1px solid #d5e0f2;border-radius:9px;box-shadow:0 8px 22px #07194d22}.site-nav__profile-menu[hidden]{display:none!important}.site-nav__profile-menu button,.site-nav__profile-menu-settings{box-sizing:border-box;display:block;width:100%;padding:10px;border:0;border-radius:6px;background:#fff;color:#17386c;text-align:left;text-decoration:none;font:900 .9rem Nunito,system-ui,sans-serif;cursor:pointer}.site-nav__profile-menu-settings{border-bottom:1px solid #e2e9f5;border-radius:6px 6px 0 0}.site-nav__profile-menu-settings:hover{background:#f3f7ff}.site-nav__profile-menu button{color:#a32222}.site-nav__profile-menu button:hover{background:#fff0ef}';root.prepend(st);}}).catch(function(){});
 document.addEventListener('click',function(e){if(!root.contains(e.target)){root.querySelectorAll('.site-nav__toggle').forEach(function(b){b.setAttribute('aria-expanded','false');});root.querySelectorAll('.site-nav__menu').forEach(function(m){m.hidden=true;});}});
 root.addEventListener('keydown',function(e){if(e.key==='Escape'){root.querySelectorAll('.site-nav__toggle').forEach(function(b){b.setAttribute('aria-expanded','false');});root.querySelectorAll('.site-nav__menu').forEach(function(m){m.hidden=true;});}});

 // Report authenticated collector presence per browser tab, so chat and admin tabs do not overwrite each other.
 (function(){
  var page = location.pathname || "/";
  // Generate an in-memory ID for this page instance. sessionStorage can be copied
  // when a tab is duplicated, causing two tabs to overwrite the same presence row.
  var tabId = (window.crypto && typeof window.crypto.randomUUID === "function")
    ? window.crypto.randomUUID().replace(/-/g, "")
    : "tab_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  function beat(){
   if(document.visibilityState === "hidden") return;
   fetch("/api/presence", {method:"POST",credentials:"include",cache:"no-store",headers:{"content-type":"application/json"},body:JSON.stringify({page:page,tab_id:tabId})}).catch(function(){});
  }
  beat();
  window.setInterval(beat, 30000);
  document.addEventListener("visibilitychange", function(){ if(document.visibilityState === "visible") beat(); });
 })();

})();