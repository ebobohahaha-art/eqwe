// Vercel's native Node.js Web handler: preserve the request, cancellation signal,
// response status and streaming body. No HTTP-to-Web buffering adapter.
export const SECURITY_HEADERS = Object.freeze({
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer',
  'Permissions-Policy':'camera=(), microphone=(), geolocation=()',
  'Strict-Transport-Security':'max-age=31536000'
});
export function vercelHandler(handler){
  return async request=>{
    try{
      const response=await handler(request);
      const headers=new Headers(response.headers);
      for(const [key,value] of Object.entries(SECURITY_HEADERS))headers.set(key,value);
      headers.set('Cache-Control','no-store');
      headers.set('X-Gateway-Release','vercel-v1');
      return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
    }catch{
      return Response.json({error:'Gateway unavailable'},{status:503,headers:{...SECURITY_HEADERS,'Cache-Control':'no-store','X-Gateway-Release':'vercel-v1'}});
    }
  };
}
