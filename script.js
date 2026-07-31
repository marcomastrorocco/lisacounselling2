document.querySelectorAll('.nav-links a').forEach((link)=>link.addEventListener('click',()=>{const toggle=document.querySelector('.nav-toggle');if(toggle)toggle.checked=false;}));
if(!document.querySelector('link[rel="icon"]'))document.head.insertAdjacentHTML('beforeend','<link rel="icon" href="/favicon.ico?v=2" sizes="any"><link rel="icon" href="/favicon.svg?v=2" type="image/svg+xml">');
document.head.insertAdjacentHTML('beforeend','<link rel="stylesheet" href="/styles.css?v=header-swish">');
const contactStatus=new URLSearchParams(location.search);
const contactForm=document.querySelector('.contact-form');
if(contactForm){
  contactForm.action='/contact-submit.php';
  const honeypot=document.createElement('div');
  honeypot.hidden=true;
  honeypot.setAttribute('aria-hidden','true');
  honeypot.innerHTML='<label>Website<input name="website" tabindex="-1" autocomplete="off"></label>';
  contactForm.append(honeypot);
  if(contactStatus.get('sent')==='1')contactForm.insertAdjacentHTML('afterbegin','<p class="form-status success" role="status">Thank you. Your enquiry has been sent to SPES Counselling.</p>');
  if(contactStatus.get('error')==='1')contactForm.insertAdjacentHTML('afterbegin','<p class="form-status error" role="alert">Your enquiry could not be sent. Please email info@spescounselling.com.au directly.</p>');
}
