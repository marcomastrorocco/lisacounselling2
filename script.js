document.querySelectorAll('.nav-links a').forEach((link)=>link.addEventListener('click',()=>{const toggle=document.querySelector('.nav-toggle');if(toggle)toggle.checked=false;}));
document.head.insertAdjacentHTML('beforeend','<link rel="stylesheet" href="/styles.css?v=light20">');
