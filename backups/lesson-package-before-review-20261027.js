import {unzipSync} from './vendor/fflate.js';

export const MAX_STORED_BYTES = 20 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 14 * 1024 * 1024;
const TYPES = {html:'text/html',htm:'text/html',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',svg:'image/svg+xml',gif:'image/gif',webp:'image/webp',mp3:'audio/mpeg',mp4:'video/mp4',ogg:'audio/ogg',wav:'audio/wav',webm:'video/webm',css:'text/css',js:'text/javascript',mjs:'text/javascript',json:'application/json',txt:'text/plain',vtt:'text/vtt',woff:'font/woff',woff2:'font/woff2',ttf:'font/ttf',ico:'image/x-icon'};

function base64(bytes) {
  let s='';
  for(let i=0;i<bytes.length;i+=32768)s+=String.fromCharCode(...bytes.subarray(i,i+32768));
  return btoa(s);
}

function zipDirectory(bytes) {
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  let end=-1;
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--){
    if(view.getUint32(i,true)===0x06054b50&&i+22+view.getUint16(i+20,true)===bytes.length){end=i;break;}
  }
  if(end<0)throw Error('Missing ZIP directory (the file may be truncated).');
  if(view.getUint16(end+4,true)||view.getUint16(end+6,true))throw Error('Multi-disk ZIP archives are unsupported.');
  const count=view.getUint16(end+10,true),size=view.getUint32(end+12,true),start=view.getUint32(end+16,true);
  if(count>1000||count===65535||start+size!==end)throw Error('ZIP64, oversized or invalid ZIP directory.');
  const crcs=new Map();let at=start;
  for(let i=0;i<count;i++){
    if(at+46>end||view.getUint32(at,true)!==0x02014b50)throw Error('Invalid ZIP directory entry.');
    const length=view.getUint16(at+28,true),extra=view.getUint16(at+30,true),comment=view.getUint16(at+32,true);
    if(at+46+length+extra+comment>end)throw Error('Truncated ZIP directory entry.');
    if(view.getUint16(at+8,true)&1)throw Error('Encrypted ZIP archives are unsupported.');
    if((view.getUint32(at+38,true)>>>16&0xf000)===0xa000)throw Error('ZIP symbolic links are unsupported.');
    const name=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(at+46,at+46+length));
    if(crcs.has(name))throw Error('Duplicate ZIP filename: '+name);
    crcs.set(name,view.getUint32(at+16,true));
    at+=46+length+extra+comment;
  }
  if(at!==end)throw Error('Invalid ZIP directory size.');
  return crcs;
}

function crc32(bytes) {
  let crc=0xffffffff;
  for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  return (crc^0xffffffff)>>>0;
}

