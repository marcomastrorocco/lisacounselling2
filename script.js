document.querySelectorAll('.nav-links a').forEach((link)=>link.addEventListener('click',()=>{const toggle=document.querySelector('.nav-toggle');if(toggle)toggle.checked=false;}));
if(!document.querySelector('link[rel="icon"]'))document.head.insertAdjacentHTML('beforeend','<link rel="icon" href="/favicon.ico?v=2" sizes="any"><link rel="icon" href="/favicon.svg?v=2" type="image/svg+xml">');
const contactStatus=new URLSearchParams(location.search);
document.querySelectorAll('.contact-form').forEach((contactForm)=>{
  contactForm.action='/contact-submit.php';
  const honeypot=document.createElement('div');
  honeypot.hidden=true;
  honeypot.setAttribute('aria-hidden','true');
  honeypot.innerHTML='<label>Website<input name="website" tabindex="-1" autocomplete="off"></label>';
  contactForm.append(honeypot);
  if(contactStatus.get('sent')==='1')contactForm.insertAdjacentHTML('afterbegin','<p class="form-status success" role="status">Thank you. Your enquiry has been sent to SPES Counselling.</p>');
  if(contactStatus.get('error')==='1')contactForm.insertAdjacentHTML('afterbegin','<p class="form-status error" role="alert">Your enquiry could not be sent. Please email info@spescounselling.com.au directly.</p>');
});

const homeFooter=document.querySelector('.footer-main');
if(homeFooter&&!homeFooter.querySelector('.acknowledgement'))homeFooter.insertAdjacentHTML('beforeend','<div class="container acknowledgement"><img src="assets/acknowledgement-flags.png" alt="Aboriginal and Torres Strait Islander flags"><p>SPES Counselling acknowledges the Traditional Custodians of the lands on which we live and work. We pay our respects to Elders past and present and recognise the continuing connection of Aboriginal and Torres Strait Islander peoples to land, waters, culture and community.</p></div>');
