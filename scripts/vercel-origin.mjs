export function vercelOrigin(env=process.env){
  const host=env.VERCEL_ENV==='production'?env.VERCEL_PROJECT_PRODUCTION_URL||env.VERCEL_URL:env.VERCEL_URL;
  const value=env.PUBLIC_ORIGIN || (host?`https://${host}`:null);
  if(!value)throw new Error('Set PUBLIC_ORIGIN to your HTTPS site origin, or enable Vercel system environment variables');
  const url=new URL(value);
  if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('PUBLIC_ORIGIN must be an HTTPS origin without path or credentials');
  return url.origin;
}