// This function is also embedded in the saved HTML: no network library or
// browser-local state is needed to reopen a package on another device.
export function renderPackage(pkg) {
  const root='https://lesson-package.invalid/';
  const cache=new Map(), visiting=new Set(), urls=[];
  const decode=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
  const text=entry=>new TextDecoder('utf-8',{fatal:true}).decode(decode(entry.data));
  function lookup(value,from) {
    if(!value || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(value.trim()))return null;
    const u=new URL(value,new URL(from,root));
    const key=decodeURIComponent(u.pathname.slice(1));
    return {key,suffix:u.hash};
  }
  function ref(value,from,required=true) {
    const target=lookup(value,from);
    if(!target)return value;
    if(!Object.hasOwn(pkg.files,target.key)) {
      if(required)throw Error('Missing package asset: '+value+' (referenced by '+from+').');
      return value;
    }
    return asset(target.key)+target.suffix;
  }
  function css(s,from) {
    return s.replace(/@import\s+(['"])([^'"]+)\1/g,(_,q,v)=>'@import '+q+ref(v,from)+q)
      .replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi,(_,q,v)=>'url("'+ref(v,from).replace(/"/g,'%22')+'")');
  }
  function js(s,from) {
    // Rewrite literal package URLs, including imports, fetch, Audio and image
    // assignments. Computed URLs require a hosted lesson rather than bundling.
    return s.replace(/(['"])([^'"\r\n\\]+)\1/g,(all,q,v,offset)=>{
      const moduleURL=/(?:\bfrom|\bimport|\bimport\s*\(|\bnew\s+URL\s*\()\s*$/.test(s.slice(Math.max(0,offset-40),offset));
      let base=moduleURL?from:pkg.main,t=lookup(v,base);
      if(!moduleURL&&t&&!Object.hasOwn(pkg.files,t.key)){base=from;t=lookup(v,base);}
      if(!t||!Object.hasOwn(pkg.files,t.key))return all;
      return q+ref(v,base)+q;
    });
  }
  function html(s,from) {
    const doc=new DOMParser().parseFromString(s,'text/html');
    if(doc.querySelector('base[href]'))throw Error('Package HTML must not contain a <base href> tag. Use relative asset paths.');
    doc.querySelectorAll('[src],[href],[poster],[data]').forEach(el=>{
      for(const name of ['src','href','poster','data']) {
        if(!el.hasAttribute(name))continue;
        const val=el.getAttribute(name);
        // Ordinary hyperlinks may lead outside the package. Assets must exist.
        const required=!(name==='href'&&el.tagName==='A');
        const next=ref(val,from,required);
        if(next!==val){el.setAttribute(name,next);el.removeAttribute('integrity');el.removeAttribute('crossorigin');}
      }
    });
    doc.querySelectorAll('[srcset]').forEach(el=>{
      const value=el.getAttribute('srcset');
      if(!value.includes('data:'))el.setAttribute('srcset',value.split(',').map(part=>{
        const bits=part.trim().split(/\s+/);bits[0]=ref(bits[0],from);return bits.join(' ');
      }).join(', '));
    });
    doc.querySelectorAll('style').forEach(el=>el.textContent=css(el.textContent,from));
    doc.querySelectorAll('[style]').forEach(el=>el.setAttribute('style',css(el.getAttribute('style'),from)));
    doc.querySelectorAll('script:not([src])').forEach(el=>{
      if(!el.type||/^(module|text\/javascript|application\/javascript)$/.test(el.type))el.textContent=js(el.textContent,from);
    });
    return '<!doctype html>\n'+doc.documentElement.outerHTML;
  }
  function asset(key) {
    if(cache.has(key))return cache.get(key);
    if(visiting.has(key))throw Error('Circular package dependency: '+key+'. Combine circular modules before uploading.');
    visiting.add(key);
    const entry=pkg.files[key];let body=decode(entry.data);
    if(entry.type==='text/css')body=css(text(entry),key);
    if(entry.type==='text/javascript')body=js(text(entry),key);
    if(entry.type==='text/html')body=html(text(entry),key);
    const url=URL.createObjectURL(new Blob([body],{type:entry.type}));urls.push(url);cache.set(key,url);visiting.delete(key);return url;
  }
  try{return {html:html(text(pkg.files[pkg.main]),pkg.main),dispose:()=>urls.forEach(u=>URL.revokeObjectURL(u))};}
  catch(e){urls.forEach(u=>URL.revokeObjectURL(u));throw e;}
}

export async function prepareLesson(file,progress=()=>{}) {
  const isZip=/\.zip$/i.test(file.name);
  if(!isZip&&!/\.html?$/i.test(file.name))throw Error('Choose an HTML or ZIP lesson.');
  if(file.size>MAX_STORED_BYTES)throw Error('The file exceeds 20 MB. Compress videos or use externally hosted HTTPS video URLs.');
  if(!isZip)return file;
  progress('Checking and extracting ZIP…');
  const seen=new Set();let total=0,count=0;
  let extracted;
  try {
    const bytes=new Uint8Array(await file.arrayBuffer()),crcs=zipDirectory(bytes);
    extracted=unzipSync(bytes,{filter:entry=>{
      const name=entry.name;
      if(name.includes('\\')||name.startsWith('/')||/[\x00-\x1f\x7f<>:"|?*#%]/.test(name)||name.split('/').some(p=>p==='.'||p==='..'||p.length>180)||name.length>700)
        throw Error('Unsafe ZIP path: '+name);
      if(name.endsWith('/')||name.startsWith('__MACOSX/')||/(^|\/)\.[^/]+$/.test(name))return false;
      if(seen.has(name.normalize('NFC').toLowerCase()))throw Error('Duplicate or ambiguous filename: '+name);
      seen.add(name.normalize('NFC').toLowerCase());
      if(!TYPES[name.split('.').pop().toLowerCase()])throw Error('Unsupported file in ZIP: '+name);
      total+=entry.originalSize;count++;
      if(count>500||total>MAX_EXPANDED_BYTES)throw Error('ZIP exceeds 500 files or 14 MB extracted. Compress videos or use externally hosted HTTPS video URLs.');
      return true;
    }});
    for(const [name,body] of Object.entries(extracted))if(crc32(body)!==crcs.get(name))throw Error('Checksum failed for '+name+'. Recreate the ZIP using UTF-8 filenames.');
  }catch(e){throw Error('Invalid ZIP: '+e.message);}
  const names=Object.keys(extracted), htmls=names.filter(n=>/\.html?$/i.test(n));
  if(!htmls.length)throw Error('The ZIP contains no HTML lesson.');
  let candidates=htmls.filter(n=>/(^|\/)index\.html?$/i.test(n));
  if(!candidates.length)candidates=htmls;
  candidates.sort((a,b)=>a.split('/').length-b.split('/').length);
  if(candidates.length>1&&candidates[0].split('/').length===candidates[1].split('/').length)throw Error('The main HTML file is ambiguous. Put one index.html at the ZIP root.');
  const files=Object.create(null);
  for(const name of names)files[name]={type:TYPES[name.split('.').pop().toLowerCase()],data:base64(extracted[name])};
  const pkg={main:candidates[0],files};
  progress('Validating lesson links…');
  const preview=renderPackage(pkg);preview.dispose();
  const payload=JSON.stringify(pkg).replace(/</g,'\\u003c');
  const runtime='const pkg='+payload+';try{const result=('+renderPackage.toString()+')(pkg);document.open();document.write(result.html);document.close();}catch(e){document.body.textContent="Could not open lesson package: "+e.message;}';
  const output=new Blob(['<!doctype html><meta charset="utf-8"><!-- KEC lesson package v1 --><body><p>Opening lesson package…</p><script>',runtime,'</script>'],{type:'text/html'});
  if(output.size>MAX_STORED_BYTES)throw Error('The prepared lesson exceeds 20 MB after packaging. Compress videos or use externally hosted HTTPS video URLs.');
  return output;
}
