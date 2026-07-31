document.querySelectorAll('.nav-links a').forEach((link)=>link.addEventListener('click',()=>{const toggle=document.querySelector('.nav-toggle');if(toggle)toggle.checked=false;}));
if(!document.querySelector('link[rel="icon"]'))document.head.insertAdjacentHTML('beforeend','<link rel="icon" href="/favicon.svg" type="image/svg+xml">');
document.head.insertAdjacentHTML('beforeend','<link rel="stylesheet" href="/styles.css?v=header-swish">');
