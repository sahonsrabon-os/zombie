export function isMcpOriginAllowed({origin,host,protocol='http',allowedOrigins=[],allowCrossOrigin=true}={}) {
  if(!origin)return true;
  try{
    const parsed=new URL(origin);
    if(!['http:','https:'].includes(parsed.protocol)||parsed.origin==='null')return false;
    const requestOrigin=`${String(protocol).toLowerCase()}://${String(host??'').toLowerCase()}`;
    if(parsed.origin.toLowerCase()===requestOrigin)return true;
    return allowCrossOrigin===true&&allowedOrigins.map(value=>String(value).toLowerCase()).includes(parsed.origin.toLowerCase());
  }catch{return false;}
}