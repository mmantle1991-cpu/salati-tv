/** Server-side adapter for prayers.qa: never silently substitutes calculation results. */
const clean = html => html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ')
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ')
  .replace(/<[^>]+>/g,' ')
  .replace(/&nbsp;|&#160;/gi,' ')
  .replace(/&[a-z]+;/gi,' ')
  .replace(/\s+/g,' ').trim();
function parsePrayerTimes(html){
  const text=clean(html);
  // Expected visible order: fajr, sunrise, dhuhr, asr, maghrib, isha.
  const match=text.match(/(?:الأذان|اذان)\s*[:：]?\s*(\d{1,2}):(\d{2})\s+(\d{1,2}):(\d{2})\s+(\d{1,2}):(\d{2})\s+(\d{1,2}):(\d{2})\s+(\d{1,2}):(\d{2})\s+(\d{1,2}):(\d{2})/);
  if(!match)throw Error('Prayer time table not recognized');
  const all=[];
  for(let i=1;i<=11;i+=2){let hh=+match[i],mm=+match[i+1];if(hh>23||mm>59)throw Error('Invalid time');all.push(hh*60+mm)}
  const out=[all[0],all[2],all[3],all[4],all[5]];
  if(out.some((n,i)=>i&&n<=out[i-1]))throw Error('Unexpected prayer time order');
  return out;
}
const dateForQatar=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Qatar',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
exports.handler=async function(event){
  const date=dateForQatar();
  if(event.queryStringParameters?.date!==date)return{statusCode:400,body:JSON.stringify({error:'Only today is supported'})};
  try{
    const urls=['https://prayers.qa/iphone.php','https://prayers.qa/'];
    let found=null;
    for(const url of urls){
      try{
        const res=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0 SalatiTV/2.0'},signal:AbortSignal.timeout(9000)});
        if(!res.ok)continue;
        const html=await res.text();
        // Require an explicit matching Gregorian date to avoid outdated/cached data.
        const parts=date.split('-');
        const month=Number(parts[1]),day=Number(parts[2]);
        const normalized=clean(html).replace(/[٠-٩]/g,c=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(c)));
        const datePattern=new RegExp('(?:^|\\D)'+day+'\\s+(?:[\\p{L}\\s]+)\\s+'+parts[0]+'(?:\\s*م)?','u');
        const numericPattern=new RegExp('(?:^|\\D)'+day+'[\\/-]'+month+'[\\/-]'+parts[0]+'(?:\\D|$)');
        if(!datePattern.test(normalized)&&!numericPattern.test(normalized))continue;
        found=parsePrayerTimes(html);break;
      }catch(e){continue}
    }
    if(!found)throw Error('Could not verify today’s times from prayers.qa');
    return{statusCode:200,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'public, max-age=300'},body:JSON.stringify({source:'prayers.qa',date,times:found})};
  }catch(e){return{statusCode:503,headers:{'Content-Type':'application/json'},body:JSON.stringify({error:'Prayer times unavailable or unverified'})}}
};
