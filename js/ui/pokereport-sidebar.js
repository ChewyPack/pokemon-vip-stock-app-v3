(function(){
  'use strict';
  var reportPages = ['/', '/index.html', '/news.html', '/updates.html', '/market-intelligence.html', '/events.html', '/instant-buyout.html'];
  var currentPath = location.pathname.replace(/\/$/, '') || '/';
  if (reportPages.indexOf(currentPath) === -1) return;
  if(document.getElementById('pokereport-sidebar')) return;
  var links=[
    {label:'PokéReport Home',href:'/'},
    {label:'News',href:'/news.html'},
    {label:'Platform Updates',href:'/updates.html'},
    {label:'Market Intelligence',href:'/market-intelligence.html'},
    {label:'Events Calendar',href:'/events.html'},
    {label:'Instant Buyout',href:'/instant-buyout.html'}
  ];
  var path=location.pathname.replace(/\/$/,'')||'/';
  var style=document.createElement('style');
  style.textContent=`
    #pokereport-sidebar{position:fixed;z-index:900;left:0;top:0;bottom:0;width:218px;padding:22px 14px;box-sizing:border-box;background:rgba(5,13,34,.97);border-right:1px solid rgba(130,170,240,.24);color:#f4f7ff;overflow-y:auto;font-family:Barlow,Arial,sans-serif}
    #pokereport-sidebar .pr-side-brand{display:block;margin:0 8px 8px;color:#fff;font-weight:900;font-size:1.05rem;text-decoration:none;letter-spacing:.03em}
    #pokereport-sidebar .pr-side-sub{margin:0 8px 22px;color:#9fb3d9;font-size:.76rem;line-height:1.4}
    #pokereport-sidebar nav{display:grid;gap:6px}
    #pokereport-sidebar nav a{display:block;padding:11px 12px;border:1px solid transparent;border-radius:9px;color:#d7e3fb;text-decoration:none;font-size:.9rem;font-weight:700}
    #pokereport-sidebar nav a:hover,#pokereport-sidebar nav a[aria-current=page]{background:rgba(76,133,232,.18);border-color:rgba(117,183,255,.38);color:#fff}
    #pokereport-sidebar .pr-side-note{margin:24px 8px 0;color:#8197c0;font-size:.75rem;line-height:1.5}
    @media(min-width:901px){body{padding-left:218px!important;box-sizing:border-box}#pokereport-sidebar{width:218px}}
    @media(max-width:900px){#pokereport-sidebar{position:relative;top:auto;bottom:auto;width:auto;padding:10px 12px;border-right:0;border-bottom:1px solid rgba(130,170,240,.24)}#pokereport-sidebar .pr-side-brand{margin:0 4px 4px}#pokereport-sidebar .pr-side-sub{margin:0 4px 9px}#pokereport-sidebar nav{display:flex;gap:6px;overflow-x:auto;padding-bottom:3px}#pokereport-sidebar nav a{white-space:nowrap;padding:8px 10px;font-size:.82rem}#pokereport-sidebar .pr-side-note{display:none}}
  `;
  document.head.appendChild(style);
  var aside=document.createElement('aside');aside.id='pokereport-sidebar';aside.setAttribute('aria-label','PokéReport sections');
  var brand=document.createElement('a');brand.className='pr-side-brand';brand.href='/';brand.textContent='PokePrizePool';
  var sub=document.createElement('p');sub.className='pr-side-sub';sub.textContent='PokéReport · Collector intelligence';
  var nav=document.createElement('nav');nav.setAttribute('aria-label','PokéReport navigation');
  links.forEach(function(item){
    var a=document.createElement('a');a.href=item.href;a.textContent=item.label;
    var target=item.href==='/'?'/':item.href;
    if(path===target||(target!=='/'&&path===target.replace(/\.html$/,''))){a.setAttribute('aria-current','page');}
    nav.appendChild(a);
  });
  var note=document.createElement('p');note.className='pr-side-note';note.textContent='Restock reports, market research, local events, and collector services.';
  aside.appendChild(brand);aside.appendChild(sub);aside.appendChild(nav);aside.appendChild(note);
  document.body.insertBefore(aside,document.body.firstChild);
})();